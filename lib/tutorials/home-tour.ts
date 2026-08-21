import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TutorialContext, TranslateFn } from './types';
import { tourStep } from './tour-step';

export function createHomeTour(
  t: TranslateFn,
  ctx?: TutorialContext,
): TutorialDefinition {
  // The third start button is mode-dependent: Radio in Shadowing, Free Study
  // in Writing. Anchor (and describe) whichever one is actually on screen.
  // Without context we default to the Radio step; the runtime element
  // resolver still degrades it to a centered popover if the button is absent.
  const freePlayStep =
    ctx?.reviewMode === 'full'
      ? tourStep(t, 'home.freeStudyMode', '[data-tutorial="free-study-mode"]', 'bottom', 'center')
      : tourStep(t, 'home.radioMode', '[data-tutorial="radio-mode"]', 'bottom', 'center');

  const steps: DriveStep[] = [
    {
      // Welcome. Heading only; no description per design.
      popover: {
        title: t('home.welcome.title'),
        description: '',
      },
    },
    tourStep(t, 'home.learnNew', '[data-tutorial="learn-new"]', 'bottom', 'center'),
    tourStep(t, 'home.learnAndReview', '[data-tutorial="learn-and-review"]', 'bottom', 'center'),
    freePlayStep,
    tourStep(t, 'home.reviewModeToggle', '[data-tutorial="review-mode-toggle"]', 'bottom', 'center'),
    tourStep(t, 'home.contentSource', '[data-tutorial="content-source-filter"]', 'bottom', 'center'),
    // The new/learning/review pills next to the content-source filter.
    tourStep(t, 'home.dueCounts', '[data-tutorial="due-counts"]', 'bottom', 'center'),
    // The rotating forecast in the progress card ("by the end of the year…").
    tourStep(t, 'home.projections', '[data-tutorial="projections"]', 'bottom', 'center'),
    tourStep(t, 'home.difficultySelection', '[data-tutorial="collection-carousel"]', 'top', 'center'),
    // Closing call-to-action. Re-highlights Learn & Review (the primary
    // entry point) so the tour finishes on the button the user is most
    // likely to click next.
    tourStep(t, 'home.readyToLearn', '[data-tutorial="learn-and-review"]', 'bottom', 'center'),
  ];

  return {
    id: 'home_tour',
    steps,
  };
}
