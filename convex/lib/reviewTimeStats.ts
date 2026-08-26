import { Doc } from '../_generated/dataModel';

/**
 * Per-card running time-per-review averages (`cards.reviewTimeStats`).
 *
 * One sample is folded per graded review that reports `timeSpentMs`, keyed by
 * the review's MODE ('audio' | 'full', same 'audio' default as
 * reviewCountByMode / statsReversal.reviewModeForStats), independent of which
 * track it wrote. Samples are clamped exactly like the daily-stats time
 * accounting so the two series stay comparable; the raw value is preserved in
 * `reviewHistory.timeSpentMs`, which is also what drives the exact arithmetic
 * reversal on undo (re-apply the same clamp, subtract from the mean).
 */

/** Hard cap per review time sample. Shared with recordReviewStats' daily time
 * accounting so a card left open (phone locked, tab abandoned) skews neither
 * series. */
export const REVIEW_TIME_CLAMP_MAX_MS = 180_000; // 3 minutes

export type ReviewTimeMode = 'audio' | 'full';
type ReviewTimeStats = NonNullable<Doc<'cards'>['reviewTimeStats']>;
type ReviewTimeStatsPatch = Partial<Pick<Doc<'cards'>, 'reviewTimeStats'>>;

export function clampReviewTimeMs(raw: number): number {
  return Math.min(Math.max(raw, 0), REVIEW_TIME_CLAMP_MAX_MS);
}

/**
 * Patch fragment folding one timed review into the card's running per-mode
 * average (cumulative mean; `count` kept so undo can reverse exactly and a
 * later switch to EMA stays possible). Empty patch when the review carried no
 * timing.
 */
export function reviewTimeApplyPatch(
  card: Doc<'cards'>,
  mode: ReviewTimeMode,
  timeSpentMs: number | undefined,
): ReviewTimeStatsPatch {
  if (timeSpentMs === undefined) return {};
  const t = clampReviewTimeMs(timeSpentMs);
  const stats: ReviewTimeStats = card.reviewTimeStats ?? {};
  const entry = stats[mode];
  const next = entry
    ? {
        avgMs: entry.avgMs + (t - entry.avgMs) / (entry.count + 1),
        count: entry.count + 1,
      }
    : { avgMs: t, count: 1 };
  return { reviewTimeStats: { ...stats, [mode]: next } };
}

/**
 * Exact reversal of `reviewTimeApplyPatch` for undo, driven by the undone
 * review's history row (raw `timeSpentMs`, re-clamped identically). The last
 * sample of a mode removes that mode's entry entirely, returning the card to
 * its pre-first-timed-review shape. Empty patch when there is nothing to
 * reverse (untimed review, or the counter was reset/migrated in between —
 * mirrors reviewCountUndoPatch's defensiveness).
 */
export function reviewTimeUndoPatch(
  card: Doc<'cards'>,
  history: Doc<'reviewHistory'>,
): ReviewTimeStatsPatch {
  if (history.timeSpentMs === undefined) return {};
  const stats = card.reviewTimeStats;
  const mode: ReviewTimeMode = history.reviewMode ?? 'audio';
  const entry = stats?.[mode];
  if (!stats || !entry) return {};
  if (entry.count <= 1) {
    const { [mode]: _removed, ...rest } = stats;
    return { reviewTimeStats: rest };
  }
  const t = clampReviewTimeMs(history.timeSpentMs);
  return {
    reviewTimeStats: {
      ...stats,
      [mode]: {
        avgMs: (entry.avgMs * entry.count - t) / (entry.count - 1),
        count: entry.count - 1,
      },
    },
  };
}
