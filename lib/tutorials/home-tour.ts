import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';

export function createHomeTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    {
      // Welcome — heading only; no description per design.
      popover: {
        title: t('home.welcome.title'),
        description: '',
      },
    },
    {
      element: '[data-tutorial="learn-new"]',
      popover: {
        title: t('home.learnNew.title'),
        description: t('home.learnNew.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="learn-and-review"]',
      popover: {
        title: t('home.learnAndReview.title'),
        description: t('home.learnAndReview.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    // Radio button only renders in audio mode — the runtime element resolver
    // drops the `element` ref when the selector finds no visible candidate,
    // so this step degrades gracefully to a centered modal-style popover
    // when the user is in full-review mode.
    {
      element: '[data-tutorial="radio-mode"]',
      popover: {
        title: t('home.radioMode.title'),
        description: t('home.radioMode.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="review-mode-toggle"]',
      popover: {
        title: t('home.reviewModeToggle.title'),
        description: t('home.reviewModeToggle.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="content-source-filter"]',
      popover: {
        title: t('home.contentSource.title'),
        description: t('home.contentSource.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '[data-tutorial="collection-carousel"]',
      popover: {
        title: t('home.difficultySelection.title'),
        description: t('home.difficultySelection.description'),
        side: 'top',
        align: 'center',
      },
    },
    // Closing call-to-action — re-highlights Learn & Review (the primary
    // entry point) so the tour finishes on the button the user is most
    // likely to click next.
    {
      element: '[data-tutorial="learn-and-review"]',
      popover: {
        title: t('home.readyToLearn.title'),
        description: t('home.readyToLearn.description'),
        side: 'bottom',
        align: 'center',
      },
    },
  ];

  return {
    id: 'home_tour',
    steps,
  };
}
