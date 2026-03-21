import type { TutorialDefinition, TutorialFactory, TranslateFn } from './types';
import { createHomeTour } from './home-tour';
import { createAudioReviewTour } from './audio-review-tour';
import { createFullReviewTour } from './full-review-tour';
export { TUTORIAL_IDS } from '@/convex/features/tutorialIds';

const tutorialFactories = new Map<string, TutorialFactory>();

export function registerTutorial(id: string, factory: TutorialFactory) {
  tutorialFactories.set(id, factory);
}

export function getTutorial(id: string, t: TranslateFn): TutorialDefinition | undefined {
  const factory = tutorialFactories.get(id);
  return factory?.(t);
}

registerTutorial('home_tour', createHomeTour);
registerTutorial('audio_review_intro', createAudioReviewTour);
registerTutorial('full_review_intro', createFullReviewTour);
