import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';
import { tourStep } from './tour-step';

export function createHomeTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    {
      // Welcome — heading only; no description per design.
      popover: {
        title: t('home.welcome.title'),
        description: '',
      },
    },
    tourStep(t, 'home.learnNew', '[data-tutorial="learn-new"]', 'bottom', 'center'),
    tourStep(t, 'home.learnAndReview', '[data-tutorial="learn-and-review"]', 'bottom', 'center'),
    // Radio button only renders in audio mode — the runtime element resolver
    // drops the `element` ref when the selector finds no visible candidate,
    // so this step degrades gracefully to a centered modal-style popover
    // when the user is in full-review mode.
    tourStep(t, 'home.radioMode', '[data-tutorial="radio-mode"]', 'bottom', 'center'),
    tourStep(t, 'home.reviewModeToggle', '[data-tutorial="review-mode-toggle"]', 'bottom', 'center'),
    tourStep(t, 'home.contentSource', '[data-tutorial="content-source-filter"]', 'bottom', 'center'),
    tourStep(t, 'home.difficultySelection', '[data-tutorial="collection-carousel"]', 'top', 'center'),
    // Closing call-to-action — re-highlights Learn & Review (the primary
    // entry point) so the tour finishes on the button the user is most
    // likely to click next.
    tourStep(t, 'home.readyToLearn', '[data-tutorial="learn-and-review"]', 'bottom', 'center'),
  ];

  return {
    id: 'home_tour',
    steps,
  };
}
