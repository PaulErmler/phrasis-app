/**
 * Single source of truth for tutorial/coachmark anchor names.
 *
 * Components stamp these onto the DOM (`data-tutorial={TUTORIAL_ANCHORS.x}`,
 * `data-coachmark-anchor={COACHMARK_ANCHORS.x}`), and the driver.js side
 * (home tour, guided tutorials, milestone tips) derives its CSS selectors
 * from the same constants via `tutorialSelector` / `coachmarkSelector`, so
 * an anchor can't drift out of sync with the step that points at it.
 *
 * Plain constants on purpose: importable from server and client components
 * alike. E2E specs and unit tests deliberately keep the raw strings as an
 * independent regression check that the rendered values never change.
 */

/** `data-tutorial` attribute values. */
export const TUTORIAL_ANCHORS = {
  // Home screen
  startLearning: 'start-learning',
  learnNew: 'learn-new',
  learnAndReview: 'learn-and-review',
  radioMode: 'radio-mode',
  freeStudyMode: 'free-study-mode',
  reviewModeToggle: 'review-mode-toggle',
  contentSourceFilter: 'content-source-filter',
  dueCounts: 'due-counts',
  progressStats: 'progress-stats',
  projections: 'projections',
  workloadForecast: 'workload-forecast',
  collectionCarousel: 'collection-carousel',
  collectionDetail: 'collection-detail',
  // Learning card (real card and its landing-page replica)
  cardFlashcard: 'card-flashcard',
  cardContent: 'card-content',
  cardContentFull: 'card-content-full',
  targetTextAudio: 'target-text-audio',
  baseLanguages: 'base-languages',
  cardActions: 'card-actions',
  // Learning controls
  audioControls: 'audio-controls',
  undoRestart: 'undo-restart',
  audioPlay: 'audio-play',
  ratingButtons: 'rating-buttons',
  targetInputFull: 'target-input-full',
  targetInputAndSubmit: 'target-input-and-submit',
  submitAnswer: 'submit-answer',
  // Learning chrome
  settingsButton: 'settings-button',
  chatButton: 'chat-button',
} as const;

export type TutorialAnchor =
  (typeof TUTORIAL_ANCHORS)[keyof typeof TUTORIAL_ANCHORS];

/** `data-coachmark-anchor` attribute values. */
export const COACHMARK_ANCHORS = {
  cardActions: 'card-actions',
  wordTap: 'word-tap',
  chatButton: 'chat-button',
  chatButtonDesktop: 'chat-button-desktop',
  ratingButtons: 'rating-buttons',
  modeSwitcher: 'mode-switcher',
} as const;

export type CoachmarkAnchor =
  (typeof COACHMARK_ANCHORS)[keyof typeof COACHMARK_ANCHORS];

/** CSS selector matching a `data-tutorial` anchor. */
export function tutorialSelector(anchor: TutorialAnchor): string {
  return `[data-tutorial="${anchor}"]`;
}

/** CSS selector matching a `data-coachmark-anchor` anchor. */
export function coachmarkSelector(anchor: CoachmarkAnchor): string {
  return `[data-coachmark-anchor="${anchor}"]`;
}
