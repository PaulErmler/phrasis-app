import type {
  TutorialDefinition,
  TutorialFactory,
  TutorialContext,
  TranslateFn,
} from './types';
import { createHomeTour } from './home-tour';
export { TUTORIAL_IDS } from '@/convex/features/tutorialIds';

/**
 * Static factory table — add new tours here, keyed by tutorial ID.
 *
 * Only multi-step tours driven by `useTutorial` live here. The one-time
 * learning-mode tips (`tip_*` ids) are self-contained in
 * `use-milestone-tips.ts`; the retired `audio_review_intro` /
 * `full_review_intro` tours were replaced by those tips (2026-08).
 */
const tutorialFactories: Record<string, TutorialFactory> = {
  home_tour: createHomeTour,
};

export function getTutorial(
  id: string,
  t: TranslateFn,
  ctx?: TutorialContext,
): TutorialDefinition | undefined {
  // Own-key guard: without it, prototype keys like 'toString' would resolve
  // through the object's prototype chain to a non-factory.
  if (!Object.hasOwn(tutorialFactories, id)) return undefined;
  return tutorialFactories[id](t, ctx);
}
