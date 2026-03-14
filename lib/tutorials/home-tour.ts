import type { DriveStep } from 'driver.js';
import type { TutorialDefinition, TranslateFn } from './types';

export function createHomeTour(t: TranslateFn): TutorialDefinition {
  const steps: DriveStep[] = [
    {
      popover: {
        title: t('home.welcome.title'),
        description: t('home.welcome.description'),
      },
    },
    {
      element: '[data-tutorial="start-learning"]',
      popover: {
        title: t('home.learningModes.title'),
        description: t('home.learningModes.description'),
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
  ];

  return {
    id: 'home_tour',
    steps,
  };
}
