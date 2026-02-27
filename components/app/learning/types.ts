import { Id } from "@/convex/_generated/dataModel";

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
}

export interface CardAudioRecording {
  language: string;
  voiceName: string | null;
  url: string | null;
}

export interface CourseSettings {
  _id: Id<"courseSettings">;
  _creationTime: number;
  courseId: Id<"courses">;
  initialReviewCount: number;
  activeCollectionId?: Id<"collections">;
  cardsToAddBatchSize?: number;
  autoAddCards?: boolean;
  // Audio playback settings
  autoPlayAudio?: boolean;
  autoAdvance?: boolean;
  languageRepetitions?: Record<string, number>;
  languageRepetitionPauses?: Record<string, number>;
  pauseBaseToBase?: number;
  pauseBaseToTarget?: number;
  pauseTargetToTarget?: number;
  pauseBeforeAutoAdvance?: number;
  // Language order overrides
  baseLanguageOrder?: string[];
  targetLanguageOrder?: string[];
}

