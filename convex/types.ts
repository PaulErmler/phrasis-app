import { v, Infer } from 'convex/values';

export const learningStyleValidator = v.union(
  v.literal('casual'),
  v.literal('focused'),
  v.literal('advanced'),
);

export const schedulingPhaseValidator = v.union(
  v.literal("preReview"),
  v.literal("review")
);

export const currentLevelValidator = v.union(
  v.literal('beginner'),
  v.literal('elementary'),
  v.literal('intermediate'),
  v.literal('upper_intermediate'),
  v.literal('advanced'),
  v.literal('proficient'),
);

// FSRS scheduling state (inner object, wrap with v.optional / v.union as needed)
export const fsrsStateValidator = v.object({
  due: v.number(),
  stability: v.number(),
  difficulty: v.number(),
  elapsedDays: v.number(),
  scheduledDays: v.number(),
  learningSteps: v.number(),
  reps: v.number(),
  lapses: v.number(),
  state: v.number(), // 0=New, 1=Learning, 2=Review, 3=Relearning
  lastReview: v.number(),
});

// Card content validators (used in scheduling and deck query return types)
export const translationValidator = v.object({
  language: v.string(),
  text: v.string(),
  isBaseLanguage: v.boolean(),
  isTargetLanguage: v.boolean(),
  romanization: v.optional(v.string()),
});

export const audioRecordingValidator = v.object({
  language: v.string(),
  voiceName: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
  // Word-level timings from Scribe, captured during TTS validation.
  // The schema field is `v.optional(v.array(...))` so DB rows can be `undefined`,
  // but this validator is stricter — `null | array` only. Callers building a
  // response from a raw audioRecordings row MUST coerce `undefined → null`
  // (`row.wordTimings ?? null`), or this validator will reject the response.
  wordTimings: v.union(
    v.array(
      v.object({
        word: v.string(),
        start: v.number(),
        end: v.number(),
      }),
    ),
    v.null(),
  ),
});

export const reviewModeValidator = v.union(
  v.literal('audio'),
  v.literal('full'),
);

export const schedulingModeValidator = v.union(
  v.literal('learn_new'),
  v.literal('learnAndReview'),
);

export const ttsQualityValidator = v.union(
  v.literal('unknown'),
  v.literal('validated'),
  v.literal('unvalidated'),
);

export const ttsProviderValidator = v.union(
  v.literal('google'),
  v.literal('elevenlabs'),
);

export const voiceGenderValidator = v.union(
  v.literal('male'),
  v.literal('female'),
);

export const cardApprovalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
);

export type LearningStyle = Infer<typeof learningStyleValidator>;
export type CurrentLevel = Infer<typeof currentLevelValidator>;
export type ReviewMode = Infer<typeof reviewModeValidator>;
export type SchedulingMode = Infer<typeof schedulingModeValidator>;
export type FsrsState = Infer<typeof fsrsStateValidator>;
export type TtsQuality = Infer<typeof ttsQualityValidator>;
export type TtsProvider = Infer<typeof ttsProviderValidator>;
export type VoiceGender = Infer<typeof voiceGenderValidator>;
export type CardApprovalStatus = Infer<typeof cardApprovalStatusValidator>;
