import { v } from 'convex/values';

/**
 * Single source of truth for tutorial/tip IDs used across the app and Convex
 * backend. Keep in sync with tutorial definitions in lib/tutorials/.
 *
 * Two families:
 *  - Tours (`home_tour`), multi-step driver.js walkthroughs via
 *    `useTutorial`.
 *  - One-time learning-mode tips (`tip_*`), shown by `useMilestoneTips`
 *    inside the real learning session. Concept tips (`tip_concept_*`) are
 *    the intro walkthrough, persisted per concept so switching review modes
 *    never re-explains what the other mode already covered. Milestone tips
 *    fire once lifetime reviews pass their thresholds.
 */
export const TUTORIAL_IDS = {
  HOME_TOUR: 'home_tour',
  // Retired 2026-08: the standalone review-mode tours were replaced by the
  // concept/milestone tips below. The IDs stay valid so historical
  // `completedTutorials` rows (and clients mid-rollout) keep validating.
  // Do not reuse these strings for anything else.
  AUDIO_REVIEW_INTRO: 'audio_review_intro',
  FULL_REVIEW_INTRO: 'full_review_intro',
  // Intro concepts (one-time each, shown on the first card of a mode).
  TIP_CONCEPT_CARD: 'tip_concept_card',
  TIP_CONCEPT_REVEAL: 'tip_concept_reveal',
  TIP_CONCEPT_RATING_AUDIO: 'tip_concept_rating_audio',
  TIP_CONCEPT_RATING_FULL: 'tip_concept_rating_full',
  TIP_CONCEPT_AUDIO_CONTROLS: 'tip_concept_audio_controls',
  TIP_CONCEPT_SHOWN_TRANSLATION: 'tip_concept_shown_translation',
  TIP_CONCEPT_INPUT: 'tip_concept_input',
  TIP_CONCEPT_AUTOADD: 'tip_concept_autoadd',
  // One-time difficulty check: before the FIRST auto-add of new cards, a
  // dialog asks whether the difficulty feels right and offers the level
  // slider (with sentence previews) to move the course to another level.
  DIFFICULTY_CHECK: 'difficulty_check',
  // Milestone tips (one-time each, gated on lifetime cards reviewed).
  TIP_CARD_ACTIONS: 'tip_card_actions',
  TIP_CHAT: 'tip_chat',
  TIP_WORD_TAP: 'tip_word_tap',
  TIP_MODE_SWITCH: 'tip_mode_switch',
  TIP_SETTINGS: 'tip_settings',
} as const;

export type TutorialId = (typeof TUTORIAL_IDS)[keyof typeof TUTORIAL_IDS];

export const tutorialIdValidator = v.union(
  v.literal('home_tour'),
  v.literal('audio_review_intro'),
  v.literal('full_review_intro'),
  v.literal('tip_concept_card'),
  v.literal('tip_concept_reveal'),
  v.literal('tip_concept_rating_audio'),
  v.literal('tip_concept_rating_full'),
  v.literal('tip_concept_audio_controls'),
  v.literal('tip_concept_shown_translation'),
  v.literal('tip_concept_input'),
  v.literal('tip_concept_autoadd'),
  v.literal('difficulty_check'),
  v.literal('tip_card_actions'),
  v.literal('tip_chat'),
  v.literal('tip_word_tap'),
  v.literal('tip_mode_switch'),
  v.literal('tip_settings'),
);
