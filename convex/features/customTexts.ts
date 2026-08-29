import { v, ConvexError } from 'convex/values';
import {
  action,
  mutation,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { requireAuthUserId, getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getOrCreateCustomCollection } from '../db/collections';
import { consumeQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import {
  MAX_CARD_TEXT_LENGTH,
  MAX_IMPORT_BATCH,
} from '../../lib/constants/learning';
import {
  getTranslationSource,
  isMixedLanguage,
  postProcessTranslation,
  resolveMixedVariant,
} from '../../lib/languages';
import { USER_PROVIDED_TRANSLATION_SOURCE } from '../../lib/translationProvenance';
import { trackEvent } from '../db/stats/dailyStats';
import { isValidTimezone } from '../lib/dateUtils';
import { generateText } from 'ai';
import { OPENROUTER_MODELS } from '../config/aiModels';
import { getOpenRouter } from '../lib/openrouter';
import {
  AUTOFILL_REASONING,
  AUTOFILL_SYSTEM_PROMPT,
  autofillMaxOutputTokens,
  autofillProviderOptions,
  buildAutofillUserPrompt,
  parseAutofillResponse,
} from '../lib/translationAutofillPrompt';
import { EVENTS, track } from '../analytics';
import { sourcedTranslationEntriesValidator } from '../types';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../lib/posthogAi';
import { resolveAudioSpeakerGender } from '../../lib/languages';

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
  returns: v.union(
    v.null(),
    v.object({ allowedLanguages: v.array(v.string()) }),
  ),
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

// Reasoning, output cap, system prompt, user-prompt builder, and response
// parsing all live in convex/lib/translationAutofillPrompt.ts so
// scripts/eval-translation-autofill.ts exercises the exact production
// request. This action owns auth, quota, language validation, mixed-dialect
// resolution, and persistence plumbing.

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
  addressesSomeone: v.boolean(),
});

export const autoFillTranslations = action({
  args: {
    texts: v.array(v.object({ language: v.string(), text: v.string() })),
    targetLanguages: v.array(v.string()),
  },
  returns: v.object({
    // Provenance fields (`regionVariant`, `translationSource`) are plumbed
    // back to `createCustomText` for persistence. See the validator's doc
    // in convex/types.ts.
    translations: sourcedTranslationEntriesValidator,
    metadata: sentenceMetadataValidator,
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    if (args.texts.length === 0) {
      throw new ConvexError({
        code: 'INVALID_ARGUMENT',
        message: 'At least one source text is required',
      });
    }

    const courseCtx = await ctx.runQuery(
      internal.features.customTexts.getAllowedLanguagesForAutoFill,
      { userId },
    );
    if (!courseCtx) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'No active course found',
      });
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
        throw new ConvexError({
          code: 'EMPTY_TEXT',
          message: 'Source texts must be non-empty',
          language: entry.language,
        });
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
      throw new ConvexError({
        code: 'INVALID_ARGUMENT',
        message: 'At least one target language is required for auto-fill',
      });
    }

    await ctx.runMutation(internal.features.customTexts.consumeAutoFillQuota, {
      userId,
    });

    // Resolve mixed-dialect targets (today: `es_mixed`) to a concrete
    // sub-code BEFORE building the prompt. The LLM never sees the mixed
    // sentinel; it gets a real regional code (`es`, `es_latam`) and an
    // accurate regional prompt label. The seed is the source text(s) so the
    // choice is deterministic for the same input across retries. The returned
    // `regionVariant` is plumbed back to `createCustomText` so the persisted
    // translations row agrees with the LLM's actual output, mirroring the
    // deck-card path in `processLlmTranslationForCard`.
    const variantSeed = args.texts
      .map((t) => `${t.language}:${t.text}`)
      .join('\n');
    type Resolved = { resolved: string; regionVariant?: string };
    const resolutionByRequested = new Map<string, Resolved>();
    for (const code of targetLanguages) {
      if (isMixedLanguage(code)) {
        const r = resolveMixedVariant(code, variantSeed);
        if (r) {
          resolutionByRequested.set(code, {
            resolved: r.subCode,
            regionVariant: r.regionVariant,
          });
          continue;
        }
      }
      resolutionByRequested.set(code, { resolved: code });
    }

    const userPrompt = buildAutofillUserPrompt({
      texts: args.texts,
      resolvedTargets: targetLanguages.map(
        (code) => resolutionByRequested.get(code)!.resolved,
      ),
    });

    const openrouter = getOpenRouter();

    const startedAt = Date.now();
    const { text, usage, providerMetadata } = await generateText({
      model: openrouter(OPENROUTER_MODELS.translationAutoFill),
      system: AUTOFILL_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxOutputTokens: autofillMaxOutputTokens(targetLanguages.length),
      // Reasoning + Luna price cap via the shared prompt module so `'none'`
      // is correctly sent as `reasoning: {enabled: false}`.
      providerOptions: autofillProviderOptions(),
    });

    // Billed as a flat 1 unit of `translation_auto_fill` regardless of how many
    // languages were requested, so the real cost only becomes visible here.
    await captureGeneration(ctx, {
      distinctId: userId,
      feature: 'translation_autofill',
      model: OPENROUTER_MODELS.translationAutoFill,
      provider: 'openrouter',
      latencyMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: openrouterCostUsd(providerMetadata),
      traceId: openrouterGenerationId(providerMetadata),
      extra: {
        target_language_count: targetLanguages.length,
        target_languages: targetLanguages,
      },
    });

    let parsed: ReturnType<typeof parseAutofillResponse>;
    try {
      parsed = parseAutofillResponse(text);
    } catch (err) {
      throw new ConvexError({
        code: 'UPSTREAM_ERROR',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to parse translation response',
      });
    }

    // Source identifier for every translation in this batch. Single LLM
    // call, so every row gets the same tag.
    const translationSource = getTranslationSource(
      OPENROUTER_MODELS.translationAutoFill,
      AUTOFILL_REASONING,
    );

    const results: {
      language: string;
      text: string;
      regionVariant?: string;
      translationSource?: string;
    }[] = [];
    for (const lang of targetLanguages) {
      const { resolved, regionVariant } = resolutionByRequested.get(lang)!;
      // The LLM keys its response by the codes we passed in (resolved sub-
      // codes for mixed dialects). Fall back to the original requested code
      // for resilience against a model that ignored the substitution.
      const translation =
        parsed.translations[resolved] ?? parsed.translations[lang];
      if (typeof translation !== 'string' || translation.trim().length === 0) {
        throw new ConvexError({
          code: 'UPSTREAM_ERROR',
          message: `Missing translation for language: ${lang}`,
        });
      }
      results.push({
        language: lang,
        // LLM output. Run the language's post-processing step (default:
        // strip trailing '_' runs) before the client round-trip stores it.
        text: postProcessTranslation(resolved, translation.trim()),
        ...(regionVariant ? { regionVariant } : {}),
        translationSource,
      });
    }

    // Metadata was validated inside parseAutofillResponse.
    return { translations: results, metadata: parsed.metadata };
  },
});

/**
 * Validate a set of translations against the active course's language set.
 *
 * Checks, in order: the provided languages cover exactly the course's
 * base ∪ target languages (no missing, no extras, no duplicates), then each
 * entry's text is non-empty and within MAX_CARD_TEXT_LENGTH. Returns the
 * first failure (or null if valid) so callers choose their own failure mode:
 * `createCustomText` throws a ConvexError with the full payload, while
 * `createCustomTextsBatch` reports `{ code, message }` in its `skipped` list.
 */
function validateTranslationSet(
  course: { baseLanguages: string[]; targetLanguages: string[] },
  translations: { language: string; text: string }[],
):
  | { code: 'INVALID_LANGUAGES'; message: string }
  | { code: 'EMPTY_TEXT'; message: string; language: string }
  | {
      code: 'TEXT_TOO_LONG';
      message: string;
      language: string;
      maxLength: number;
    }
  | null {
  const requiredLanguages = [
    ...new Set([...course.baseLanguages, ...course.targetLanguages]),
  ];
  const providedLanguages = translations.map((t) => t.language);

  const missing = requiredLanguages.filter(
    (lang) => !providedLanguages.includes(lang),
  );
  const extras = providedLanguages.filter(
    (lang) => !requiredLanguages.includes(lang),
  );
  if (
    missing.length > 0 ||
    extras.length > 0 ||
    new Set(providedLanguages).size !== providedLanguages.length
  ) {
    return {
      code: 'INVALID_LANGUAGES',
      message: `Translations must cover exactly the course languages. Missing: ${JSON.stringify(missing)}. Extra: ${JSON.stringify(extras)}.`,
    };
  }

  for (const { language, text } of translations) {
    if (text.length === 0) {
      return {
        code: 'EMPTY_TEXT',
        message: `Empty text for language "${language}".`,
        language,
      };
    }
    if (text.length > MAX_CARD_TEXT_LENGTH) {
      return {
        code: 'TEXT_TOO_LONG',
        message: `Text for language "${language}" exceeds the maximum length of ${MAX_CARD_TEXT_LENGTH} characters.`,
        language,
        maxLength: MAX_CARD_TEXT_LENGTH,
      };
    }
  }

  return null;
}

/**
 * Create a custom text entry with translations for all course languages.
 */
export const createCustomText = mutation({
  args: {
    translations: sourcedTranslationEntriesValidator,
    timezone: v.string(),
    metadata: v.optional(sentenceMetadataValidator),
  },
  returns: v.object({
    textId: v.id('texts'),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError('Not authenticated');

    if (!isValidTimezone(args.timezone)) {
      throw new ConvexError({
        code: 'INVALID_TIMEZONE',
        message: `Invalid IANA timezone: "${args.timezone}".`,
      });
    }

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active)
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'No active course found',
      });
    const { course } = active;

    const validationError = validateTranslationSet(course, args.translations);
    if (validationError) {
      throw new ConvexError(validationError);
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
            addressesSomeone: args.metadata.addressesSomeone,
            // Coin-flip at insert time so gendered-noun agreement is stable
            // across all target-language translations of this row. Mirrors the
            // logic in applyMetadataAndPrepareCard for the non-auto-fill path.
            referentGender: Math.random() < 0.5 ? 'male' : 'female',
            audioSpeakerGender: resolveAudioSpeakerGender(
              args.metadata.speakerGender,
            ),
          }
        : {}),
    });

    for (let i = 1; i < args.translations.length; i++) {
      const entry = args.translations[i];
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: entry.language,
        translatedText: entry.text,
        ...(entry.regionVariant ? { regionVariant: entry.regionVariant } : {}),
        // The client tags autofilled entries with the model slug and
        // everything else as user-provided (EnterTextsView). Default here
        // rather than trusting that: an entry with no tag reached us from a
        // form the user typed into, so `user-provided` is the honest
        // provenance, and an untagged row would otherwise read as machine
        // output to every provenance guard.
        translationSource:
          entry.translationSource ?? USER_PROVIDED_TRANSLATION_SOURCE,
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
          requestedByUserId: userId,
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
          userId,
        },
      );
    }

    // Track manual card creation event
    await trackEvent(ctx, {
      userId,
      courseId: course._id,
      timezone: args.timezone,
      field: 'cardsAddedManually',
    });
    await track(ctx, userId, EVENTS.CARDS_ADDED, {
      count: 1,
      source: 'manual',
    });

    return { textId };
  },
});

/**
 * Create many custom texts in a single transaction. Used by the bulk-import
 * UI. Each item must cover the course's base + target languages exactly.
 *
 * Partial-success semantics: items that fail per-item validation (bad
 * language set, over-length text) are reported in `skipped` rather than
 * aborting the whole batch. Quota is consumed only for accepted items.
 * Authentication, course membership, and the USAGE_LIMIT check are still
 * hard errors. The client is expected to pre-check quota.
 */
export const createCustomTextsBatch = mutation({
  args: {
    items: v.array(
      v.object({
        translations: v.array(
          v.object({ language: v.string(), text: v.string() }),
        ),
      }),
    ),
    timezone: v.string(),
  },
  returns: v.object({
    createdTextIds: v.array(v.id('texts')),
    skipped: v.array(
      v.object({
        index: v.number(),
        code: v.string(),
        message: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError('Not authenticated');

    if (!isValidTimezone(args.timezone)) {
      throw new ConvexError({
        code: 'INVALID_TIMEZONE',
        message: `Invalid IANA timezone: "${args.timezone}".`,
      });
    }

    if (args.items.length === 0) {
      throw new ConvexError({
        code: 'BATCH_EMPTY',
        message: 'No items provided for import.',
      });
    }
    if (args.items.length > MAX_IMPORT_BATCH) {
      throw new ConvexError({
        code: 'BATCH_TOO_LARGE',
        message: `Batch exceeds maximum of ${MAX_IMPORT_BATCH} items.`,
        maxBatch: MAX_IMPORT_BATCH,
      });
    }

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active)
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'No active course found',
      });
    const { course } = active;

    const skipped: { index: number; code: string; message: string }[] = [];
    const accepted: {
      index: number;
      translations: { language: string; text: string }[];
    }[] = [];

    for (let i = 0; i < args.items.length; i++) {
      const { translations } = args.items[i];
      const validationError = validateTranslationSet(course, translations);
      if (validationError) {
        skipped.push({
          index: i,
          code: validationError.code,
          message: validationError.message,
        });
        continue;
      }
      accepted.push({ index: i, translations });
    }

    if (accepted.length === 0) {
      return { createdTextIds: [], skipped };
    }

    // Quota is authoritative here. Client pre-check is advisory.
    await consumeQuota(
      ctx,
      userId,
      FEATURE_IDS.CUSTOM_SENTENCES,
      accepted.length,
    );

    const collection = await getOrCreateCustomCollection(ctx, course._id);
    const baseRank = collection.textCount;

    const createdTextIds: Id<'texts'>[] = [];

    for (let i = 0; i < accepted.length; i++) {
      const { translations } = accepted[i];
      const mainEntry = translations[0];
      const rank = baseRank + i + 1;

      const textId = await ctx.db.insert('texts', {
        text: mainEntry.text,
        language: mainEntry.language,
        userCreated: true,
        userId,
        collectionId: collection._id,
        collectionRank: rank,
      });

      for (let j = 1; j < translations.length; j++) {
        const entry = translations[j];
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: entry.language,
          translatedText: entry.text,
          // Bulk-import is exclusively manual, no autofill path here, so
          // every inserted translation is user-typed. Tag it explicitly so
          // a future strategy swap doesn't regenerate text the user wrote.
          translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
        });
      }

      createdTextIds.push(textId);

      // Pure-manual path: generate metadata first, which then schedules
      // prepareCardContent. Mirrors createCustomText's no-metadata branch,
      // except TTS/LLM ride the background pools: a bulk paste must not
      // queue ahead of audio the user is currently reviewing.
      await ctx.scheduler.runAfter(
        0,
        internal.features.sentenceMetadata.generateSentenceMetadata,
        {
          textId,
          translations,
          schedulePrepareCard: true,
          baseLanguages: course.baseLanguages,
          targetLanguages: course.targetLanguages,
          userId,
          priority: 'background',
          llmPriority: 'background',
        },
      );
    }

    await ctx.db.patch(collection._id, {
      textCount: collection.textCount + accepted.length,
    });

    // Track all accepted items in a single daily + total counter bump.
    await trackEvent(ctx, {
      userId,
      courseId: course._id,
      timezone: args.timezone,
      field: 'cardsAddedManually',
      count: accepted.length,
    });

    // `skipped` is the interesting half: a high skip rate means the import
    // parser is rejecting what people actually paste.
    await track(ctx, userId, EVENTS.CARDS_ADDED, {
      count: accepted.length,
      skipped: skipped.length,
      source: 'bulk_import',
    });

    return { createdTextIds, skipped };
  },
});
