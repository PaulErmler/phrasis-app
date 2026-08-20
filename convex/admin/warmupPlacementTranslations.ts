import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';

/**
 * One-shot warmup: translate + synthesize audio for every placement-test
 * sentence into every non-English target language in `SUPPORTED_LANGUAGES`,
 * regardless of which language pairs are currently in use across `courses`.
 *
 * For each target we schedule:
 *   1. `enqueueMissingPlacementTranslations`: enqueues LLM translations for
 *      every placement-test sentence (idempotent: skips rows already
 *      translated). The downstream pipeline triggers TTS automatically.
 *   2. `ensureAudioForTestTranslations` (60s delay): backstop sweep that
 *      re-runs `scheduleMissingContent` for any (sentence, language) pair
 *      where the first pass left a row without audio.
 *
 * English-family targets (`en`, `en_gb`, …) are skipped. Placement sentences
 * are stored in English and there's nothing to translate.
 *
 * Rate limiting is handled downstream by `convex/rateLimiter.ts` (per-provider
 * token buckets) and the priority queue in TTS dispatch: user-facing TTS
 * (priority 1/2) jumps ahead of warmup work (priority 0). Placement-test
 * translations enqueue at priority 2 because users may be on the screen
 * waiting. Keep that in mind if running concurrently with `warmupCourseLevels`.
 *
 * Fully idempotent: re-running this mutation only re-reads rows that already
 * have translations + audio.
 *
 * Trigger from the Convex dashboard:
 *   `internal/admin/warmupPlacementTranslations:run`
 */

const WARMUP_SOURCE_LANGUAGE = 'en';
const WARMUP_AUDIO_BACKSTOP_DELAY_MS = 60_000;
// ~100 placement-test sentences × translation+TTS per language. Used only
// to compute an informational ETA. Actual throughput is bounded by the
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
        internal.features.onboarding.enqueueMissingPlacementTranslations,
        { sourceLanguage: WARMUP_SOURCE_LANGUAGE, targetLanguage },
      );
      await ctx.scheduler.runAfter(
        WARMUP_AUDIO_BACKSTOP_DELAY_MS,
        internal.features.onboarding.ensureAudioForTestTranslations,
        { targetLanguage, sourceLanguage: WARMUP_SOURCE_LANGUAGE },
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
