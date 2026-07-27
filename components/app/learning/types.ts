import { Id } from '@/convex/_generated/dataModel';

// ============================================================================
// Shared constants
// ============================================================================

export const DEFAULT_BATCH_SIZE = 5;

// ============================================================================
// Shared types for card data returned by Convex queries
// ============================================================================

export interface CardTranslation {
  language: string;
  text: string;
  isBaseLanguage: boolean;
  isTargetLanguage: boolean;
  romanization?: string;
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
   * Drives the retranslating-pill logic in the server query — clients
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
  // Writing ("full") mode counterparts — undefined falls back to the
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
  showProgressBar?: boolean;
  progressDisplayEnabled?: boolean;
  hideTargetLanguages?: boolean;
  autoRevealLanguages?: boolean;
  hideBaseLanguages?: boolean;
  autoRevealBaseLanguages?: boolean;
  hideBaseLanguagesFull?: boolean;
  autoRevealBaseOnSubmit?: boolean;
  showRomanization?: boolean;
  // Instant proceed on rating
  instantProceedAudio?: boolean;
  instantProceedFull?: boolean;
  // Review mode
  reviewMode?: 'audio' | 'full';
  fullReviewTargetAudioMode?: 'always' | 'afterSubmit' | 'never';
  writingInputMode?: 'translate' | 'transcribe';
  /** Writing mode: exclude punctuation from the accuracy score. Default false. */
  ignorePunctuation?: boolean;
  // Scheduling mode
  schedulingMode?: 'learn_new' | 'learnAndReview' | 'radio';
  // Language order overrides
  baseLanguageOrder?: string[];
  targetLanguageOrder?: string[];
}
