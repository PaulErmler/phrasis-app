import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';
import { tourStep } from './tour-step';

export function createAudioReviewTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    tourStep(t, 'audioReview.welcome'),
    tourStep(t, 'audioReview.card', '[data-tutorial="card-flashcard"]', 'bottom', 'center'),
    tourStep(t, 'audioReview.targetText', '[data-tutorial="target-text-audio"]', 'bottom', 'center'),
    tourStep(t, 'audioReview.rating', '[data-tutorial="rating-buttons"]', 'top', 'center'),
    tourStep(t, 'audioReview.audioControls', '[data-tutorial="audio-controls"]', 'top', 'center'),
    tourStep(t, 'audioReview.undoRestart', '[data-tutorial="undo-restart"]', 'top', 'center'),
    tourStep(t, 'audioReview.settings', '[data-tutorial="settings-button"]', 'bottom', 'start'),
    tourStep(t, 'chat', '[data-tutorial="chat-button"]', 'top', 'center'),
  ];

  return {
    id: 'audio_review_intro',
    steps,
    prerequisite: 'home_tour',
  };
}
