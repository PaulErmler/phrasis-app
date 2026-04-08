import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_MODELS } from '../config/aiModels';
import { getLanguageByCode, resolveAudioSpeakerGender } from '../../lib/languages';
import { retrier } from '../retrier';

const METADATA_SYSTEM_PROMPT = `You analyze a sentence and return strict linguistic metadata as JSON.

You will receive one or more renderings of the SAME sentence in different languages. Use cross-lingual signals — gendered morphology in any one of the supplied translations is enough to fix the sentence's gender. Treat the renderings as semantically identical: do not invent extra meaning that no rendering supports.

Return ONLY a valid JSON object with EXACTLY these four keys and no others, no markdown, no explanation:

{
  "register": "formal" | "informal" | "neutral",
  "addresseeNumber": "singular" | "plural" | "not_applicable",
  "speakerGender": "male" | "female" | "neutral",
  "addresseeGender": "male" | "female" | "neutral" | "not_applicable"
}

FIELD DEFINITIONS:

- register: The formality level of the sentence. "formal" for polite/respectful forms (Spanish "usted", French "vous", German "Sie", Japanese です/ます, Korean 해요체/합쇼체, Hindi आप). "informal" for casual/familiar forms (Spanish "tú/vosotros", French "tu", German "du", Japanese plain form, Korean 반말, Hindi तुम). "neutral" only when there is no addressee or no formality marking at all.

- addresseeNumber: How many people are being addressed. "singular" if the sentence speaks to one person. "plural" if it speaks to more than one. "not_applicable" if the sentence has no addressee (e.g. "It is raining.", "The book is on the table.", a first-person statement with no "you").

- speakerGender: The grammatical gender of the speaker. Return "male" or "female" ONLY when at least one supplied translation contains gender-marked morphology referring to the speaker. Examples that fix the gender:
  * Spanish/Italian/Portuguese/French past participles or adjectives agreeing with a first-person subject ("estoy cansada" = female, "sono andato" = male).
  * Russian past-tense verbs with first-person subject ("я пошёл" = male, "я пошла" = female).
  * Arabic verb conjugations and pronoun suffixes referring to the speaker.
  * Hebrew verb forms in first person.
  * Hindi verb agreement with first-person subject.
  * Polish/Czech past tense gendered forms.
  Otherwise return "neutral". Do NOT guess based on topic or stereotype.

- addresseeGender: Same rule, but for the person being addressed. "not_applicable" if there is no addressee. "neutral" if there is an addressee but no rendering grammatically marks their gender.

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
  };
}

function parseMetadata(raw: string): Metadata {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  return validateSentenceMetadata(parsed);
}

/**
 * Entry point used by manual custom-text creation, post-chat-approval, and the migration.
 *
 * Two-step orchestration:
 *   1. Immediately call `applyMetadataAndPrepareCard` with `metadata: undefined` so the
 *      card is unblocked and audio generation starts with a coin-flipped voice gender.
 *      This preserves the "card creation is never blocked on metadata" guarantee.
 *   2. Hand the LLM call to the `action-retrier` component. The retrier will retry
 *      `fetchSentenceMetadata` with exponential backoff on any thrown error and stop
 *      after `maxFailures` attempts. On a successful retry, the metadata is patched
 *      onto the row and `prepareCardContent` is re-scheduled so any audio whose voice
 *      gender no longer matches the now-resolved `audioSpeakerGender` is invalidated
 *      and regenerated by the existing logic in `decks.ts:scheduleMissingContent`.
 */
export const generateSentenceMetadata = internalAction({
  args: {
    textId: v.id('texts'),
    translations: v.array(
      v.object({ language: v.string(), text: v.string() }),
    ),
    schedulePrepareCard: v.boolean(),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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
      ctx,
      internal.features.sentenceMetadata.fetchSentenceMetadata,
      {
        textId: args.textId,
        translations: args.translations,
        schedulePrepareCard: args.schedulePrepareCard,
        baseLanguages: args.baseLanguages,
        targetLanguages: args.targetLanguages,
      },
    );

    return null;
  },
});

/**
 * Run the OpenRouter LLM to infer linguistic metadata, validate the response,
 * and patch the row. Throws on any failure (network / parse / validation) so the
 * `action-retrier` component reschedules with backoff.
 */
export const fetchSentenceMetadata = internalAction({
  args: {
    textId: v.id('texts'),
    translations: v.array(
      v.object({ language: v.string(), text: v.string() }),
    ),
    schedulePrepareCard: v.boolean(),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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
    });

    const { text } = await generateText({
      model: openrouter(OPENROUTER_MODELS.translationAutoFill),
      system: METADATA_SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    const metadata = parseMetadata(text);

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
  },
});

/**
 * Patch the texts row with linguistic metadata, resolve audioSpeakerGender,
 * and (optionally) schedule prepareCardContent so audio is regenerated to match.
 *
 * Idempotent: safe to call twice (once with `metadata: undefined` to unblock,
 * then again with real metadata after a retry success). The audioSpeakerGender
 * precedence rule below ensures the coin flip never re-rolls.
 */
export const applyMetadataAndPrepareCard = internalMutation({
  args: {
    textId: v.id('texts'),
    metadata: v.optional(
      v.object({
        register: v.string(),
        addresseeNumber: v.string(),
        speakerGender: v.string(),
        addresseeGender: v.string(),
      }),
    ),
    schedulePrepareCard: v.boolean(),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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

    await ctx.db.patch(args.textId, {
      audioSpeakerGender,
      ...(args.metadata
        ? {
            register: args.metadata.register,
            addresseeNumber: args.metadata.addresseeNumber,
            speakerGender: args.metadata.speakerGender,
            addresseeGender: args.metadata.addresseeGender,
          }
        : {}),
    });

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
  },
});
