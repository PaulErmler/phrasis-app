import { v, Infer } from 'convex/values';
import { TTS_PROVIDERS } from '../lib/languages';

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
  /**
   * True iff an LLM retranslation is currently in flight for this language:
   * a non-stale row exists in `llmTranslationClaims` for (textId, lang) AND
   * a `translatedText` is already on file (so it's a *re*translation, not
   * the first-time translation of a brand-new card). Drives the warning-
   * color "Retranslating" pill in the card header. Keyed off the LLM claim
   * (not on "audio missing") so it does NOT fire when the user clicks
   * "regenerate audio" — that flow has no LLM phase.
   */
  retranslating: v.optional(v.boolean()),
});

export const audioRecordingValidator = v.object({
  language: v.string(),
  voiceName: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
  // Word-level timings from Azure Fast Transcription, captured during TTS validation.
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
  // TTS validation status: 'unknown' while a synthesis attempt is in flight
  // (or between retries), 'validated' once transcription matched, 'unvalidated'
  // for languages without STT support or when all retries mismatched. Surfaced
  // so the "Retranslating" pill in the learning view can stay visible while
  // ttsQuality === 'unknown' (the audio row exists but the audio it points
  // to may still be a not-yet-validated synthesis). Nullable for rows that
  // pre-date this field or for placeholders.
  ttsQuality: v.union(v.string(), v.null()),
});

export const reviewModeValidator = v.union(
  v.literal('audio'),
  v.literal('full'),
);

export const schedulingModeValidator = v.union(
  v.literal('learn_new'),
  v.literal('learnAndReview'),
  v.literal('radio'),
);

// Writing mode: accuracy breakpoints that map a typed answer's score to an
// FSRS rating. Percent points (0-100 integers), lower-inclusive — a score of
// exactly `hard` rates "hard", a score of exactly `good` rates "good". `easy`
// is optional and currently never written by the UI (the control ships with
// three bands); when unset the top band is "good".
// Invariant enforced on write: 0 <= hard <= good <= (easy ?? 100) <= 100.
export const autoRateThresholdsValidator = v.object({
  hard: v.number(),
  good: v.number(),
  easy: v.optional(v.number()),
});

// Source-of-content filter. `undefined` and 'both' behave identically (no filter).
// 'custom' = study/auto-add only cards from collections with origin !== 'premade' (custom + chat).
// 'course' = study/auto-add only cards from collections with origin === 'premade'.
export const studyContentFilterValidator = v.union(
  v.literal('custom'),
  v.literal('course'),
  v.literal('both'),
);

// The six grades a card review can receive: stillLearning/understood in the
// preReview phase, again/hard/good/easy once the card is FSRS-scheduled.
export const reviewRatingValidator = v.union(
  v.literal('stillLearning'),
  v.literal('understood'),
  v.literal('again'),
  v.literal('hard'),
  v.literal('good'),
  v.literal('easy'),
);

// The card fields that `reviewCard` mutates (scheduling state). Single source
// of truth shared by the `cards` table definition and the `reviewLogs.prevCard`
// undo snapshot so the two can never drift.
export const cardSchedulingSnapshotFields = {
  dueDate: v.number(), // Timestamp for spaced repetition scheduling (driven by scheduler)
  schedulingPhase: schedulingPhaseValidator,
  preReviewCount: v.number(), // How many pre-review rounds completed
  fsrsState: v.optional(fsrsStateValidator), // Populated when card enters FSRS review phase
  isGraduated: v.optional(v.boolean()), // One-way flag: true once card graduates from initial learning (FSRS state >= Review)
  lastReviewedAt: v.optional(v.number()), // Timestamp of last review (pre-review, FSRS, and radio plays)
} as const;

// The card fields that `advanceRadioCard` mutates (minus `lastReviewedAt`,
// which lives in the scheduling set above). Shared by the `cards` table and
// the `reviewLogs.prevRadio` undo snapshot.
export const cardRadioSnapshotFields = {
  radioRoundCounter: v.optional(v.number()), // Radio mode: # of times this card has been played in radio mode. Lowest counter plays next; new cards default to 0 so they play first. Optional for backward compat — undefined treated as 0.
  radioOrderKey: v.optional(v.number()), // Radio mode: random tiebreak within equal `radioRoundCounter`. Re-rolled on each play so the round-robin order shuffles every loop and never matches the review (`dueDate`-driven) order. Optional for backward compat.
  radioPlayCount: v.optional(v.number()), // Radio mode: true count of radio plays (+1 per play, NOT subject to radioRoundCounter's catch-up jump). Drives the "Only new" Practice-Listening limit. Optional/undefined for pre-existing cards — treated as the card's review count (preReviewCount + FSRS reps) so they don't reset to "new".
} as const;

export const ttsQualityValidator = v.union(
  v.literal('unknown'),
  v.literal('validated'),
  v.literal('unvalidated'),
);

// Single source of truth for the provider list is `TTS_PROVIDERS` in
// lib/languages.ts; this validator (for stored `audioRecordings.ttsProvider`)
// is built from it so the two can't drift. Indexed access keeps the exact
// string-literal union for `Infer`. 'gemini' = Gemini 3.1 Flash TTS via
// OpenRouter's /audio/speech endpoint (distinct from 'google' = Cloud Chirp3).
// 'elevenlabs' (index 1) and 'azure' (index 2) are retired providers retained
// only so historical stored values still validate — neither is dispatchable
// (Azure Speech remains in use for STT only; see convex/lib/stt).
export const ttsProviderValidator = v.union(
  v.literal(TTS_PROVIDERS[0]),
  v.literal(TTS_PROVIDERS[1]),
  v.literal(TTS_PROVIDERS[2]),
  v.literal(TTS_PROVIDERS[3]),
);

export const voiceGenderValidator = v.union(
  v.literal('male'),
  v.literal('female'),
);

/**
 * Narrow a loosely-typed string to a strict voice gender, or `undefined` when
 * it is neither. Use at boundaries where a `v.string()`-typed value (e.g.
 * `texts.audioSpeakerGender`, or a queued job's `audioSpeakerGender`) flows
 * into a strict `voiceGenderValidator` field such as `translations.speakerGender`.
 */
export function asVoiceGender(
  value: string | undefined,
): 'male' | 'female' | undefined {
  return value === 'male' || value === 'female' ? value : undefined;
}

export const cardApprovalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
);

export type LearningStyle = Infer<typeof learningStyleValidator>;
export type StudyContentFilter = Infer<typeof studyContentFilterValidator>;
export type ReviewRating = Infer<typeof reviewRatingValidator>;
export type CurrentLevel = Infer<typeof currentLevelValidator>;
export type ReviewMode = Infer<typeof reviewModeValidator>;
export type SchedulingMode = Infer<typeof schedulingModeValidator>;
export type FsrsState = Infer<typeof fsrsStateValidator>;
export type TtsQuality = Infer<typeof ttsQualityValidator>;
export type TtsProvider = Infer<typeof ttsProviderValidator>;
export type VoiceGender = Infer<typeof voiceGenderValidator>;
export type CardApprovalStatus = Infer<typeof cardApprovalStatusValidator>;
