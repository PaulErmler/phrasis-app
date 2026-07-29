import type { TutorialDefinition, TutorialFactory, TranslateFn } from './types';
import { createHomeTour } from './home-tour';
import { createAudioReviewTour } from './audio-review-tour';
import { createFullReviewTour } from './full-review-tour';
export { TUTORIAL_IDS } from '@/convex/features/tutorialIds';

/** Static factory table — add new tours here, keyed by tutorial ID. */
const tutorialFactories: Record<string, TutorialFactory> = {
  home_tour: createHomeTour,
  audio_review_intro: createAudioReviewTour,
  full_review_intro: createFullReviewTour,
};

export function getTutorial(id: string, t: TranslateFn): TutorialDefinition | undefined {
  // Own-key guard: without it, prototype keys like 'toString' would resolve
  // through the object's prototype chain to a non-factory.
  if (!Object.hasOwn(tutorialFactories, id)) return undefined;
  return tutorialFactories[id](t);
}
