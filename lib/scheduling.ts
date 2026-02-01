/**
 * Shared scheduling logic for spaced repetition.
 * 
 * This module contains pure functions that can be imported by both:
 * - Frontend (for previewing next due dates)
 * - Backend (for calculating and persisting review results)
 * 
 * Uses ts-fsrs for the FSRS algorithm after the initial learning phase.
 */

import { createEmptyCard, fsrs, Rating, State, type Card, type RecordLog } from "ts-fsrs";
import { type CardSchedulingState } from "../convex/types";

// Re-export CardSchedulingState for convenience
export type { CardSchedulingState };

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Fixed intervals for initial learning phase (in minutes).
 * After these, we add 20 minutes for each additional review until target is reached.
 */
const INITIAL_INTERVALS_MINUTES = [1, 3, 5, 10, 15];

/**
 * Interval to add for reviews beyond the fixed intervals (in minutes).
 */
const ADDITIONAL_INTERVAL_MINUTES = 60;

/**
 * Interval after completing all initial reviews (in minutes = 1 day).
 */
const GRADUATION_INTERVAL_MINUTES = 24 * 60; // 1 day

/**
 * Stability threshold below which FSRS hasn't been used yet.
 */
const FIRST_FSRS_STABILITY_THRESHOLD = 0.001;

/**
 * Default number of initial reviews before graduating to FSRS.
 * Cards are shown at intervals: 1, 3, 5, 10, 15 minutes, then every 20 minutes
 * until this target is reached, then graduate to 1 day intervals with FSRS.
 */
export const DEFAULT_INITIAL_REVIEWS_TARGET = 5;

/**
 * Default FSRS instance with standard parameters.
 */
const scheduler = fsrs();

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of previewing or calculating the next review.
 */
export interface ReviewResult {
  nextDue: Date;
  nextState: CardSchedulingState;
  isGraduated: boolean;
  intervalMinutes: number;
}

/**
 * Preview result for UI display (lighter weight than full ReviewResult).
 */
export interface DuePreview {
  nextDue: Date;
  intervalMinutes: number;
  isGraduated: boolean;
  formattedInterval: string;
}

// Re-export Rating for convenience
export { Rating, State };

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the interval in minutes for a given review count in the initial learning phase.
 * 
 * @param reviewCount - Number of reviews already completed (0-indexed)
 * @param target - Total initial reviews target
 * @returns Interval in minutes until next review
 */
export function getInitialInterval(reviewCount: number, target: number): number {
  // If we've completed all initial reviews, graduate with 1 day interval
  if (reviewCount >= target) {
    return GRADUATION_INTERVAL_MINUTES;
  }

  // Use fixed intervals for the first few reviews
  if (reviewCount < INITIAL_INTERVALS_MINUTES.length) {
    return INITIAL_INTERVALS_MINUTES[reviewCount];
  }

  // For reviews beyond the fixed intervals, add 20 minutes each time
  // e.g., review 5 = 15 + 20 = 35 min, review 6 = 35 + 20 = 55 min
  const baseInterval = INITIAL_INTERVALS_MINUTES[INITIAL_INTERVALS_MINUTES.length - 1];
  const additionalReviews = reviewCount - INITIAL_INTERVALS_MINUTES.length + 1;
  return baseInterval + (additionalReviews * ADDITIONAL_INTERVAL_MINUTES);
}

/**
 * Format an interval in minutes to a human-readable string.
 */
export function formatInterval(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours < 24) {
    if (remainingMinutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${remainingMinutes}m`;
  }
  
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  
  if (remainingHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remainingHours}h`;
}

/**
 * Check if a card is still in the initial learning phase.
 */
export function isInInitialPhase(
  cardState: CardSchedulingState,
  initialReviewsTarget: number
): boolean {
  return cardState.initialReviewCount < initialReviewsTarget;
}

/**
 * Check if a card is being used with FSRS for the first time.
 * This happens when a card has graduated from the initial learning phase
 * but hasn't had FSRS calculate proper stability/difficulty values yet.
 */
function isFirstFsrsReview(cardState: CardSchedulingState): boolean {
  return cardState.stability < FIRST_FSRS_STABILITY_THRESHOLD;
}

/**
 * Result of calculating the next state during the initial learning phase.
 */
interface InitialPhaseResult {
  nextReviewCount: number;
  intervalMinutes: number;
  isGraduated: boolean;
  incrementLapses: boolean;
}

/**
 * Calculate the result of a review during the initial learning phase.
 * This is shared between previewNextDueDate and calculateNextReview.
 */
function calculateInitialPhaseResult(
  currentReviewCount: number,
  rating: Rating,
  initialReviewsTarget: number
): InitialPhaseResult {
  if (rating === Rating.Again) {
    // Reset to beginning of initial phase
    const nextReviewCount = 0;
    return {
      nextReviewCount,
      intervalMinutes: getInitialInterval(nextReviewCount, initialReviewsTarget),
      isGraduated: false,
      incrementLapses: true,
    };
  }
  
  if (rating === Rating.Easy) {
    // Easy = instant graduation to 1 day
    return {
      nextReviewCount: initialReviewsTarget,
      intervalMinutes: GRADUATION_INTERVAL_MINUTES,
      isGraduated: true,
      incrementLapses: false,
    };
  }
  
  // Hard/Good = progress to next step
  const nextReviewCount = currentReviewCount + 1;
  return {
    nextReviewCount,
    intervalMinutes: getInitialInterval(nextReviewCount, initialReviewsTarget),
    isGraduated: nextReviewCount >= initialReviewsTarget,
    incrementLapses: false,
  };
}

/**
 * Convert our CardSchedulingState to an FSRS Card object.
 * 
 * IMPORTANT: If this is the first FSRS review (stability near 0),
 * we treat it as a "New" card so FSRS can properly initialize it.
 */
function toFsrsCard(cardState: CardSchedulingState): Card {
  const baseCard = createEmptyCard();
  
  // If this is the first FSRS review, return a fresh new card
  // This ensures FSRS properly initializes stability and difficulty
  if (isFirstFsrsReview(cardState)) {
    return {
      ...baseCard,
      due: new Date(cardState.dueDate),
      reps: 0, // Treat as new for FSRS
      lapses: cardState.lapses,
      state: State.New, // FSRS needs to see this as a new card
    };
  }
  
  return {
    ...baseCard,
    due: new Date(cardState.dueDate),
    stability: cardState.stability,
    difficulty: cardState.difficulty,
    scheduled_days: cardState.scheduledDays,
    reps: cardState.reps,
    lapses: cardState.lapses,
    state: cardState.state as State,
    last_review: cardState.lastReview ? new Date(cardState.lastReview) : undefined,
  };
}

/**
 * Convert an FSRS Card back to our CardSchedulingState.
 */
function fromFsrsCard(
  fsrsCard: Card,
  initialReviewCount: number
): CardSchedulingState {
  return {
    dueDate: fsrsCard.due.getTime(),
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    scheduledDays: fsrsCard.scheduled_days,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    state: fsrsCard.state,
    lastReview: fsrsCard.last_review?.getTime() ?? null,
    initialReviewCount,
  };
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Create the initial scheduling state for a new card.
 */
export function createInitialCardState(): CardSchedulingState {
  const emptyCard = createEmptyCard();
  return {
    dueDate: Date.now(), // Due immediately
    stability: emptyCard.stability,
    difficulty: emptyCard.difficulty,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    lastReview: null,
    initialReviewCount: 0,
  };
}

/**
 * Preview what the next due date would be for a given rating.
 * This is a lightweight function for UI display that doesn't calculate the full state.
 * 
 * @param cardState - Current card scheduling state
 * @param rating - The rating to preview (1=Again, 2=Hard, 3=Good, 4=Easy)
 * @param initialReviewsTarget - Number of initial reviews before graduating to FSRS
 * @param now - Current time (defaults to now)
 * @returns Preview of next due date and interval
 */
export function previewNextDueDate(
  cardState: CardSchedulingState,
  rating: Rating,
  initialReviewsTarget: number,
  now: Date = new Date()
): DuePreview {
  if (isInInitialPhase(cardState, initialReviewsTarget)) {
    const result = calculateInitialPhaseResult(
      cardState.initialReviewCount,
      rating,
      initialReviewsTarget
    );
    const nextDue = new Date(now.getTime() + result.intervalMinutes * 60 * 1000);

    return {
      nextDue,
      intervalMinutes: result.intervalMinutes,
      isGraduated: result.isGraduated,
      formattedInterval: formatInterval(result.intervalMinutes),
    };
  }

  // Graduated to FSRS - use the algorithm
  const fsrsCard = toFsrsCard(cardState);
  const fsrsResult = scheduler.repeat(fsrsCard, now) as RecordLog;
  const ratingKey = rating as 1 | 2 | 3 | 4;
  const scheduledCard = fsrsResult[ratingKey].card;
  const intervalMinutes = Math.round(scheduledCard.scheduled_days * 24 * 60);

  return {
    nextDue: scheduledCard.due,
    intervalMinutes,
    isGraduated: true,
    formattedInterval: formatInterval(intervalMinutes),
  };
}

/**
 * Calculate the full next state after a review.
 * This is used by the backend to persist the new card state.
 * 
 * @param cardState - Current card scheduling state
 * @param rating - The rating given (1=Again, 2=Hard, 3=Good, 4=Easy)
 * @param initialReviewsTarget - Number of initial reviews before graduating to FSRS
 * @param now - Current time (defaults to now)
 * @returns Full review result with new card state
 */
export function calculateNextReview(
  cardState: CardSchedulingState,
  rating: Rating,
  initialReviewsTarget: number,
  now: Date = new Date()
): ReviewResult {
  const nowTimestamp = now.getTime();

  if (isInInitialPhase(cardState, initialReviewsTarget)) {
    const result = calculateInitialPhaseResult(
      cardState.initialReviewCount,
      rating,
      initialReviewsTarget
    );
    
    const nextDue = new Date(nowTimestamp + result.intervalMinutes * 60 * 1000);
    const nextState: State = result.isGraduated ? State.Review : State.Learning;

    const nextCardState: CardSchedulingState = {
      dueDate: nextDue.getTime(),
      stability: cardState.stability,
      difficulty: cardState.difficulty,
      scheduledDays: result.intervalMinutes / (24 * 60),
      reps: cardState.reps + 1,
      lapses: cardState.lapses + (result.incrementLapses ? 1 : 0),
      state: nextState,
      lastReview: nowTimestamp,
      initialReviewCount: result.nextReviewCount,
    };

    return {
      nextDue,
      nextState: nextCardState,
      isGraduated: result.isGraduated,
      intervalMinutes: result.intervalMinutes,
    };
  }

  // Graduated to FSRS - use the full algorithm
  const fsrsCard = toFsrsCard(cardState);
  const fsrsResult = scheduler.repeat(fsrsCard, now) as RecordLog;
  const ratingKey = rating as 1 | 2 | 3 | 4;
  const scheduledCard = fsrsResult[ratingKey].card;
  const intervalMinutes = Math.round(scheduledCard.scheduled_days * 24 * 60);

  const nextCardState = fromFsrsCard(scheduledCard, cardState.initialReviewCount);

  return {
    nextDue: scheduledCard.due,
    nextState: nextCardState,
    isGraduated: true,
    intervalMinutes,
  };
}

/**
 * The ratings we support (excludes Manual rating from ts-fsrs).
 */
export type SupportedRating = 1 | 2 | 3 | 4;

/**
 * Get all preview options for a card (for displaying all rating buttons).
 * 
 * @param cardState - Current card scheduling state
 * @param initialReviewsTarget - Number of initial reviews before graduating to FSRS
 * @param now - Current time (defaults to now)
 * @returns Object with previews for each rating (1-4)
 */
export function getAllRatingPreviews(
  cardState: CardSchedulingState,
  initialReviewsTarget: number,
  now: Date = new Date()
): Record<SupportedRating, DuePreview> {
  return {
    [Rating.Again]: previewNextDueDate(cardState, Rating.Again, initialReviewsTarget, now),
    [Rating.Hard]: previewNextDueDate(cardState, Rating.Hard, initialReviewsTarget, now),
    [Rating.Good]: previewNextDueDate(cardState, Rating.Good, initialReviewsTarget, now),
    [Rating.Easy]: previewNextDueDate(cardState, Rating.Easy, initialReviewsTarget, now),
  };
}

/**
 * Get a human-readable description of the card's current phase.
 */
export function getPhaseDescription(
  cardState: CardSchedulingState,
  initialReviewsTarget: number
): string {
  if (isInInitialPhase(cardState, initialReviewsTarget)) {
    return `Initial Learning (${cardState.initialReviewCount}/${initialReviewsTarget})`;
  }

  switch (cardState.state) {
    case State.New:
      return "New";
    case State.Learning:
      return "Learning";
    case State.Review:
      return "Review";
    case State.Relearning:
      return "Relearning";
    default:
      return "Unknown";
  }
}

/**
 * Check if a card is due for review.
 */
export function isDue(cardState: CardSchedulingState, now: Date = new Date()): boolean {
  return cardState.dueDate <= now.getTime();
}

// ============================================================================
// CONVERSION UTILITIES
// ============================================================================

/**
 * Shape that cardToSchedulingState can extract scheduling info from.
 * This allows the function to work with Convex card documents or any object
 * with these properties.
 */
interface CardLike {
  dueDate: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview?: number | null;
  initialReviewCount: number;
}

/**
 * Convert a card-like object to CardSchedulingState.
 * Works with Convex card documents or any object with the required properties.
 */
export function cardToSchedulingState(card: CardLike): CardSchedulingState {
  return {
    dueDate: card.dueDate,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview ?? null,
    initialReviewCount: card.initialReviewCount,
  };
}

