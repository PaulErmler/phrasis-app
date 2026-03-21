import { v } from 'convex/values';

/**
 * Single source of truth for tutorial IDs used across the app and Convex backend.
 * Keep in sync with tutorial definitions in lib/tutorials/.
 */
export const TUTORIAL_IDS = {
  HOME_TOUR: 'home_tour',
  AUDIO_REVIEW_INTRO: 'audio_review_intro',
  FULL_REVIEW_INTRO: 'full_review_intro',
} as const;

export type TutorialId = (typeof TUTORIAL_IDS)[keyof typeof TUTORIAL_IDS];

export const tutorialIdValidator = v.union(
  v.literal('home_tour'),
  v.literal('audio_review_intro'),
  v.literal('full_review_intro'),
);
