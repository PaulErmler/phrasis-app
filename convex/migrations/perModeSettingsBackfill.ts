import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
} from '../../lib/constants/audioPlayback';

const BATCH_SIZE = 100;

/**
 * Backfill for the per-mode playback-settings split (see
 * docs/migrations/per-mode-settings-backfill.md).
 *
 * Deployment does NOT depend on this migration: writing mode reads
 * `*Full ?? <audio field> ?? DEFAULT_*`, so unmigrated docs behave identically
 * in both modes. Running it stamps every courseSettings doc with:
 *
 * - The writing-mode (`*Full`) fields, copied from the doc's current
 *   *effective* audio values — after which the `?? <audio field>` fallback
 *   branch in reads becomes dead code and can be removed.
 * - Explicit `playTargetBeforeBase` / `playTargetAfterBase` /
 *   `targetBeforeOnlyNewReps` where undefined, freezing existing users on
 *   today's read-side defaults — after which the DEFAULT_* constants could be
 *   flipped to the new-user values instead of stamping them at insert time
 *   (convex/db/courseSettings.ts).
 *
 * Idempotent (per-field `undefined` guards) and re-runnable; each batch is its
 * own transaction, so a concurrent user write either lands before the batch
 * (its value is respected) or conflicts and retries it.
 *
 * Run from the dashboard or CLI:
 *   npx convex run migrations/perModeSettingsBackfill:run
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('courseSettings')
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    let patched = 0;
    for (const doc of result.page) {
      const patch: Record<string, unknown> = {};

      // Writing-mode copies of the audio playback settings.
      if (doc.highlightWordsFull === undefined && doc.highlightWords !== undefined) {
        patch.highlightWordsFull = doc.highlightWords;
      }
      if (doc.autoPlayAudioFull === undefined) {
        patch.autoPlayAudioFull = doc.autoPlayAudio ?? DEFAULT_AUTO_PLAY;
      }
      if (doc.languageRepetitionsFull === undefined && doc.languageRepetitions !== undefined) {
        patch.languageRepetitionsFull = doc.languageRepetitions;
      }
      if (doc.languageRepetitionPausesFull === undefined && doc.languageRepetitionPauses !== undefined) {
        patch.languageRepetitionPausesFull = doc.languageRepetitionPauses;
      }
      if (doc.languagePlaybackSpeedsFull === undefined && doc.languagePlaybackSpeeds !== undefined) {
        patch.languagePlaybackSpeedsFull = doc.languagePlaybackSpeeds;
      }
      if (doc.pauseBaseToBaseFull === undefined) {
        patch.pauseBaseToBaseFull = doc.pauseBaseToBase ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
      }
      if (doc.pauseBaseToTargetFull === undefined) {
        patch.pauseBaseToTargetFull = doc.pauseBaseToTarget ?? DEFAULT_PAUSE_BASE_TO_TARGET;
      }
      if (doc.pauseTargetToTargetFull === undefined) {
        patch.pauseTargetToTargetFull = doc.pauseTargetToTarget ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
      }
      if (doc.pauseBeforeAutoAdvanceFull === undefined) {
        patch.pauseBeforeAutoAdvanceFull = doc.pauseBeforeAutoAdvance ?? DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE;
      }

      // Freeze today's Practice Listening defaults for existing users.
      if (doc.playTargetBeforeBase === undefined) patch.playTargetBeforeBase = false;
      if (doc.playTargetAfterBase === undefined) patch.playTargetAfterBase = true;
      if (doc.targetBeforeOnlyNewReps === undefined) patch.targetBeforeOnlyNewReps = 0; // 0 = ∞ (always)

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(doc._id, patch);
        patched++;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.perModeSettingsBackfill.run,
        { cursor: result.continueCursor },
      );
    }

    return { processed: result.page.length, patched, isDone: result.isDone };
  },
});
