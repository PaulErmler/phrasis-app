/**
 * Shape passed up to `onCardRated` callers. Mirrors the slice of `useLearningMode`
 * state that is "session bookkeeping" rather than per-card view state.
 */
export interface SessionSnapshot {
  sessionId: string;
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
}

/**
 * Extracts the session-snapshot slice from a `useLearningMode` state object
 * (or any structurally compatible source). Centralises the shape so adding
 * a new counter only requires editing one place.
 */
export function buildSessionSnapshot(state: SessionSnapshot): SessionSnapshot {
  return {
    sessionId: state.sessionId,
    dailyReviewsToday: state.dailyReviewsToday,
    dailyTimeMsToday: state.dailyTimeMsToday,
    dailyNewWordsToday: state.dailyNewWordsToday,
  };
}
