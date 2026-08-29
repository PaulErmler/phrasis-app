'use client';

/**
 * Module-scope tally of what happened in the current learn session, split by
 * activity and surface so the session-end event can report where the time
 * went:
 *
 *   activity  'listening'     audio face (reviewMode 'audio')
 *             'translating'   writing face, writingInputMode 'translate'
 *             'transcribing'  writing face, writingInputMode 'transcribe'
 *   surface   'review'        FSRS-scheduled reviews (learn_new / learnAndReview)
 *             'radio'         free play (schedulingMode 'radio', both faces)
 *
 * The learn overlay (`useLearningMode`) submits reviews and free-play
 * advances; the session boundaries live in the main layout, which fires
 * `review_session_started` / `review_session_ended`. This module is the
 * thinnest bridge between the two: nothing fires per review (the granularity
 * rule in convex/analytics.ts stands), the tallies just ride the existing
 * session-end event as `reviews_count` plus one count and one time property
 * per (surface, activity) bucket.
 *
 * Module scope is safe here: one learn session exists per tab, and the
 * layout resets the tally on every path that opens a session. The standalone
 * `/app/learn` route renders LearnView outside the layout and is not wired
 * to these session events, so activity there is neither reported nor reset.
 */

export type ReviewActivity = 'listening' | 'translating' | 'transcribing';
export type ReviewSurface = 'review' | 'radio';

const ACTIVITIES: ReviewActivity[] = [
  'listening',
  'translating',
  'transcribing',
];
const SURFACES: ReviewSurface[] = ['review', 'radio'];

type BucketKey = `${ReviewSurface}_${ReviewActivity}`;

const bucketKey = (
  surface: ReviewSurface,
  activity: ReviewActivity,
): BucketKey => `${surface}_${activity}`;

let counts: Partial<Record<BucketKey, number>> = {};
let timeMs: Partial<Record<BucketKey, number>> = {};
/** FSRS reviews only — free-play advances are plays, not reviews. */
let reviewTotal = 0;

/** The activity currently being served, from the two course settings. */
export function reviewActivity(
  reviewMode: 'audio' | 'full',
  writingInputMode: 'translate' | 'transcribe',
): ReviewActivity {
  if (reviewMode === 'audio') return 'listening';
  return writingInputMode === 'transcribe' ? 'transcribing' : 'translating';
}

/**
 * Called by the learn overlay after each successfully persisted review or
 * free-play advance, with the per-card time the submit path already computes.
 */
export function recordReviewForSession(
  surface: ReviewSurface,
  activity: ReviewActivity,
  timeSpentMs: number,
): void {
  const key = bucketKey(surface, activity);
  counts[key] = (counts[key] ?? 0) + 1;
  timeMs[key] = (timeMs[key] ?? 0) + Math.max(0, timeSpentMs);
  if (surface === 'review') reviewTotal += 1;
}

/**
 * Called when a review is undone. Decrements the bucket's count but keeps
 * its time: the minutes were genuinely spent even if the rating was taken
 * back. Undo only exists for FSRS reviews, so the surface is always
 * 'review'.
 */
export function undoReviewForSession(activity: ReviewActivity): void {
  const key = bucketKey('review', activity);
  counts[key] = Math.max(0, (counts[key] ?? 0) - 1);
  reviewTotal = Math.max(0, reviewTotal - 1);
}

/** Reset at session start so an aborted previous session can't leak in. */
export function resetSessionReviewCount(): void {
  counts = {};
  timeMs = {};
  reviewTotal = 0;
}

/**
 * Flat property bag for `review_session_ended`: `reviews_count` (FSRS
 * reviews, back-compat) plus `<surface>_count_<activity>` and
 * `<surface>_time_<activity>_ms` for all six buckets, zeros included so
 * insights can sum them without null handling.
 */
export function getSessionReviewStats(): Record<string, number> {
  const stats: Record<string, number> = { reviews_count: reviewTotal };
  for (const surface of SURFACES) {
    for (const activity of ACTIVITIES) {
      const key = bucketKey(surface, activity);
      stats[`${surface}_count_${activity}`] = counts[key] ?? 0;
      stats[`${surface}_time_${activity}_ms`] = timeMs[key] ?? 0;
    }
  }
  return stats;
}
