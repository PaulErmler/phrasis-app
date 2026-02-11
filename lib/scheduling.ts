/**
 * Shared card scheduling logic — used by both Convex backend and React frontend.
 *
 * Two-phase scheduling:
 *   1. Pre-review: fixed intervals (1m, 3m, 5m, then 10m) with "Still learning" / "Understood"
 *   2. FSRS review: spaced repetition via ts-fsrs with Again / Hard / Good / Easy
 *
 * Transition from pre-review → FSRS happens when:
 *   - The user selects "Understood" at any time, OR
 *   - The preReviewCount reaches initialReviewCount − 2.
 *
 * The −2 accounts for 2 FSRS learning-step reviews needed to graduate to
 * next-day scheduling, so total initial exposure = initialReviewCount.
 */

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
  type FSRSParameters,
  type RecordLogItem,
} from "ts-fsrs";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default number of initial reviews before FSRS scheduling begins. */
export const DEFAULT_INITIAL_REVIEW_COUNT = 5;

/** Minimum allowed initialReviewCount (need ≥2 FSRS learning steps to graduate). */
export const MIN_INITIAL_REVIEW_COUNT = 2;

/** Maximum allowed initialReviewCount. */
export const MAX_INITIAL_REVIEW_COUNT = 10;

/**
 * Validate that an initialReviewCount is an integer within the allowed range.
 * Throws a ConvexError if invalid.
 */
export function validateInitialReviewCount(value: number): void {
  if (!Number.isInteger(value) || value < MIN_INITIAL_REVIEW_COUNT || value > MAX_INITIAL_REVIEW_COUNT) {
    throw new Error(
      `initialReviewCount must be an integer between ${MIN_INITIAL_REVIEW_COUNT} and ${MAX_INITIAL_REVIEW_COUNT}`,
    );
  }
}

/** Default desired retention used by the backend. */
export const DEFAULT_REQUEST_RETENTION = 0.95;

/** Pre-review intervals in milliseconds: 1 min, 3 min, 5 min */
const PRE_REVIEW_INTERVALS_MS: readonly number[] = [
  1 * 60 * 1000, // 1 minute
  3 * 60 * 1000, // 3 minutes
  5 * 60 * 1000, // 5 minutes
];

/** Fallback interval after the explicit list is exhausted (10 min). */
const PRE_REVIEW_DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

// ============================================================================
// FSRS CONFIGURATION
// ============================================================================

const FSRS_PARAMS: Partial<FSRSParameters> = {
  request_retention: DEFAULT_REQUEST_RETENTION,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["10m", "10m"] as const, // 2 steps → 2 Good reviews to graduate
  relearning_steps: ["10m"] as const,
};

function getFsrsInstance(requestRetention?: number) {
  const params =
    requestRetention !== undefined
      ? { ...FSRS_PARAMS, request_retention: requestRetention }
      : FSRS_PARAMS;
  return fsrs(generatorParameters(params));
}

// ============================================================================
// TYPES
// ============================================================================

export type SchedulingPhase = "preReview" | "review";

export type PreReviewRating = "stillLearning" | "understood";

export type FSRSRating = "again" | "hard" | "good" | "easy";

export type ReviewRating = PreReviewRating | FSRSRating;

/**
 * Serialised FSRS card state (plain numbers — no Date objects).
 * Stored in Convex alongside the card document.
 */
export interface FsrsCardState {
  due: number; // timestamp ms
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number; // 0 = New, 1 = Learning, 2 = Review, 3 = Relearning
  lastReview: number; // timestamp ms
}

/** Complete card scheduling state (maps 1-to-1 to the card document fields). */
export interface CardSchedulingState {
  schedulingPhase: SchedulingPhase;
  preReviewCount: number;
  dueDate: number; // timestamp ms
  fsrsState: FsrsCardState | null;
}

/** The value returned after scheduling a single review. */
export interface ScheduleResult {
  schedulingPhase: SchedulingPhase;
  preReviewCount: number;
  dueDate: number;
  fsrsState: FsrsCardState | null;
  /** True when this review caused a preReview → review transition. */
  phaseTransitioned: boolean;
}

/** One step in a simulated review timeline. */
export interface SimulationStep {
  reviewNumber: number;
  rating: ReviewRating;
  phase: SchedulingPhase;
  dueDate: number;
  phaseTransitioned: boolean;
  intervalDescription: string;
}

// ============================================================================
// SERIALISATION HELPERS
// ============================================================================

function serializeFsrsCard(card: Card): FsrsCardState {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    lastReview: card.last_review?.getTime() ?? 0,
  };
}

function deserializeFsrsCard(s: FsrsCardState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    last_review: s.lastReview ? new Date(s.lastReview) : undefined,
  };
}

function ratingToGrade(rating: FSRSRating): Grade {
  switch (rating) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
  }
}

// ============================================================================
// PRE-REVIEW INTERVAL
// ============================================================================

/** Return the pre-review interval (ms) for the given review count (0-based). */
export function getPreReviewInterval(reviewCount: number): number {
  if (reviewCount < PRE_REVIEW_INTERVALS_MS.length) {
    return PRE_REVIEW_INTERVALS_MS[reviewCount];
  }
  return PRE_REVIEW_DEFAULT_INTERVAL_MS;
}

// ============================================================================
// MAIN SCHEDULING FUNCTION
// ============================================================================

/**
 * Schedule a card after a review.
 *
 * This is the **single entry-point** for all card scheduling logic.
 * It handles both the pre-review phase (fixed intervals) and the
 * FSRS review phase (spaced repetition).
 *
 * @param cardState          Current card scheduling state.
 * @param rating             The user's rating for this review.
 * @param initialReviewCount The X value from course settings.
 * @param now                Current timestamp in ms (defaults to Date.now()).
 * @param requestRetention   Optional desired retention override (frontend-only).
 *                           The backend always uses DEFAULT_REQUEST_RETENTION.
 */
export function scheduleCard(
  cardState: CardSchedulingState,
  rating: ReviewRating,
  initialReviewCount: number,
  now: number = Date.now(),
  requestRetention?: number,
): ScheduleResult {
  if (cardState.schedulingPhase === "preReview") {
    return schedulePreReview(cardState, rating, initialReviewCount, now, requestRetention);
  }
  return scheduleFsrsReview(cardState, rating as FSRSRating, now, requestRetention);
}

// ============================================================================
// PRE-REVIEW SCHEDULING (sub-function)
// ============================================================================

function schedulePreReview(
  cardState: CardSchedulingState,
  rating: ReviewRating,
  initialReviewCount: number,
  now: number,
  requestRetention?: number,
): ScheduleResult {
  const threshold = Math.max(initialReviewCount - 2, 0);
  const newPreReviewCount = cardState.preReviewCount + 1;

  // Transition to FSRS if "understood" is selected or threshold reached.
  const shouldTransition =
    rating === "understood" || newPreReviewCount >= threshold;

  if (shouldTransition) {
    // Still honor the pre-review interval before the first FSRS review.
    const interval = getPreReviewInterval(cardState.preReviewCount);
    const result = transitionToFsrs(newPreReviewCount, now);
    return { ...result, dueDate: now + interval };
  }

  // Stay in pre-review: compute next due date from the interval table.
  const interval = getPreReviewInterval(cardState.preReviewCount);
  return {
    schedulingPhase: "preReview",
    preReviewCount: newPreReviewCount,
    dueDate: now + interval,
    fsrsState: null,
    phaseTransitioned: false,
  };
}

/**
 * Transition a card from pre-review into the FSRS review phase.
 * Creates a fresh FSRS card in New state, due immediately.
 * The next user review will be the first real FSRS review.
 */
function transitionToFsrs(
  preReviewCount: number,
  now: number,
): ScheduleResult {
  const emptyCard = createEmptyCard(new Date(now));
  const newFsrsState = serializeFsrsCard(emptyCard);

  return {
    schedulingPhase: "review",
    preReviewCount,
    dueDate: now, // due immediately — next user interaction is the first FSRS review
    fsrsState: newFsrsState,
    phaseTransitioned: true,
  };
}

// ============================================================================
// FSRS REVIEW SCHEDULING (sub-function)
// ============================================================================

function scheduleFsrsReview(
  cardState: CardSchedulingState,
  rating: FSRSRating,
  now: number,
  requestRetention?: number,
): ScheduleResult {
  if (!cardState.fsrsState) {
    throw new Error("Cannot perform FSRS review: no FSRS state on card");
  }

  const f = getFsrsInstance(requestRetention);
  const card = deserializeFsrsCard(cardState.fsrsState);
  const grade = ratingToGrade(rating);

  const result: RecordLogItem = f.next(card, new Date(now), grade);
  const newFsrsState = serializeFsrsCard(result.card);

  return {
    schedulingPhase: "review",
    preReviewCount: cardState.preReviewCount,
    dueDate: result.card.due.getTime(),
    fsrsState: newFsrsState,
    phaseTransitioned: false,
  };
}

// ============================================================================
// UTILITY 
// ============================================================================

/** Create initial scheduling state for a brand-new card. */
export function createInitialCardState(
  now: number = Date.now(),
): CardSchedulingState {
  return {
    schedulingPhase: "preReview",
    preReviewCount: 0,
    dueDate: now,
    fsrsState: null,
  };
}

/** Return the valid ratings for the current scheduling phase. */
export function getValidRatings(phase: SchedulingPhase): ReviewRating[] {
  if (phase === "preReview") {
    return ["stillLearning", "understood"];
  }
  return ["again", "hard", "good", "easy"];
}

/** Return the default (pre-selected) rating for the current phase. */
export function getDefaultRating(phase: SchedulingPhase): ReviewRating {
  if (phase === "preReview") {
    return "stillLearning";
  }
  return "good";
}

// ============================================================================
// SIMULATION (for the developer test component)
// ============================================================================

/** Format a millisecond interval as a human-readable string. */
export function formatInterval(ms: number): string {
  const totalMinutes = ms / (60 * 1000);
  if (totalMinutes < 60) return `${Math.round(totalMinutes)}m`;
  const hours = totalMinutes / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = hours / 24;
  return `${Math.round(days * 10) / 10}d`;
}

/**
 * Simulate a sequence of reviews and return the full timeline.
 *
 * Each review is executed at the exact moment the card becomes due,
 * so the timeline shows ideal spacing.
 *
 * @param initialReviewCount The X value from course settings.
 * @param ratings            Sequence of ratings to apply.
 * @param startTime          Starting timestamp (defaults to now).
 * @param requestRetention   Optional desired retention override (frontend-only).
 */
export function simulateReviews(
  initialReviewCount: number,
  ratings: ReviewRating[],
  startTime: number = Date.now(),
  requestRetention?: number,
): SimulationStep[] {
  const steps: Array<SimulationStep> = [];
  let state = createInitialCardState(startTime);
  let currentTime = startTime;

  for (let i = 0; i < ratings.length; i++) {
    const rating = ratings[i];
    const result = scheduleCard(state, rating, initialReviewCount, currentTime, requestRetention);

    const interval = result.dueDate - currentTime;
    steps.push({
      reviewNumber: i + 1,
      rating,
      phase: result.schedulingPhase,
      dueDate: result.dueDate,
      phaseTransitioned: result.phaseTransitioned,
      intervalDescription: formatInterval(interval),
    });

    // Advance simulated clock to the due date.
    state = {
      schedulingPhase: result.schedulingPhase,
      preReviewCount: result.preReviewCount,
      dueDate: result.dueDate,
      fsrsState: result.fsrsState,
    };
    currentTime = result.dueDate;
  }

  return steps;
}
