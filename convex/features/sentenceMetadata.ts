import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
} from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import {
  sourcedTranslationEntriesValidator,
  ttsPriorityValidator,
  llmPriorityValidator,
  type TtsPriority,
  type LlmPriority,
} from '../types';
import { trackException } from '../analytics';
import { generateText } from 'ai';
import {
  OPENROUTER_MODELS,
  SPEAKER_GENDER_CHECK_PROVIDER,
} from '../config/aiModels';
import { openrouterCallOptions } from './translationLLM';
import {
  buildSpeakerGenderSystemPrompt,
  buildSpeakerGenderUserPrompt,
  parseSpeakerGenderVerdict,
  SPEAKER_GENDER_CHECK_SOURCE,
} from '../../lib/speakerGenderPrompt';
import { getOpenRouter } from '../lib/openrouter';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../lib/posthogAi';
import { resolveAudioSpeakerGender, seededIndex } from '../../lib/languages';
import { isUserCreatedText } from '../../lib/translationProvenance';
import { deleteAudioRow } from '../lib/audio';
import {
  parseRenderingKey,
  renderingKey,
} from '../../lib/preferenceResolution';
import { retrier } from '../retrier';
import { stripJsonFences } from '../lib/llmJson';

// The classifier prompt lives in convex/lib/sentenceMetadataPrompt.ts
// (Convex-runtime-free) so `pnpm eval:metadata` grades the exact production
// prompt; change it there.
import {
  buildMetadataSystemPrompt,
  buildMetadataUserPrompt,
} from '../lib/sentenceMetadataPrompt';

// Value sets, `Metadata`, and the strict validator live in
// lib/sentenceMetadataShape.ts (Convex-runtime-free, so the autofill prompt
// module and eval script can share them). Re-exported here so existing
// importers keep one import site.
export {
  ALLOWED_REGISTER,
  ALLOWED_ADDRESSEE_NUMBER,
  ALLOWED_SPEAKER_GENDER,
  ALLOWED_ADDRESSEE_GENDER,
  ALLOWED_REFERENT_GENDER,
  validateSentenceMetadata,
  type Metadata,
} from '../lib/sentenceMetadataShape';
import {
  ALLOWED_REGISTER,
  ALLOWED_ADDRESSEE_NUMBER,
  ALLOWED_SPEAKER_GENDER,
  ALLOWED_ADDRESSEE_GENDER,
  ALLOWED_REFERENT_GENDER,
  CURRENT_SENTENCE_METADATA_SOURCE,
  type Metadata,
} from '../lib/sentenceMetadataShape';

function pickField<T extends string>(
  out: Record<string, string>,
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): void {
  const value = obj[field];
  if (
    typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
  ) {
    out[field] = value;
  } else if (value !== undefined) {
    console.warn(
      `sentenceMetadata: dropping invalid ${field}: ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Best-effort extraction of metadata from a raw LLM response. Never throws.
 * Returns whichever subset of fields validated; unparseable or non-object
 * responses yield an empty object. The goal is graceful degradation. The
 * caller applies whatever fields came back and leaves the rest unset rather
 * than triggering retrier backoff on a bad-but-recurring LLM response.
 */
function safeExtractMetadata(raw: string): Partial<Metadata> {
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('sentenceMetadata: unparseable LLM response', { raw });
    return {};
  }
  if (parsed === null || typeof parsed !== 'object') {
    console.error('sentenceMetadata: LLM response is not an object', { raw });
    return {};
  }
  const obj = parsed as Record<string, unknown>;
  // addresseeNumber uses "not_applicable" for the no-addressee case, but the
  // other three fields use "neutral", so the LLM sometimes emits "neutral"
  // here. Coerce that single known confusion so the value survives validation.
  if (obj.addresseeNumber === 'neutral') obj.addresseeNumber = 'not_applicable';
  const out: Partial<Metadata> = {};
  const stringOut: Record<string, string> = {};
  pickField(stringOut, obj, 'register', ALLOWED_REGISTER);
  pickField(stringOut, obj, 'addresseeNumber', ALLOWED_ADDRESSEE_NUMBER);
  pickField(stringOut, obj, 'speakerGender', ALLOWED_SPEAKER_GENDER);
  pickField(stringOut, obj, 'addresseeGender', ALLOWED_ADDRESSEE_GENDER);
  pickField(stringOut, obj, 'referentGender', ALLOWED_REFERENT_GENDER);
  Object.assign(out, stringOut);
  // addressesSomeone is the only boolean field. Handle separately.
  if (typeof obj.addressesSomeone === 'boolean') {
    out.addressesSomeone = obj.addressesSomeone;
  } else if (obj.addressesSomeone !== undefined) {
    console.warn(
      `sentenceMetadata: dropping invalid addressesSomeone: ${JSON.stringify(obj.addressesSomeone)}`,
    );
  }
  return out;
}

/**
 * Shared args for the two metadata actions below. The job payload that flows
 * from `generateSentenceMetadata` through the retrier into
 * `fetchSentenceMetadata` unchanged.
 */
const metadataJobArgs = v.object({
  textId: v.id('texts'),
  translations: sourcedTranslationEntriesValidator,
  schedulePrepareCard: v.boolean(),
  baseLanguages: v.array(v.string()),
  targetLanguages: v.array(v.string()),
  // Owner of the text. Scheduled functions run with no auth/request context,
  // so a failure here reaches PostHog's error tracking anonymously via the
  // Convex log stream. This id lets us re-capture the exception attributed
  // to the affected user. Optional so jobs already scheduled before this
  // field existed still validate.
  userId: v.optional(v.string()),
  // Threaded to prepareCardContent. Bulk import passes 'background' so a
  // paste of dozens of sentences cannot queue ahead of on-screen card audio.
  // Absent = interactive (single-card create, chat approval).
  priority: v.optional(ttsPriorityValidator),
  llmPriority: v.optional(llmPriorityValidator),
});

/**
 * Entry point used by manual custom-text creation, bulk import, and
 * post-chat-approval. All three insert `userCreated: true` texts. See the
 * stamping block in `applyMetadataAndPrepareCard`, which depends on that.
 *
 * Two-step orchestration:
 *   1. Immediately call `applyMetadataAndPrepareCard` with `metadata: undefined` so the
 *      card is unblocked and audio generation starts with a coin-flipped voice gender.
 *      This preserves the "card creation is never blocked on metadata" guarantee.
 *   2. Hand the LLM call to the `action-retrier` component. The retrier only sees
 *      transient infrastructure errors (e.g. `generateText` network failures).
 *      Bad-but-parseable LLM output degrades to a partial patch inside
 *      `fetchSentenceMetadata` rather than throwing. On success, whatever fields
 *      validated are patched onto the row and `prepareCardContent` is re-scheduled
 *      so any audio whose voice gender no longer matches the now-resolved
 *      `audioSpeakerGender` is invalidated and regenerated by the existing logic
 *      in `ensureTextContent` (convex/lib/contentScheduling.ts).
 */
export const generateSentenceMetadata = internalAction({
  args: metadataJobArgs.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId: args.textId,
          metadata: undefined,
          schedulePrepareCard: args.schedulePrepareCard,
          baseLanguages: args.baseLanguages,
          targetLanguages: args.targetLanguages,
          priority: args.priority,
          llmPriority: args.llmPriority,
          requestedByUserId: args.userId,
        },
      );

      await retrier.run(
        // Convex 1.41 widened `ActionCtx.runMutation` with an optional
        // `transactionLimits` arg, so the ctx no longer structurally matches the
        // older `RunMutationCtx` that @convex-dev/action-retrier@0.3.0 declares.
        // Runtime is compatible; this cast bridges the component's type lag.
        ctx as unknown as Parameters<typeof retrier.run>[0],
        internal.features.sentenceMetadata.fetchSentenceMetadata,
        {
          textId: args.textId,
          translations: args.translations,
          schedulePrepareCard: args.schedulePrepareCard,
          baseLanguages: args.baseLanguages,
          targetLanguages: args.targetLanguages,
          userId: args.userId,
          priority: args.priority,
          llmPriority: args.llmPriority,
        },
      );

      return null;
    } catch (error) {
      // The log-stream copy of this error is anonymous; re-capture it
      // attributed to the text's owner, then rethrow so Convex still records
      // the failure. Actions aren't transactional, so the capture survives
      // the rethrow (unlike in mutations, see convex/analytics.ts).
      await trackException(ctx, error, args.userId, {
        textId: args.textId,
        source: 'generateSentenceMetadata',
      });
      throw error;
    }
  },
});

/**
 * The speaker-gender check a "wrong speaker" flag runs on a CURRICULUM text
 * (`flagTranslation`): the corpus scan's own one-word prompt
 * (lib/speakerGenderPrompt.ts) on the English sentence, so a flag and the
 * offline scan cannot disagree on the rule. A male/female verdict becomes
 * the sentence's voice and outranks the learner's pick; a neutral one
 * records that the wording fixes nothing and leaves the pick as the voice.
 * No verdict (an outage, an unparseable answer) changes nothing.
 * User-written texts never come here: the flag short-circuits on them.
 */
export const checkSpeakerGender = internalAction({
  args: {
    textId: v.id('texts'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
    /** The flagging learner, for cost attribution. */
    userId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = await ctx.runQuery(
      internal.features.sentenceMetadata.getTextForSpeakerCheck,
      { textId: args.textId },
    );
    if (!text) return null;
    // The prompt reads English, which every curriculum text is.
    if (text.language !== 'en') return null;
    try {
      const openrouter = getOpenRouter();
      const providerOptions = openrouterCallOptions(
        'none',
        SPEAKER_GENDER_CHECK_PROVIDER,
      );
      const startedAt = Date.now();
      const {
        text: answer,
        usage,
        providerMetadata,
      } = await generateText({
        model: openrouter(OPENROUTER_MODELS.speakerGenderCheck),
        system: buildSpeakerGenderSystemPrompt(),
        prompt: buildSpeakerGenderUserPrompt(text.text),
        maxOutputTokens: 4,
        temperature: 0,
        ...(providerOptions ? { providerOptions } : {}),
      });
      await captureGeneration(ctx, {
        distinctId: args.userId,
        feature: 'speaker_gender_check',
        model: OPENROUTER_MODELS.speakerGenderCheck,
        provider: 'openrouter',
        latencyMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        costUsd: openrouterCostUsd(providerMetadata),
        traceId: openrouterGenerationId(providerMetadata),
        sharedContent: true,
        extra: { text_id: args.textId },
      });
      const verdict = parseSpeakerGenderVerdict(answer);
      if (!verdict) {
        console.error('checkSpeakerGender: no verdict', {
          textId: args.textId,
          answer,
        });
        return null;
      }
      await ctx.runMutation(
        internal.features.sentenceMetadata.applySpeakerGenderVerdict,
        {
          textId: args.textId,
          verdict,
          baseLanguages: args.baseLanguages,
          targetLanguages: args.targetLanguages,
          requestedByUserId: args.userId,
        },
      );
      return null;
    } catch (error) {
      await trackException(ctx, error, args.userId, {
        textId: args.textId,
        source: 'checkSpeakerGender',
      });
      throw error;
    }
  },
});

export const getTextForSpeakerCheck = internalQuery({
  args: { textId: v.id('texts') },
  returns: v.union(v.null(), v.object({ text: v.string(), language: v.string() })),
  handler: async (ctx, args) => {
    const text = await ctx.db.get(args.textId);
    return text ? { text: text.text, language: text.language } : null;
  },
});

/**
 * Write a speaker verdict onto a curriculum text and re-run its content:
 * `speakerGender` is the verdict, `metadataSource` says the check gave it,
 * and a definitive verdict is the voice (`audioSpeakerGender`). Rows keyed
 * for the old voice are re-rendered by the sweep the reschedule runs
 * (`sweepStaleTranslations`). Kept apart from `applyTextMetadata`: the full
 * classifier's patch also settles the addressee and referent genders, which
 * a one-word check has no verdict on.
 */
export const applySpeakerGenderVerdict = internalMutation({
  args: {
    textId: v.id('texts'),
    verdict: v.union(
      v.literal('male'),
      v.literal('female'),
      v.literal('neutral'),
    ),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
    requestedByUserId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = await ctx.db.get(args.textId);
    if (!text) return null;
    await ctx.db.patch(args.textId, {
      speakerGender: args.verdict,
      metadataSource: SPEAKER_GENDER_CHECK_SOURCE,
      ...(args.verdict === 'neutral'
        ? {}
        : { audioSpeakerGender: args.verdict }),
    });
    await schedulePrepareCardForText(ctx, args.textId, args);
    return null;
  },
});

/**
 * Run the OpenRouter LLM to infer linguistic metadata and patch whatever
 * fields validate onto the row. Only transient infrastructure failures from
 * `generateText` bubble up and trigger retrier backoff. A bad-but-parseable
 * LLM response degrades to a partial patch rather than a retry loop.
 */
export const fetchSentenceMetadata = internalAction({
  args: metadataJobArgs.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      if (args.translations.length === 0) {
        // Permanent error, nothing to retry. Log and return without throwing.
        console.error('fetchSentenceMetadata: no translations', args.textId);
        return null;
      }

      const userPrompt = buildMetadataUserPrompt(args.translations);

      const openrouter = getOpenRouter();

      const startedAt = Date.now();
      const { text, usage, providerMetadata } = await generateText({
        model: openrouter(OPENROUTER_MODELS.sentenceMetadata),
        system: buildMetadataSystemPrompt(),
        prompt: userPrompt,
      });

      // Fires once per newly-created card and was previously both unmetered and
      // unbilled, i.e. pure invisible cost that scales with content growth.
      await captureGeneration(ctx, {
        distinctId: args.userId,
        feature: 'sentence_metadata',
        model: OPENROUTER_MODELS.sentenceMetadata,
        provider: 'openrouter',
        latencyMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        costUsd: openrouterCostUsd(providerMetadata),
        traceId: openrouterGenerationId(providerMetadata),
        sharedContent: true,
        extra: { text_id: args.textId },
      });

      const metadata = safeExtractMetadata(text);

      await ctx.runMutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId: args.textId,
          metadata,
          schedulePrepareCard: args.schedulePrepareCard,
          baseLanguages: args.baseLanguages,
          targetLanguages: args.targetLanguages,
          priority: args.priority,
          llmPriority: args.llmPriority,
          requestedByUserId: args.userId,
        },
      );

      return null;
    } catch (error) {
      // Captured once per retrier attempt; PostHog groups them into one
      // issue. Attribution matters here because the retrier eventually gives
      // up and the failure never propagates back to a user-facing call.
      await trackException(ctx, error, args.userId, {
        textId: args.textId,
        source: 'fetchSentenceMetadata',
      });
      throw error;
    }
  },
});

/**
 * Patch the texts row with linguistic metadata, resolve audioSpeakerGender,
 * move a user-written text's keyed rows onto the voice when it changed, and
 * (optionally) schedule prepareCardContent so content is generated to match.
 *
 * Idempotent: safe to call twice (once with `metadata: undefined` to unblock,
 * then again with real metadata after a retry success). The audioSpeakerGender
 * precedence rule below ensures the coin flip never re-rolls.
 *
 * Exported as a plain helper (not only the internalMutation below) so the
 * chat "also correct" replace path (cardApprovals.ts) can apply model-proposed
 * metadata inside its own transaction.
 */
export async function applyTextMetadata(
  ctx: MutationCtx,
  args: {
    textId: Id<'texts'>;
    metadata?: {
      register?: string;
      addresseeNumber?: string;
      speakerGender?: string;
      addresseeGender?: string;
      addressesSomeone?: boolean;
      referentGender?: string;
    };
    schedulePrepareCard: boolean;
    baseLanguages: string[];
    targetLanguages: string[];
    priority?: TtsPriority;
    llmPriority?: LlmPriority;
    /** Requester attribution, forwarded into prepareCardContent. */
    requestedByUserId?: string;
  },
): Promise<null> {
  const text = await ctx.db.get(args.textId);
  if (!text) return null;

  const incomingGender = args.metadata?.speakerGender;

  // Resolve audioSpeakerGender with a clear precedence:
  //   1. A definitive male/female from the LLM always wins.
  //   2. Otherwise, preserve any audioSpeakerGender already on the row
  //      (so a re-run after retry success doesn't re-roll the coin flip
  //      and pointlessly invalidate audio that was just generated).
  //   3. Otherwise (first call, no definitive gender), coin-flip.
  let audioSpeakerGender: 'male' | 'female';
  if (incomingGender === 'male' || incomingGender === 'female') {
    audioSpeakerGender = incomingGender;
  } else if (
    text.audioSpeakerGender === 'male' ||
    text.audioSpeakerGender === 'female'
  ) {
    audioSpeakerGender = text.audioSpeakerGender;
  } else {
    // The same flip the content sweep would take (`resolveCardSpeakerGenders`).
    audioSpeakerGender = resolveAudioSpeakerGender(incomingGender, args.textId);
  }

  // Build the metadata patch from whatever the LLM committed to.
  const metadataPatch: Record<string, string | boolean> = {};
  if (args.metadata?.register !== undefined) {
    metadataPatch.register = args.metadata.register;
  }
  if (args.metadata?.addresseeNumber !== undefined) {
    metadataPatch.addresseeNumber = args.metadata.addresseeNumber;
  }
  if (args.metadata?.speakerGender !== undefined) {
    metadataPatch.speakerGender = args.metadata.speakerGender;
  }
  if (args.metadata?.addresseeGender !== undefined) {
    metadataPatch.addresseeGender = args.metadata.addresseeGender;
  }
  if (args.metadata?.addressesSomeone !== undefined) {
    metadataPatch.addressesSomeone = args.metadata.addressesSomeone;
  }
  // A definitive third-party gender ("my sister", "her husband") replaces
  // whatever coin flip stood there; "neutral" leaves the flip below to it.
  if (
    args.metadata?.referentGender === 'male' ||
    args.metadata?.referentGender === 'female'
  ) {
    metadataPatch.referentGender = args.metadata.referentGender;
  }

  // ── addresseeGender coin-flip ──
  // When the sentence addresses someone but the LLM didn't commit to a
  // gender (or said neutral/not_applicable), pick male/female 50/50 so
  // gendered target languages don't default masculine. Once set, never
  // re-roll (so the second call from the retrier doesn't pointlessly
  // invalidate translations that already used the first pick).
  const effectiveAddressesSomeone =
    args.metadata?.addressesSomeone ?? text.addressesSomeone ?? false;
  if (effectiveAddressesSomeone) {
    const proposedAddressee =
      (metadataPatch.addresseeGender as string | undefined) ??
      text.addresseeGender;
    const needsCoinFlip =
      proposedAddressee === undefined ||
      proposedAddressee === 'neutral' ||
      proposedAddressee === 'not_applicable' ||
      proposedAddressee === '';
    const alreadyCommitted =
      text.addresseeGender === 'male' || text.addresseeGender === 'female';
    if (needsCoinFlip && !alreadyCommitted) {
      // Seeded on the text so two concurrent passes agree (the speaker flip
      // is seeded for the same reason).
      metadataPatch.addresseeGender =
        seededIndex(`${args.textId}|addressee`, 2) === 0 ? 'male' : 'female';
    } else if (needsCoinFlip && alreadyCommitted) {
      // Preserve the prior commit even if the LLM tried to write neutral.
      metadataPatch.addresseeGender = text.addresseeGender as string;
    }
  }

  // ── referentGender coin-flip ──
  // When the classifier fixed no third party's gender, pick one so gendered
  // nouns (translator → Übersetzer/-in, doctor → Arzt/Ärztin) get a
  // consistent assignment that's stable across target languages. Once set,
  // never re-roll; only a definitive verdict above replaces it.
  if (
    metadataPatch.referentGender === undefined &&
    text.referentGender !== 'male' &&
    text.referentGender !== 'female'
  ) {
    metadataPatch.referentGender =
      seededIndex(`${args.textId}|referent`, 2) === 0 ? 'male' : 'female';
  }

  // The source stamp says "these fields are the current classifier's
  // verdict". Only a verdict that reached the speaker gender earns it: the
  // unblock call (`metadata: undefined`) and a degraded partial patch leave
  // the row unstamped, so a curriculum text's coin flip is never mistaken
  // for evidence and the sweep asks again after the cooldown.
  const classified = args.metadata?.speakerGender !== undefined;

  await ctx.db.patch(args.textId, {
    audioSpeakerGender,
    ...metadataPatch,
    ...(classified
      ? {
          metadataSource: CURRENT_SENTENCE_METADATA_SOURCE,
        }
      : {}),
  });

  // A user-written text has one rendering per language, keyed by its voice
  // (`<voice>|none`, docs/architecture/rendering-keys.md), inserted before
  // any verdict exists. When the verdict moves the voice, the rows follow it
  // in this same transaction so the card keeps finding them; the clips do
  // not, and the ensure pass below re-voices them under the new key. A
  // legacy row of a user text (from before the keys) carries the voice in
  // `speakerGender` alone, which its chip reads, so that stamp follows too.
  // A curriculum text's rows are not touched here: the sweep the
  // reschedule runs re-renders the ones keyed for the old voice
  // (`sweepStaleTranslations`).
  const previousVoice = text.audioSpeakerGender;
  if (isUserCreatedText(text) && previousVoice !== audioSpeakerGender) {
    const translations = await ctx.db
      .query('translations')
      .withIndex('by_textId', (q) => q.eq('textId', args.textId))
      .collect();
    for (const translation of translations) {
      if (translation.variantKey === undefined) {
        if (translation.speakerGender !== audioSpeakerGender) {
          await ctx.db.patch(translation._id, {
            speakerGender: audioSpeakerGender,
          });
        }
        continue;
      }
      const { voice } = parseRenderingKey(translation.variantKey);
      if (voice !== previousVoice) continue;
      await ctx.db.patch(translation._id, {
        variantKey: renderingKey(audioSpeakerGender),
        speakerGender: audioSpeakerGender,
      });
    }
    const pointers = await ctx.db
      .query('audioRecordings')
      .withIndex('by_textId', (q) => q.eq('textId', args.textId))
      .collect();
    for (const pointer of pointers) {
      if (pointer.variantKey === undefined) continue;
      if (parseRenderingKey(pointer.variantKey).voice !== previousVoice) {
        continue;
      }
      await deleteAudioRow(ctx, pointer, { keepAsset: true });
    }
  }

  if (args.schedulePrepareCard) {
    await schedulePrepareCardForText(ctx, args.textId, args);
  }

  return null;
}

/**
 * Re-run a text's content after a verdict. The pass buys audio only when
 * the text is somebody's card: a collection preview requested this verdict
 * for a text nobody studies yet, and a browse surface never buys a clip.
 */
async function schedulePrepareCardForText(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  opts: {
    baseLanguages: string[];
    targetLanguages: string[];
    priority?: TtsPriority;
    llmPriority?: LlmPriority;
    requestedByUserId?: string;
  },
): Promise<void> {
  const cardForText = await ctx.db
    .query('cards')
    .withIndex('by_textId', (q) => q.eq('textId', textId))
    .first();
  await ctx.scheduler.runAfter(0, internal.features.decks.prepareCardContent, {
    textId,
    baseLanguages: opts.baseLanguages,
    targetLanguages: opts.targetLanguages,
    priority: opts.priority,
    llmPriority: opts.llmPriority,
    requestedByUserId: opts.requestedByUserId,
    skipTts: cardForText === null,
  });
}

export const applyMetadataAndPrepareCard = internalMutation({
  args: {
    textId: v.id('texts'),
    metadata: v.optional(
      v.object({
        register: v.optional(v.string()),
        addresseeNumber: v.optional(v.string()),
        speakerGender: v.optional(v.string()),
        addresseeGender: v.optional(v.string()),
        addressesSomeone: v.optional(v.boolean()),
        referentGender: v.optional(v.string()),
      }),
    ),
    schedulePrepareCard: v.boolean(),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
    priority: v.optional(ttsPriorityValidator),
    llmPriority: v.optional(llmPriorityValidator),
    requestedByUserId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: applyTextMetadata,
});
