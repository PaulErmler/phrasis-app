import { v } from 'convex/values';
import { generateText } from 'ai';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { OPENROUTER_MODELS } from '../config/aiModels';
import { getOpenRouter } from '../lib/openrouter';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../lib/posthogAi';
import { trackException } from '../analytics';
import {
  buildRenderingClassifierPrompt,
  buildRenderingClassifierUserPrompt,
  classificationLanguageForRow,
  parseRenderingClassifications,
  renderingAxesFor,
} from '../lib/renderingClassifier';
import { renderedGenderValidator, renderedPolitenessValidator } from '../types';

/**
 * Stamps `translations.renderedGender` / `renderedPoliteness`: what a stored
 * wording actually is. Two callers: the content sweep, lazily, for rows
 * from before the feature (`flushRenderingStamps` in
 * convex/lib/contentScheduling.ts, batched per ensure pass), and the
 * translation store paths, for every row generated from now on. Prompt
 * and parser live in convex/lib/renderingClassifier.ts.
 *
 * One LLM call classifies up to `MAX_ROWS_PER_CALL` rows of ONE language;
 * rows the model skips or answers badly stay unstamped (no chip) and the
 * next sweep after the request cooldown asks again.
 */
export const MAX_ROWS_PER_CALL = 25;

type ClassificationRow = {
  _id: Id<'translations'>;
  targetLanguage: string;
  regionVariant?: string;
  translatedText: string;
  alreadyStamped: boolean;
};

export const getRowsForClassification = internalQuery({
  args: { translationIds: v.array(v.id('translations')) },
  returns: v.array(
    v.object({
      _id: v.id('translations'),
      targetLanguage: v.string(),
      regionVariant: v.optional(v.string()),
      translatedText: v.string(),
      alreadyStamped: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.translationIds) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      out.push({
        _id: row._id,
        targetLanguage: row.targetLanguage,
        regionVariant: row.regionVariant,
        translatedText: row.translatedText,
        alreadyStamped:
          row.renderedGender !== undefined &&
          row.renderedPoliteness !== undefined,
      });
    }
    return out;
  },
});

export const stampRenderings = internalMutation({
  args: {
    stamps: v.array(
      v.object({
        translationId: v.id('translations'),
        renderedGender: renderedGenderValidator,
        renderedPoliteness: renderedPolitenessValidator,
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let written = 0;
    for (const stamp of args.stamps) {
      const row = await ctx.db.get(stamp.translationId);
      if (!row) continue;
      await ctx.db.patch(stamp.translationId, {
        renderedGender: stamp.renderedGender,
        renderedPoliteness: stamp.renderedPoliteness,
      });
      written++;
    }
    return written;
  },
});

/**
 * Classify and stamp a set of translation rows that share one language.
 * Rows of other languages, rows already stamped and rows of a language that
 * marks neither axis are skipped. Returns how many rows were stamped.
 */
export const classifyAndStampTranslations = internalAction({
  args: {
    translationIds: v.array(v.id('translations')),
    // Attribution for the cost event; absent = the content-pipeline bucket.
    userId: v.optional(v.string()),
    // Skip rows that already carry stamps (the backfill); the variant store
    // path passes false to restamp a regenerated wording.
    skipStamped: v.optional(v.boolean()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    // Same-file references need explicit result types (TypeScript
    // circularity through the generated `internal` object).
    const rows: ClassificationRow[] = await ctx.runQuery(
      internal.features.renderingClassification.getRowsForClassification,
      { translationIds: args.translationIds },
    );
    const candidates = rows.filter(
      (row) => !(args.skipStamped ?? true) || !row.alreadyStamped,
    );
    if (candidates.length === 0) return 0;
    const language = classificationLanguageForRow(candidates[0]);
    const axes = renderingAxesFor(language);
    if (!axes.gender && !axes.politeness) return 0;
    const batch = candidates
      .filter((row) => classificationLanguageForRow(row) === language)
      .slice(0, MAX_ROWS_PER_CALL);
    try {
      const openrouter = getOpenRouter();
      const startedAt = Date.now();
      const { text, usage, providerMetadata } = await generateText({
        model: openrouter(OPENROUTER_MODELS.renderingClassifier),
        system: buildRenderingClassifierPrompt(language),
        prompt: buildRenderingClassifierUserPrompt(
          batch.map((row) => row.translatedText),
        ),
        temperature: 0,
      });
      await captureGeneration(ctx, {
        distinctId: args.userId,
        feature: 'rendering_classifier',
        model: OPENROUTER_MODELS.renderingClassifier,
        provider: 'openrouter',
        latencyMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        costUsd: openrouterCostUsd(providerMetadata),
        traceId: openrouterGenerationId(providerMetadata),
        sharedContent: true,
        extra: { language, rows: batch.length },
      });
      const parsed = parseRenderingClassifications(
        language,
        text,
        batch.length,
      );
      const stamps = batch.flatMap((row, i) => {
        const result = parsed[i];
        return result
          ? [
              {
                translationId: row._id,
                renderedGender: result.gender,
                renderedPoliteness: result.politeness,
              },
            ]
          : [];
      });
      if (stamps.length === 0) return 0;
      const written: number = await ctx.runMutation(
        internal.features.renderingClassification.stampRenderings,
        { stamps },
      );
      return written;
    } catch (error) {
      await trackException(ctx, error, args.userId, {
        source: 'classifyAndStampTranslations',
        language,
        rows: batch.length,
      });
      throw error;
    }
  },
});
