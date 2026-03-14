import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';

export function createAudioReviewTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    {
      popover: {
        title: t('audioReview.welcome.title'),
        description: t('audioReview.welcome.description'),
      },
    },
    {
      element: '[data-tutorial="card-flashcard"]',
      popover: {
        title: t('audioReview.card.title'),
        description: t('audioReview.card.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="target-text-audio"]',
      popover: {
        title: t('audioReview.targetText.title'),
        description: t('audioReview.targetText.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="rating-buttons"]',
      popover: {
        title: t('audioReview.rating.title'),
        description: t('audioReview.rating.description'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="audio-controls"]',
      popover: {
        title: t('audioReview.audioControls.title'),
        description: t('audioReview.audioControls.description'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="settings-button"]',
      popover: {
        title: t('audioReview.settings.title'),
        description: t('audioReview.settings.description'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tutorial="chat-button"]',
      popover: {
        title: t('chat.title'),
        description: t('chat.description'),
        side: 'top',
        align: 'center',
      },
    },
  ];

  return {
    id: 'audio_review_intro',
    steps,
    prerequisite: 'home_tour',
  };
}
