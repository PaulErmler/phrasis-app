import type {
  AppDriveStep,
  TutorialDefinition,
  TutorialContext,
  TranslateFn,
} from './types';
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

  const steps: AppDriveStep[] = [
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
    // The new/review pills next to the content-source filter and the 7-day
    // workload forecast card. Both omitted when the user hides due counts
    // (the default for new accounts), otherwise these steps highlight empty
    // slots and talk about things that aren't there.
    ...(ctx?.hideDueCounts === true
      ? []
      : [
          tourStep(t, 'home.dueCounts', '[data-tutorial="due-counts"]', 'bottom', 'center'),
          // The card also hides itself below the minimum-activity gate
          // (MIN_STARTED_CARDS_FOR_FORECAST) — that lives in query data this
          // factory can't see, so the step drops at launch when the card
          // isn't mounted.
          {
            ...tourStep(t, 'home.workload', '[data-tutorial="workload-forecast"]', 'top', 'center'),
            skipIfMissing: true,
          } satisfies AppDriveStep,
        ]),
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
