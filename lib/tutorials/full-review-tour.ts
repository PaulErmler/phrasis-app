import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';

export function createFullReviewTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    {
      popover: {
        title: t('fullReview.welcome.title'),
        description: t('fullReview.welcome.description'),
      },
    },
    {
      element: '[data-tutorial="card-flashcard"]',
      popover: {
        title: t('fullReview.card.title'),
        description: t('fullReview.card.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="target-input-and-submit"]',
      popover: {
        title: t('fullReview.input.title'),
        description: t('fullReview.input.description'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="rating-buttons"]',
      popover: {
        title: t('fullReview.rating.title'),
        description: t('fullReview.rating.description'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="settings-button"]',
      popover: {
        title: t('fullReview.settings.title'),
        description: t('fullReview.settings.description'),
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
    id: 'full_review_intro',
    steps,
    prerequisite: 'home_tour',
  };
}
