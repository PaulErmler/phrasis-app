import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';
import { tourStep } from './tour-step';

export function createFullReviewTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    tourStep(t, 'fullReview.welcome'),
    tourStep(t, 'fullReview.card', '[data-tutorial="card-flashcard"]', 'bottom', 'center'),
    tourStep(t, 'fullReview.input', '[data-tutorial="target-input-and-submit"]', 'top', 'center'),
    tourStep(t, 'fullReview.rating', '[data-tutorial="rating-buttons"]', 'top', 'center'),
    tourStep(t, 'fullReview.undoRestart', '[data-tutorial="undo-restart"]', 'top', 'center'),
    tourStep(t, 'fullReview.settings', '[data-tutorial="settings-button"]', 'bottom', 'start'),
    tourStep(t, 'chat', '[data-tutorial="chat-button"]', 'top', 'center'),
  ];

  return {
    id: 'full_review_intro',
    steps,
    prerequisite: 'home_tour',
  };
}
