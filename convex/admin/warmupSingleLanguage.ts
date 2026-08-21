import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';

/**
 * One-shot warmup for a single target language: combines the work of
 * `warmupPlacementTranslations` and `warmupCourseLevels` for one language
 * code. Pre-populates placement-test translations + audio AND the first 5
 * sentences of every level collection, with `en` as the source.
 *
 * Use case: a new language has just been added to `SUPPORTED_LANGUAGES`, or
 * a single language is showing gaps in its content and you want to backfill
 * it without re-paying the full all-languages sweep.
 *
 * Schedules (all immediate, except the 60s backstop):
 *   1. `enqueueMissingPlacementTranslations` (priority 2: user-facing)
 *   2. `ensureFirstSentencesAcrossLevelCollections`
 *   3. `ensureAudioForTestTranslations` at +60s (backstop sweep)
 *
 * Rate limiting is handled downstream by `convex/rateLimiter.ts` (per-provider
 * token buckets). With ~200 TTS jobs for a single language this completes in
 * ~1.5 minutes under the Google TTS 150/min cap, assuming no contention.
 *
 * Validation: rejects English-family codes (`en*`), the source content is
 * already in English. Rejects unknown codes against `SUPPORTED_LANGUAGES` so
 * a typo doesn't silently no-op.
 *
 * Fully idempotent: rows that already have translations + audio are skipped.
 *
 * Trigger from the Convex dashboard:
 *   `internal/admin/warmupSingleLanguage:run` with `{ targetLanguage: "de" }`
 */

const WARMUP_SOURCE_LANGUAGE = 'en';
const WARMUP_AUDIO_BACKSTOP_DELAY_MS = 60_000;
// ~100 placement-test + ~100 level-warmup TTS jobs for a single language.
const WARMUP_TTS_JOBS = 200;
const WARMUP_GOOGLE_TTS_RATE_PER_MINUTE = 150;

export const run = internalMutation({
  args: {
    targetLanguage: v.string(),
  },
  returns: v.object({
    targetLanguage: v.string(),
    estimatedDurationMinutes: v.number(),
  }),
  handler: async (ctx, { targetLanguage }) => {
    if (targetLanguage.startsWith('en')) {
      throw new Error(
        `warmupSingleLanguage: refusing to warm '${targetLanguage}' — source content is already in English.`,
      );
    }
    const known = SUPPORTED_LANGUAGES.some((l) => l.code === targetLanguage);
    if (!known) {
      throw new Error(
        `warmupSingleLanguage: '${targetLanguage}' is not in SUPPORTED_LANGUAGES.`,
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.features.collections.ensureFirstSentencesAcrossLevelCollections,
      {
        baseLanguages: [WARMUP_SOURCE_LANGUAGE],
        targetLanguages: [targetLanguage],
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.features.onboarding.enqueueMissingPlacementTranslations,
      { sourceLanguage: WARMUP_SOURCE_LANGUAGE, targetLanguage },
    );
    await ctx.scheduler.runAfter(
      WARMUP_AUDIO_BACKSTOP_DELAY_MS,
      internal.features.onboarding.ensureAudioForTestTranslations,
      { targetLanguage, sourceLanguage: WARMUP_SOURCE_LANGUAGE },
    );

    return {
      targetLanguage,
      estimatedDurationMinutes: Math.ceil(
        WARMUP_TTS_JOBS / WARMUP_GOOGLE_TTS_RATE_PER_MINUTE,
      ),
    };
  },
});
