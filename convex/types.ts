import { v, Infer } from "convex/values";

export const learningStyleValidator = v.union(
  v.literal("casual"),
  v.literal("focused"),
  v.literal("advanced")
);

export const currentLevelValidator = v.union(
  v.literal("beginner"),
  v.literal("elementary"),
  v.literal("intermediate"),
  v.literal("upper_intermediate"),
  v.literal("advanced")
);

// FSRS Rating: 1=Again, 2=Hard, 3=Good, 4=Easy
export const ratingValidator = v.union(
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4)
);

// FSRS State: 0=New, 1=Learning, 2=Review, 3=Relearning
export const cardStateValidator = v.union(
  v.literal(0),
  v.literal(1),
  v.literal(2),
  v.literal(3)
);

// ============================================================================
// Card-related validators (shared between queries)
// ============================================================================

/**
 * FSRS scheduling state for a card.
 * This is the single source of truth - CardSchedulingState type is derived from this.
 */
export const cardSchedulingStateValidator = v.object({
  dueDate: v.number(),
  stability: v.number(),
  difficulty: v.number(),
  scheduledDays: v.number(),
  reps: v.number(),
  lapses: v.number(),
  state: v.number(),
  lastReview: v.union(v.number(), v.null()),
  initialReviewCount: v.number(),
});

// Alias for use in query/mutation return validators
export const schedulingValidator = cardSchedulingStateValidator;

/**
 * Translation for a card (includes base/target language flags).
 */
export const cardTranslationValidator = v.object({
  language: v.string(),
  text: v.string(),
  isBaseLanguage: v.boolean(),
  isTargetLanguage: v.boolean(),
});

/**
 * Audio recording reference for a card.
 */
export const cardAudioRecordingValidator = v.object({
  language: v.string(),
  voiceName: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
});

// ============================================================================
// Type exports
// ============================================================================

export type LearningStyle = Infer<typeof learningStyleValidator>;
export type CurrentLevel = Infer<typeof currentLevelValidator>;
export type Rating = Infer<typeof ratingValidator>;
export type CardState = Infer<typeof cardStateValidator>;
export type CardSchedulingState = Infer<typeof cardSchedulingStateValidator>;
export type CardTranslation = Infer<typeof cardTranslationValidator>;
export type CardAudioRecording = Infer<typeof cardAudioRecordingValidator>;

// Legacy alias
export type Scheduling = CardSchedulingState;
