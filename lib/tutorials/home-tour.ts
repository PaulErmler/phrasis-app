import type {
  AppDriveStep,
  TutorialDefinition,
  TutorialContext,
  TranslateFn,
} from './types';
import { TUTORIAL_ANCHORS, tutorialSelector } from './anchors';
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
      ? tourStep(
          t,
          'home.freeStudyMode',
          tutorialSelector(TUTORIAL_ANCHORS.freeStudyMode),
          'bottom',
          'center',
        )
      : tourStep(
          t,
          'home.radioMode',
          tutorialSelector(TUTORIAL_ANCHORS.radioMode),
          'bottom',
          'center',
        );

  const steps: AppDriveStep[] = [
    {
      // Welcome. Heading only; no description per design.
      popover: {
        title: t('home.welcome.title'),
        description: '',
      },
    },
    tourStep(
      t,
      'home.learnNew',
      tutorialSelector(TUTORIAL_ANCHORS.learnNew),
      'bottom',
      'center',
    ),
    tourStep(
      t,
      'home.learnAndReview',
      tutorialSelector(TUTORIAL_ANCHORS.learnAndReview),
      'bottom',
      'center',
    ),
    freePlayStep,
    tourStep(
      t,
      'home.reviewModeToggle',
      tutorialSelector(TUTORIAL_ANCHORS.reviewModeToggle),
      'bottom',
      'center',
    ),
    tourStep(
      t,
      'home.contentSource',
      tutorialSelector(TUTORIAL_ANCHORS.contentSourceFilter),
      'bottom',
      'center',
    ),
    // The new/review pills next to the content-source filter. Omitted when
    // the user hides due counts (the default for new accounts), otherwise
    // this step highlights an empty slot and talks about pills that aren't
    // there.
    ...(ctx?.hideDueCounts === true
      ? []
      : [
          tourStep(
            t,
            'home.dueCounts',
            tutorialSelector(TUTORIAL_ANCHORS.dueCounts),
            'bottom',
            'center',
          ),
        ]),
    // The rotating forecast in the progress card ("by the end of the year…").
    tourStep(
      t,
      'home.projections',
      tutorialSelector(TUTORIAL_ANCHORS.projections),
      'bottom',
      'center',
    ),
    // The 7-day workload card sits BELOW the progress card, so this step
    // comes after both progress-card steps — the tour scrolls monotonically
    // instead of jumping down and back up. Gated on the card's OWN
    // preference (not hideDueCounts — the pills hide by default for new
    // accounts, the forecast doesn't). skipIfMissing is a safety net if the
    // card isn't mounted when the tour launches.
    ...(ctx?.hideWorkloadForecast === true
      ? []
      : [
          {
            ...tourStep(
              t,
              'home.workload',
              tutorialSelector(TUTORIAL_ANCHORS.workloadForecast),
              'top',
              'center',
            ),
            skipIfMissing: true,
          } satisfies AppDriveStep,
        ]),
    tourStep(
      t,
      'home.difficultySelection',
      tutorialSelector(TUTORIAL_ANCHORS.collectionCarousel),
      'top',
      'center',
    ),
    // Closing call-to-action. Re-highlights Learn & Review (the primary
    // entry point) so the tour finishes on the button the user is most
    // likely to click next.
    tourStep(
      t,
      'home.readyToLearn',
      tutorialSelector(TUTORIAL_ANCHORS.learnAndReview),
      'bottom',
      'center',
    ),
  ];

  return {
    id: 'home_tour',
    steps,
  };
}
