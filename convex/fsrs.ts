import { State, Rating, fsrs } from "ts-fsrs";

export type CardState = "new" | "learning" | "review" | "relearning";
export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface FSRSCardData {
  state: CardState;
  difficulty: number;
  stability: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReview?: number;
  nextReview?: number;
}

// Map ts-fsrs State to our CardState
function stateToCardState(state: State): CardState {
  switch (state) {
    case State.New:
      return "new";
    case State.Learning:
      return "learning";
    case State.Review:
      return "review";
    case State.Relearning:
      return "relearning";
    default:
      return "new";
  }
}

// Map our CardState to ts-fsrs State
function cardStateToState(cardState: CardState): State {
  switch (cardState) {
    case "new":
      return State.New;
    case "learning":
      return State.Learning;
    case "review":
      return State.Review;
    case "relearning":
      return State.Relearning;
    default:
      return State.New;
  }
}

// Map ReviewRating to ts-fsrs Rating
function ratingToFSRSRating(rating: ReviewRating): Rating {
  switch (rating) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
    default:
      return Rating.Good;
  }
}

/**
 * Initialize a new card with FSRS default state
 */
export function initializeCard(): FSRSCardData {
  const fsrsObj = fsrs();
  // Create an empty card structure matching ts-fsrs format
  const card = {
    due: new Date(),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    state: State.New,
  };
  
  return {
    state: stateToCardState(card.state),
    difficulty: card.difficulty,
    stability: card.stability,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: undefined,
    nextReview: Date.now(),
  };
}

/**
 * Rate a card and get updated FSRS state
 * Returns updated card state and next review timestamp
 */
export function rateCard(
  cardData: FSRSCardData,
  rating: ReviewRating,
  nowMs: number = Date.now()
): {
  updatedCard: FSRSCardData;
  nextReviewMs: number;
} {
  const f = fsrs();
  const now = new Date(nowMs);
  
  // Reconstruct card from data in ts-fsrs format
  const card = {
    due: new Date(cardData.nextReview || nowMs),
    stability: cardData.stability,
    difficulty: cardData.difficulty,
    elapsed_days: cardData.elapsedDays,
    scheduled_days: cardData.scheduledDays,
    reps: cardData.reps,
    lapses: cardData.lapses,
    learning_steps: 0,
    state: cardStateToState(cardData.state),
    last_review: cardData.lastReview ? new Date(cardData.lastReview) : now,
  };

  const fsrsRating = ratingToFSRSRating(rating);
  
  // ts-fsrs.repeat returns an object with keys 1,2,3,4 for ratings Again,Hard,Good,Easy
  // We need to map our rating to the correct key
  const ratingMap: Record<ReviewRating, number> = {
    again: 1,
    hard: 2,
    good: 3,
    easy: 4,
  };
  
  const scheduleResults = f.repeat(card, now) as unknown as Record<number, any>;
  const ratingKey = ratingMap[rating];
  const scheduled = scheduleResults[ratingKey];

  if (!scheduled) {
    throw new Error(`Invalid rating: ${rating}`);
  }

  const { card: updatedCard } = scheduled;
  const nextReviewMs = updatedCard.due.getTime();

  return {
    updatedCard: {
      state: stateToCardState(updatedCard.state),
      difficulty: updatedCard.difficulty,
      stability: updatedCard.stability,
      elapsedDays: updatedCard.elapsed_days,
      scheduledDays: updatedCard.scheduled_days,
      reps: updatedCard.reps,
      lapses: updatedCard.lapses,
      lastReview: nowMs,
      nextReview: nextReviewMs,
    },
    nextReviewMs,
  };
}

/**
 * Get human-readable card status
 */
export function getCardStatus(cardData: FSRSCardData): string {
  const now = Date.now();
  const nextReview = cardData.nextReview || now;
  const daysUntil = Math.ceil((nextReview - now) / (1000 * 60 * 60 * 24));

  if (nextReview <= now) {
    return "Due now";
  } else if (daysUntil === 0) {
    return "Due today";
  } else if (daysUntil === 1) {
    return "Due tomorrow";
  } else {
    return `Due in ${daysUntil} days`;
  }
}
