import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';

/**
 * One-shot warmup: pre-populate the first 5 sentences of every level
 * collection with translations + audio into every non-English target language
 * in `SUPPORTED_LANGUAGES`, regardless of which language pairs are currently
 * in use across `courses`.
 *
 * For each target we schedule `ensureFirstSentencesAcrossLevelCollections`
 * with `en` as the source and that target as the only target language. That
 * mutation fans out one child per level collection so each runs in its own
 * transaction (the inline version exceeded Convex's ~15s per-mutation
 * wallclock once the dataset grew to ~20 levels × 5 texts × multi-language
 * storage checks).
 *
 * English-family targets (`en`, `en_gb`, …) are skipped. Curriculum texts
 * are stored in English and there's nothing to translate.
 *
 * Rate limiting is handled downstream by `convex/rateLimiter.ts` (per-provider
 * token buckets) and the priority queue in TTS dispatch: user-facing TTS
 * (priority 1/2) jumps ahead of warmup work (priority 0). If running
 * concurrently with `warmupPlacementTranslations`, total queue time roughly
 * doubles but both still respect the shared `googleTts` 150/min cap.
 *
 * Fully idempotent: re-running only re-reads rows that already have
 * translations + audio.
 *
 * Trigger from the Convex dashboard:
 *   `internal/admin/warmupCourseLevels:run`
 */

const WARMUP_SOURCE_LANGUAGE = 'en';
// ~20 level collections × 5 sentences × translation+TTS per language. Used
// only to compute an informational ETA. Actual throughput is bounded by the
// `googleTts` token-bucket rate in `convex/rateLimiter.ts`.
const WARMUP_TTS_JOBS_PER_LANGUAGE = 100;
const WARMUP_GOOGLE_TTS_RATE_PER_MINUTE = 150;

export const run = internalMutation({
  args: {},
  returns: v.object({
    targetLanguagesScheduled: v.number(),
    estimatedDurationMinutes: v.number(),
  }),
  handler: async (ctx) => {
    const targetLanguages = SUPPORTED_LANGUAGES.map((l) => l.code).filter(
      (code) => !code.startsWith('en'),
    );

    for (const targetLanguage of targetLanguages) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.collections
          .ensureFirstSentencesAcrossLevelCollections,
        {
          baseLanguages: [WARMUP_SOURCE_LANGUAGE],
          targetLanguages: [targetLanguage],
        },
      );
    }

    const totalTtsJobs = targetLanguages.length * WARMUP_TTS_JOBS_PER_LANGUAGE;
    return {
      targetLanguagesScheduled: targetLanguages.length,
      estimatedDurationMinutes: Math.ceil(
        totalTtsJobs / WARMUP_GOOGLE_TTS_RATE_PER_MINUTE,
      ),
    };
  },
});
