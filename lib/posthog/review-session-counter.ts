'use client';

/**
 * Module-scope tally of reviews completed in the current learn session.
 *
 * The learn overlay (`useLearningMode`) submits reviews; the session
 * boundaries live in the main layout, which fires `review_session_started` /
 * `review_session_ended`. This counter is the thinnest bridge between the
 * two: nothing fires per review (the granularity rule in
 * convex/analytics.ts stands), the count just rides the existing session-end
 * event as `reviews_count` so per-user review volume is queryable in
 * PostHog.
 *
 * Module scope is safe here: one learn session exists per tab, and the
 * layout resets the tally on every path that opens a session. The standalone
 * `/app/learn` route renders LearnView outside the layout and is not wired
 * to these session events, so reviews there are neither reported nor reset.
 */
let count = 0;

/** Called by the learn overlay after each successfully persisted review. */
export function recordReviewForSession(): void {
  count += 1;
}

/** Called when a review is undone, mirroring the session card count. */
export function undoReviewForSession(): void {
  count = Math.max(0, count - 1);
}

/** Reset at session start so an aborted previous session can't leak in. */
export function resetSessionReviewCount(): void {
  count = 0;
}

/** Read at session end. */
export function getSessionReviewCount(): number {
  return count;
}
