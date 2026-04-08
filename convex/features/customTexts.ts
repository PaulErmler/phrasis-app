import { v, ConvexError } from 'convex/values';
import { action, mutation, query, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import { requireAuthUserId, getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getOrCreateCustomCollection } from '../db/collections';
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { MAX_CARD_TEXT_LENGTH } from '../../lib/constants/learning';
import { getLanguageByCode } from '../../lib/languages';
import { trackEvent } from '../db/stats/dailyStats';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_MODELS } from '../config/aiModels';
import { resolveAudioSpeakerGender, getVoiceGenderByApiCode } from '../../lib/languages';
import { validateSentenceMetadata } from './sentenceMetadata';

export const consumeAutoFillQuota = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await consumeQuota(ctx, args.userId, FEATURE_IDS.TRANSLATION_AUTO_FILL, 1);
    return null;
  },
});

/** Allowed ISO codes for the user’s active course (base ∪ target). Used to validate auto-fill before quota / LLM. */
export const getAllowedLanguagesForAutoFill = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.null(), v.object({ allowedLanguages: v.array(v.string()) })),
  handler: async (ctx, { userId }) => {
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const { course } = active;
    const allowedLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];
    return { allowedLanguages };
  },
});

const TRANSLATION_SYSTEM_PROMPT = `You are an expert multilingual translator for a language-learning app. You will receive one or more sentences that the user has already written in specific languages, plus a list of target language codes that still need translations.

Translate the given sentence(s) into every requested target language AND return linguistic metadata describing the sentence.

TRANSLATION RULES:

1. NATURALNESS — Translate meaning, not words. Every translation must sound like it was written by a native speaker. Match the length, register, and complexity of the original.

2. REGISTER & FORMALITY — Infer the register (formal / informal / neutral) from the source text and apply it consistently to all translations.

3. GENDER — If the source text implies a speaker or addressee gender, maintain gender agreement in languages that mark it grammatically.

4. CONSISTENCY — All translations must express the exact same meaning, register, and tone. No translation may add or remove nuance.

5. REGIONAL VARIANTS (use exactly these):
   - es: Castilian Spanish as spoken in Spain (vosotros for informal plural, peninsular vocabulary)
   - fr: Metropolitan French (France)
   - pt: Brazilian Portuguese
   - zh: Simplified Chinese (Mandarin)
   - ar: Modern Standard Arabic (MSA / fuṣḥā)

6. LANGUAGE-SPECIFIC:
   - Japanese: match the formality of the source — informal → plain form (だ / する), formal → polite form (です / ます)
   - Korean: informal → 반말, formal → 해요체 or 합쇼체 as appropriate
   - Hindi: informal → तुम form, formal → आप form
   - Arabic: MSA grammar; infer masculine/feminine from context
   - Finnish: formal/informal distinction is minimal; focus on naturalness

METADATA RULES:

After producing the translations, infer linguistic metadata from the source AND your translations together. Use cross-lingual signals — if any translation requires gendered morphology referring to the speaker or addressee, that fixes the gender field.

- register: "formal" | "informal" | "neutral" — the politeness/formality of the sentence as a whole.
- addresseeNumber: "singular" | "plural" | "not_applicable" — how many people the sentence speaks to. "not_applicable" if the sentence has no addressee (e.g. "It is raining.").
- speakerGender: "male" | "female" | "neutral" — return "male" or "female" ONLY when at least one rendering grammatically marks the speaker's gender (Spanish/Italian/French/Portuguese past participles or adjectives, Russian/Polish/Czech past tense, Arabic/Hebrew/Hindi verb agreement, etc.). Otherwise return "neutral". Never guess from topic or stereotype.
- addresseeGender: "male" | "female" | "neutral" | "not_applicable" — same rule, for the addressee. "not_applicable" if there is no addressee.

OUTPUT FORMAT:

Return ONLY a valid JSON object with EXACTLY this shape, no markdown, no explanation:

{
  "translations": { "<lang_code>": "<translated string>", ... },
  "metadata": {
    "register": "...",
    "addresseeNumber": "...",
    "speakerGender": "...",
    "addresseeGender": "..."
  }
}

The "translations" object must contain exactly one key per requested target language. No extra keys, no missing keys.`;

/**
 * Auto-fill missing translations using Gemini via OpenRouter.
 */
const sentenceMetadataValidator = v.object({
  register: v.union(
    v.literal('formal'),
    v.literal('informal'),
    v.literal('neutral'),
  ),
  addresseeNumber: v.union(
    v.literal('singular'),
    v.literal('plural'),
    v.literal('not_applicable'),
  ),
  speakerGender: v.union(
    v.literal('male'),
    v.literal('female'),
    v.literal('neutral'),
  ),
  addresseeGender: v.union(
    v.literal('male'),
    v.literal('female'),
    v.literal('neutral'),
    v.literal('not_applicable'),
  ),
});

export const autoFillTranslations = action({
  args: {
    texts: v.array(v.object({ language: v.string(), text: v.string() })),
    targetLanguages: v.array(v.string()),
  },
  returns: v.object({
    translations: v.array(v.object({ language: v.string(), text: v.string() })),
    metadata: sentenceMetadataValidator,
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    if (args.texts.length === 0) {
      throw new ConvexError('At least one source text is required');
    }

    const courseCtx = await ctx.runQuery(
      internal.features.customTexts.getAllowedLanguagesForAutoFill,
      { userId },
    );
    if (!courseCtx) {
      throw new ConvexError('No active course found');
    }
    const allowed = new Set(courseCtx.allowedLanguages);

    const sourceLangs = new Set<string>();
    for (const entry of args.texts) {
      if (!allowed.has(entry.language)) {
        throw new ConvexError({
          code: 'INVALID_LANGUAGES',
          message: `Language "${entry.language}" is not in the active course.`,
        });
      }
      if (entry.text.trim().length === 0) {
        throw new ConvexError('Source texts must be non-empty');
      }
      sourceLangs.add(entry.language);
    }

    const targetLanguages = [...new Set(args.targetLanguages)];
    for (const lang of targetLanguages) {
      if (!allowed.has(lang)) {
        throw new ConvexError({
          code: 'INVALID_LANGUAGES',
          message: `Target language "${lang}" is not in the active course.`,
        });
      }
      if (sourceLangs.has(lang)) {
        throw new ConvexError({
          code: 'INVALID_LANGUAGES',
          message: `Target language "${lang}" already has source text; remove it from targetLanguages.`,
        });
      }
    }

    if (targetLanguages.length === 0) {
      throw new ConvexError('At least one target language is required for auto-fill');
    }

    await ctx.runMutation(
      internal.features.customTexts.consumeAutoFillQuota,
      { userId },
    );

    const sourceDescription = args.texts
      .map((t) => {
        const lang = getLanguageByCode(t.language);
        return `[${lang?.name ?? t.language}]: ${t.text}`;
      })
      .join('\n');

    const targetList = targetLanguages
      .map((code) => {
        const lang = getLanguageByCode(code);
        return `${code}: ${lang?.name ?? code}`;
      })
      .join('\n');

    const userPrompt = `Source text(s):\n${sourceDescription}\n\nTranslate into these languages:\n${targetList}`;

    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const { text } = await generateText({
      model: openrouter(OPENROUTER_MODELS.translationAutoFill),
      system: TRANSLATION_SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: { translations?: Record<string, string>; metadata?: Record<string, unknown> };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new ConvexError('Failed to parse translation response');
    }

    if (!parsed.translations || typeof parsed.translations !== 'object') {
      throw new ConvexError('Translation response missing "translations" object');
    }
    if (!parsed.metadata || typeof parsed.metadata !== 'object') {
      throw new ConvexError('Translation response missing "metadata" object');
    }

    const results: { language: string; text: string }[] = [];
    for (const lang of targetLanguages) {
      const translation = parsed.translations[lang];
      if (typeof translation !== 'string' || translation.trim().length === 0) {
        throw new ConvexError(`Missing translation for language: ${lang}`);
      }
      results.push({ language: lang, text: translation.trim() });
    }

    let metadata;
    try {
      metadata = validateSentenceMetadata(parsed.metadata);
    } catch (err) {
      throw new ConvexError(
        err instanceof Error
          ? err.message
          : 'Invalid translation response metadata',
      );
    }

    return { translations: results, metadata };
  },
});

/**
 * Create a custom text entry with translations for all course languages.
 */
export const createCustomText = mutation({
  args: {
    translations: v.array(v.object({ language: v.string(), text: v.string() })),
    timezone: v.string(),
    metadata: v.optional(sentenceMetadataValidator),
  },
  returns: v.object({
    textId: v.id('texts'),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError('Not authenticated');

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) throw new ConvexError('No active course found');
    const { course } = active;

    const requiredLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];
    const providedLanguages = args.translations.map((t) => t.language);

    const missing = requiredLanguages.filter((lang) => !providedLanguages.includes(lang));
    const extras = providedLanguages.filter((lang) => !requiredLanguages.includes(lang));
    if (
      missing.length > 0 ||
      extras.length > 0 ||
      new Set(providedLanguages).size !== providedLanguages.length
    ) {
      throw new ConvexError({
        code: 'INVALID_LANGUAGES',
        message: `Translations must cover exactly the course languages. Missing: ${JSON.stringify(missing)}. Extra: ${JSON.stringify(extras)}.`,
      });
    }

    for (const { language, text } of args.translations) {
      if (text.length > MAX_CARD_TEXT_LENGTH) {
        throw new ConvexError({
          code: 'TEXT_TOO_LONG',
          message: `Text for language "${language}" exceeds the maximum length of ${MAX_CARD_TEXT_LENGTH} characters.`,
          language,
          maxLength: MAX_CARD_TEXT_LENGTH,
        });
      }
    }

    await consumeQuota(ctx, userId, FEATURE_IDS.CUSTOM_SENTENCES, 1);

    const collection = await getOrCreateCustomCollection(ctx, course._id);

    const mainEntry = args.translations[0];
    const nextRank = collection.textCount + 1;

    const textId = await ctx.db.insert('texts', {
      text: mainEntry.text,
      language: mainEntry.language,
      userCreated: true,
      userId,
      collectionId: collection._id,
      collectionRank: nextRank,
      ...(args.metadata
        ? {
            register: args.metadata.register,
            addresseeNumber: args.metadata.addresseeNumber,
            speakerGender: args.metadata.speakerGender,
            addresseeGender: args.metadata.addresseeGender,
            audioSpeakerGender: resolveAudioSpeakerGender(args.metadata.speakerGender),
          }
        : {}),
    });

    for (let i = 1; i < args.translations.length; i++) {
      const entry = args.translations[i];
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: entry.language,
        translatedText: entry.text,
      });
    }

    await ctx.db.patch(collection._id, {
      textCount: collection.textCount + 1,
    });

    if (args.metadata) {
      // Auto-fill flow already provided metadata; jump straight to content prep.
      await ctx.scheduler.runAfter(
        0,
        internal.features.decks.prepareCardContent,
        {
          textId,
          baseLanguages: course.baseLanguages,
          targetLanguages: course.targetLanguages,
        },
      );
    } else {
      // Pure manual flow: generate metadata first; that action will then schedule prepareCardContent.
      await ctx.scheduler.runAfter(
        0,
        internal.features.sentenceMetadata.generateSentenceMetadata,
        {
          textId,
          translations: args.translations,
          schedulePrepareCard: true,
          baseLanguages: course.baseLanguages,
          targetLanguages: course.targetLanguages,
        },
      );
    }

    // Track manual card creation event
    await trackEvent(ctx, { userId, courseId: course._id, timezone: args.timezone, field: 'cardsAddedManually' });

    return { textId };
  },
});

