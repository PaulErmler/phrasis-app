import { Id } from '@/convex/_generated/dataModel';
import type { SchedulingMode } from '@/convex/types';

// ============================================================================
// Shared constants
// ============================================================================

export const DEFAULT_BATCH_SIZE = 5;

// ============================================================================
// Shared types for card data returned by Convex queries
// ============================================================================

/** One stored accepted alternative, with its own generated content. */
export interface CardTranslationAlternative {
  text: string;
  romanization?: string;
  ipa?: string;
  furigana?: string;
  audioUrl?: string | null;
}

export interface CardTranslation {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  romanization?: string;
  /** IPA transcription (espeak-ng); same display semantics as romanization. */
  ipa?: string;
  /**
   * Bracketed furigana (lib/furigana.ts format). Rendered as ruby OVER the
   * sentence text by ClickableWords, not as an annotation line under it.
   */
  furigana?: string;
  /**
   * AI-feedback accepted alternatives for this card + language (max
   * WRITING_ALTERNATIVES_MAX). Writing mode diffs against the closest of
   * primary + alternatives and lists the others under the answer with
   * their own annotations + audio.
   */
  alternatives?: CardTranslationAlternative[];
  /**
   * True while an LLM retranslation is in flight for this language
   * (server-driven, keyed off `llmTranslationClaims`). Excludes the
   * "regenerate audio" flow, which has no LLM phase. Drives the warning-
   * color "Retranslating" pill in the card header.
   */
  retranslating?: boolean;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface CardAudioRecording {
  language: string;
  voiceName: string | null;
  url: string | null;
  wordTimings: WordTiming[] | null;
  /**
   * TTS validation state mirrored from the server. 'unknown' while a synthesis
   * attempt is in flight; 'validated' or 'unvalidated' once the loop finishes.
   * Drives the retranslating-pill logic in the server query. Clients
   * generally don't need to read it directly.
   */
  ttsQuality: string | null;
}

export interface CourseSettings {
  _id: Id<'courseSettings'>;
  _creationTime: number;
  courseId: Id<'courses'>;
  initialReviewCount: number;
  activeCollectionId?: Id<'collections'>;
  cardsToAddBatchSize?: number;
  autoAddCards?: boolean;
  dailyTimeGoalMinutes?: number;
  // Audio playback settings
  highlightWords?: boolean;
  autoPlayAudio?: boolean;
  autoAdvance?: boolean;
  languageRepetitions?: Record<string, number>;
  languageRepetitionPauses?: Record<string, number>;
  languagePlaybackSpeeds?: Record<string, number>;
  pauseBaseToBase?: number;
  pauseBaseToTarget?: number;
  pauseTargetToTarget?: number;
  pauseBeforeAutoAdvance?: number;
  // Writing ("full") mode counterparts. Undefined falls back to the
  // unsuffixed audio-mode field (see courseSettingsFields in convex/schema.ts).
  highlightWordsFull?: boolean;
  autoPlayAudioFull?: boolean;
  languageRepetitionsFull?: Record<string, number>;
  languageRepetitionPausesFull?: Record<string, number>;
  languagePlaybackSpeedsFull?: Record<string, number>;
  pauseBaseToBaseFull?: number;
  pauseBaseToTargetFull?: number;
  pauseTargetToTargetFull?: number;
  pauseBeforeAutoAdvanceFull?: number;
  // Transcribe style: own playback-settings copy, resolved
  // `*Transcribe ?? *Full ?? unsuffixed ?? DEFAULT_*`.
  highlightWordsTranscribe?: boolean;
  autoPlayAudioTranscribe?: boolean;
  languageRepetitionsTranscribe?: Record<string, number>;
  languageRepetitionPausesTranscribe?: Record<string, number>;
  languagePlaybackSpeedsTranscribe?: Record<string, number>;
  pauseTargetToTargetTranscribe?: number;
  // Transcribe style: post-submit target replay settings (missing entry =
  // 1 repetition at the prompt speed).
  transcribeAfterRepetitions?: Record<string, number>;
  transcribeAfterRepetitionPauses?: Record<string, number>;
  transcribeAfterPlaybackSpeeds?: Record<string, number>;
  // Target-before-base ("Practice Listening") / target-after-base ("Practice Speaking")
  playTargetBeforeBase?: boolean;
  playTargetAfterBase?: boolean;
  targetBeforeRepetitions?: Record<string, number>;
  targetBeforeRepetitionPauses?: Record<string, number>;
  targetBeforePlaybackSpeeds?: Record<string, number>;
  pauseTargetToBase?: number;
  // "Only new": Practice Listening only on a card's initial N reviews.
  // 0 / undefined = always (∞); 1-10 = limit.
  targetBeforeOnlyNewReps?: number;
  // Practice Listening duration strategy. 'onlyNew' (the rep window above),
  // 'untilGood' (off after N FSRS good/easy ratings), or 'continuous' (never
  // off). Unset = legacy doc; inferred from targetBeforeOnlyNewReps.
  targetBeforeListeningStrategy?: 'onlyNew' | 'untilGood' | 'continuous';
  targetBeforeUntilGoodReps?: number; // 1-10, default 1
  // Writing mode: show the translation to copy-type on a card's first N
  // reviews. undefined = on; window mirrors targetBeforeOnlyNewReps (0 = ∞),
  // default 1.
  showTranslationOnNew?: boolean;
  showTranslationOnlyNewReps?: number;
  showProgressBar?: boolean;
  progressDisplayEnabled?: boolean;
  hideTargetLanguages?: boolean;
  autoRevealLanguages?: boolean;
  hideBaseLanguages?: boolean;
  autoRevealBaseLanguages?: boolean;
  hideBaseLanguagesFull?: boolean;
  autoRevealBaseOnSubmit?: boolean;
  showRomanization?: boolean;
  /** IPA transcription line below sentences. Default OFF (`?? false`). */
  showIpa?: boolean;
  /** Furigana ruby over kanji (Japanese). Default ON (`?? true`). */
  showFurigana?: boolean;
  // Instant proceed on rating
  instantProceedAudio?: boolean;
  instantProceedFull?: boolean;
  // Review mode
  reviewMode?: 'audio' | 'full';
  /** Split scheduling: Writing keeps its own per-card spaced-repetition
   * schedule instead of sharing one with Shadowing. Default false (shared). */
  separateModeTracking?: boolean;
  fullReviewTargetAudioMode?: 'always' | 'afterSubmit' | 'never';
  writingInputMode?: 'translate' | 'transcribe';
  /** Writing mode: exclude punctuation from the accuracy score. Default false. */
  ignorePunctuation?: boolean;
  /** Writing mode: AI-grade non-matching answers and show a coach card. Default true. */
  aiWritingFeedback?: boolean;
  /** Writing mode: preselect the rating from the accuracy score. Default true. */
  autoRateFromAccuracy?: boolean;
  /** Accuracy breakpoints for the above. Default 50 / 80. */
  autoRateThresholds?: { hard: number; good: number; easy?: number };
  /** Show the card's source collection (e.g. "A1.2") in the card header. Default false. */
  showCardOrigin?: boolean;
  // Scheduling mode
  schedulingMode?: SchedulingMode;
  // Language order overrides
  baseLanguageOrder?: string[];
  targetLanguageOrder?: string[];
}

/**
 * Writing-mode accuracy for the card currently on screen, aggregated across
 * target languages. Emitted whenever the submitted texts change.
 *
 * Two different numbers, for two different jobs:
 *  - `avg*` is the recorded stat. It keeps the meaning it has always had (mean
 *    across languages) and callers only persist it once `allSubmitted` is true,
 *    so a half-answered card contributes nothing.
 *  - `min*` drives the auto-rating. The weakest language should decide when the
 *    card comes back: a perfect Spanish answer must not mask a failed
 *    Japanese one: and it is available as soon as anything is submitted.
 *
 * Both punctuation variants are always computed, independently of the learner's
 * `ignorePunctuation` setting, so stats can record both series in parallel.
 * All values are 0-100; the `*` fields are null when nothing is submitted yet.
 */
export interface WritingAccuracySummary {
  allSubmitted: boolean;
  submittedCount: number;
  targetCount: number;
  avgWithPunctuation: number | null;
  avgWithoutPunctuation: number | null;
  minWithPunctuation: number | null;
  minWithoutPunctuation: number | null;
}

/** The three accuracy figures sent to `reviewCard`, all 0-100. */
export interface ReviewAccuracyPayload {
  /** Scored under the learner's current setting. The historical series. */
  primary: number;
  /** Always punctuation-counted. */
  strict: number;
  /** Always punctuation-ignored. */
  lenient: number;
}
