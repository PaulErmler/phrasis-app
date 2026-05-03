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
  showProgressBar?: boolean;
  progressDisplayEnabled?: boolean;
  hideTargetLanguages?: boolean;
  autoRevealLanguages?: boolean;
  showRomanization?: boolean;
  // Instant proceed on rating
  instantProceedAudio?: boolean;
  instantProceedFull?: boolean;
  // Review mode
  reviewMode?: 'audio' | 'full';
  fullReviewTargetAudioMode?: 'always' | 'afterSubmit' | 'never';
  // Scheduling mode
  schedulingMode?: 'learn_new' | 'learnAndReview' | 'radio';
  // Language order overrides
  baseLanguageOrder?: string[];
  targetLanguageOrder?: string[];
}
