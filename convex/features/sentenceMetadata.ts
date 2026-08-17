import { v } from 'convex/values';
import { internalAction, internalMutation, MutationCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { sourcedTranslationEntriesValidator } from '../types';
import { trackException } from '../analytics';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_MODELS, OPENROUTER_USAGE_ACCOUNTING } from '../config/aiModels';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../lib/posthogAi';
import { getLanguageByCode, resolveAudioSpeakerGender } from '../../lib/languages';
import { isUserCreatedText } from '../../lib/translationProvenance';
import { retrier } from '../retrier';

const METADATA_SYSTEM_PROMPT = `You analyze a sentence and return strict linguistic metadata as JSON.

You will receive one or more renderings of the SAME sentence in different languages. Use cross-lingual signals — gendered morphology in any one of the supplied translations is enough to fix the sentence's gender. Treat the renderings as semantically identical: do not invent extra meaning that no rendering supports.

Return ONLY a valid JSON object with EXACTLY these five keys and no others, no markdown, no explanation:

{
  "register": "formal" | "informal" | "neutral",
  "addresseeNumber": "singular" | "plural" | "not_applicable",
  "speakerGender": "male" | "female" | "neutral",
  "addresseeGender": "male" | "female" | "neutral" | "not_applicable",
  "addressesSomeone": true | false
}

FIELD DEFINITIONS:

- register: The formality level of the sentence. "formal" for polite/respectful forms (Spanish "usted", French "vous", German "Sie", Japanese です/ます, Korean 해요체/합쇼체, Hindi आप). "informal" for casual/familiar forms (Spanish "tú/vosotros", French "tu", German "du", Japanese plain form, Korean 반말, Hindi तुम). "neutral" only when there is no addressee or no formality marking at all.

- addresseeNumber: How many people are being addressed. "singular" if the sentence speaks to one person. "plural" if it speaks to more than one. "not_applicable" if the sentence has no addressee (e.g. "It is raining.", "The book is on the table.", a first-person statement with no "you"). This field NEVER takes "neutral" — its no-addressee value is "not_applicable".

- speakerGender: The grammatical gender of the speaker. Return "male" or "female" ONLY when at least one supplied translation contains gender-marked morphology referring to the speaker. Examples that fix the gender:
  * Spanish/Italian/Portuguese/French past participles or adjectives agreeing with a first-person subject ("estoy cansada" = female, "sono andato" = male).
  * Russian past-tense verbs with first-person subject ("я пошёл" = male, "я пошла" = female).
  * Arabic verb conjugations and pronoun suffixes referring to the speaker.
  * Hebrew verb forms in first person.
  * Hindi verb agreement with first-person subject.
  * Polish/Czech past tense gendered forms.
  Otherwise return "neutral". Do NOT guess based on topic or stereotype.

- addresseeGender: Same rule, but for the person being addressed. "not_applicable" if there is no addressee. "neutral" if there is an addressee but no rendering grammatically marks their gender.

- addressesSomeone: Boolean. true if the sentence speaks to a 2nd-person addressee (imperatives, direct questions, vocatives, sentences containing "you"/"your", commands, requests, greetings). false otherwise (descriptive/narrative sentences like "It is raining.", "The Pacific Ocean is the largest body of water on Earth.", first-person statements with no second-person reference). When addressesSomeone is false, addresseeNumber should be "not_applicable" and addresseeGender should be "not_applicable".

Be strict: if no rendering forces a value, return "neutral" / "not_applicable". Do not invent gender information.`;

export const ALLOWED_REGISTER = ['formal', 'informal', 'neutral'] as const;
export const ALLOWED_ADDRESSEE_NUMBER = [
  'singular',
  'plural',
  'not_applicable',
] as const;
export const ALLOWED_SPEAKER_GENDER = ['male', 'female', 'neutral'] as const;
export const ALLOWED_ADDRESSEE_GENDER = [
  'male',
  'female',
  'neutral',
  'not_applicable',
] as const;

export type Metadata = {
  register: (typeof ALLOWED_REGISTER)[number];
  addresseeNumber: (typeof ALLOWED_ADDRESSEE_NUMBER)[number];
  speakerGender: (typeof ALLOWED_SPEAKER_GENDER)[number];
  addresseeGender: (typeof ALLOWED_ADDRESSEE_GENDER)[number];
  addressesSomeone: boolean;
};

function validateField<T extends string>(
  input: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`Metadata field ${field} is missing or not a string`);
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${field} value: ${JSON.stringify(value)}`);
  }
  return value as T;
}

/**
 * Validate that an arbitrary value is a well-formed sentence-metadata object.
 * Throws plain `Error` (not `ConvexError`) so callers can re-wrap as they see fit.
 * Used both server-side after auto-fill and inside the metadata-fetch action.
 */
export function validateSentenceMetadata(input: unknown): Metadata {
  if (input === null || typeof input !== 'object') {
    throw new Error('Metadata response is not an object');
  }
  const obj = input as Record<string, unknown>;
  const addressesSomeone = obj.addressesSomeone;
  if (typeof addressesSomeone !== 'boolean') {
    throw new Error(
      `Metadata field addressesSomeone is missing or not a boolean: ${JSON.stringify(addressesSomeone)}`,
    );
  }
  return {
    register: validateField(obj, 'register', ALLOWED_REGISTER),
    addresseeNumber: validateField(
      obj,
      'addresseeNumber',
      ALLOWED_ADDRESSEE_NUMBER,
    ),
    speakerGender: validateField(obj, 'speakerGender', ALLOWED_SPEAKER_GENDER),
    addresseeGender: validateField(
      obj,
      'addresseeGender',
      ALLOWED_ADDRESSEE_GENDER,
    ),
    addressesSomeone,
  };
}

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
 * responses yield an empty object. The goal is graceful degradation — the
 * caller applies whatever fields came back and leaves the rest unset rather
 * than triggering retrier backoff on a bad-but-recurring LLM response.
 */
function safeExtractMetadata(raw: string): Partial<Metadata> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
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
  // other three fields use "neutral" — so the LLM sometimes emits "neutral"
  // here. Coerce that single known confusion so the value survives validation.
  if (obj.addresseeNumber === 'neutral') obj.addresseeNumber = 'not_applicable';
  const out: Partial<Metadata> = {};
  const stringOut: Record<string, string> = {};
  pickField(stringOut, obj, 'register', ALLOWED_REGISTER);
  pickField(stringOut, obj, 'addresseeNumber', ALLOWED_ADDRESSEE_NUMBER);
  pickField(stringOut, obj, 'speakerGender', ALLOWED_SPEAKER_GENDER);
  pickField(stringOut, obj, 'addresseeGender', ALLOWED_ADDRESSEE_GENDER);
  Object.assign(out, stringOut);
  // addressesSomeone is the only boolean field — handle separately.
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
 * Shared args for the two metadata actions below — the job payload that flows
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
  // Convex log stream — this id lets us re-capture the exception attributed
  // to the affected user. Optional so jobs already scheduled before this
  // field existed still validate.
  userId: v.optional(v.string()),
});

/**
 * Entry point used by manual custom-text creation, bulk import, and
 * post-chat-approval. All three insert `userCreated: true` texts — see the
 * stamping block in `applyMetadataAndPrepareCard`, which depends on that.
 *
 * Two-step orchestration:
 *   1. Immediately call `applyMetadataAndPrepareCard` with `metadata: undefined` so the
 *      card is unblocked and audio generation starts with a coin-flipped voice gender.
 *      This preserves the "card creation is never blocked on metadata" guarantee.
 *   2. Hand the LLM call to the `action-retrier` component. The retrier only sees
 *      transient infrastructure errors (e.g. `generateText` network failures) —
 *      bad-but-parseable LLM output degrades to a partial patch inside
 *      `fetchSentenceMetadata` rather than throwing. On success, whatever fields
 *      validated are patched onto the row and `prepareCardContent` is re-scheduled
 *      so any audio whose voice gender no longer matches the now-resolved
 *      `audioSpeakerGender` is invalidated and regenerated by the existing logic
 *      in `decks.ts:scheduleMissingContent`.
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
        },
      );

      return null;
    } catch (error) {
      // The log-stream copy of this error is anonymous; re-capture it
      // attributed to the text's owner, then rethrow so Convex still records
      // the failure. Actions aren't transactional, so the capture survives
      // the rethrow (unlike in mutations — see convex/analytics.ts).
      await trackException(ctx, error, args.userId, {
        textId: args.textId,
        source: 'generateSentenceMetadata',
      });
      throw error;
    }
  },
});

/**
 * Run the OpenRouter LLM to infer linguistic metadata and patch whatever
 * fields validate onto the row. Only transient infrastructure failures from
 * `generateText` bubble up and trigger retrier backoff — a bad-but-parseable
 * LLM response degrades to a partial patch rather than a retry loop.
 */
export const fetchSentenceMetadata = internalAction({
  args: metadataJobArgs.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      if (args.translations.length === 0) {
        // Permanent error — nothing to retry. Log and return without throwing.
        console.error(
          'fetchSentenceMetadata: no translations',
          args.textId,
        );
        return null;
      }

      const renderings = args.translations
        .map((t) => {
          const lang = getLanguageByCode(t.language);
          return `[${lang?.name ?? t.language}]: ${t.text}`;
        })
        .join('\n');

      const userPrompt = `Renderings of the same sentence:\n${renderings}\n\nReturn the metadata JSON now.`;

      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
        extraBody: OPENROUTER_USAGE_ACCOUNTING,
      });

      const startedAt = Date.now();
      const { text, usage, providerMetadata } = await generateText({
        model: openrouter(OPENROUTER_MODELS.sentenceMetadata),
        system: METADATA_SYSTEM_PROMPT,
        prompt: userPrompt,
      });

      // Fires once per newly-created card and was previously both unmetered and
      // unbilled — i.e. pure invisible cost that scales with content growth.
      await captureGeneration(ctx, {
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
 * stamp that gender onto the text's translations, and (optionally) schedule
 * prepareCardContent so audio is regenerated to match.
 *
 * Idempotent: safe to call twice (once with `metadata: undefined` to unblock,
 * then again with real metadata after a retry success). The audioSpeakerGender
 * precedence rule below ensures the coin flip never re-rolls.
 *
 * Exported as a plain helper (not only the internalMutation below) so the
 * chat "also correct" replace path (cardApprovals.ts) can apply model-proposed
 * metadata inside its own transaction. The prepareCardContent pass this
 * schedules is what re-voices audio after a speaker-gender change (payload
 * voiceGender mismatch check in decks.ts).
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
    };
    schedulePrepareCard: boolean;
    baseLanguages: string[];
    targetLanguages: string[];
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
      audioSpeakerGender = resolveAudioSpeakerGender(incomingGender);
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
        (metadataPatch.addresseeGender as string | undefined) ?? text.addresseeGender;
      const needsCoinFlip =
        proposedAddressee === undefined ||
        proposedAddressee === 'neutral' ||
        proposedAddressee === 'not_applicable' ||
        proposedAddressee === '';
      const alreadyCommitted =
        text.addresseeGender === 'male' || text.addresseeGender === 'female';
      if (needsCoinFlip && !alreadyCommitted) {
        metadataPatch.addresseeGender =
          Math.random() < 0.5 ? 'male' : 'female';
      } else if (needsCoinFlip && alreadyCommitted) {
        // Preserve the prior commit even if the LLM tried to write neutral.
        metadataPatch.addresseeGender = text.addresseeGender as string;
      }
    }

    // ── referentGender coin-flip ──
    // Always pick a gender for the third-party referent, so gendered nouns
    // (translator → Übersetzer/-in, doctor → Arzt/Ärztin) get a consistent
    // assignment that's stable across target languages. Once set, never re-roll.
    if (text.referentGender !== 'male' && text.referentGender !== 'female') {
      metadataPatch.referentGender = Math.random() < 0.5 ? 'male' : 'female';
    }

    await ctx.db.patch(args.textId, {
      audioSpeakerGender,
      ...metadataPatch,
    });

    // Finish the record this step owns: stamp the resolved gender onto the
    // translations that were inserted alongside the text.
    //
    // Chat approval and custom-text creation write their translation rows
    // BEFORE any gender exists, so they landed unstamped — "legacy" to every
    // consumer of `translations.speakerGender`. That is not what legacy means:
    // these rows are current, and their gender is precisely the one resolved
    // here (for chat cards the metadata LLM *infers* the gender by reading
    // these very translations). Leaving them unstamped is what let the
    // gender-drift sweep treat them as suspect.
    //
    // Re-stamped on every call, so the retry that lands a definitive gender
    // keeps text and translations in agreement instead of turning "legacy"
    // rows into "drifted" ones. Only rows that disagree are patched, so the
    // common re-run writes nothing.
    //
    // Restricted to user-created cards, whose wording is never regenerated —
    // there the stamp records the card's gender rather than licensing a
    // rewrite. On a PREMADE text the same stamp would be actively harmful: it
    // clears both `isLegacy` and `isDrifted` for rows that really were written
    // under the old gender, suppressing the `isLegacyAlongsideDriftedAudio`
    // heal path in `scheduleMissingContent` — the audio gets re-voiced while
    // the wrong-grammar text survives, which is the exact failure that branch
    // exists to prevent. Every caller creates user-created cards today, so
    // this is a guard on an invariant rather than a live branch; it is here so
    // a future premade caller fails safe instead of silently mislabelling.
    if (isUserCreatedText(text)) {
      const translations = await ctx.db
        .query('translations')
        .withIndex('by_textId', (q) => q.eq('textId', args.textId))
        .collect();
      for (const translation of translations) {
        if (translation.speakerGender !== audioSpeakerGender) {
          await ctx.db.patch(translation._id, {
            speakerGender: audioSpeakerGender,
          });
        }
      }
    }

    if (args.schedulePrepareCard) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.decks.prepareCardContent,
        {
          textId: args.textId,
          baseLanguages: args.baseLanguages,
          targetLanguages: args.targetLanguages,
        },
      );
    }

    return null;
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
      }),
    ),
    schedulePrepareCard: v.boolean(),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: applyTextMetadata,
});
