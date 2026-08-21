export type ReviewMode = 'audio' | 'full';

/** Writing-mode input style. Mirrors `courseSettings.writingInputMode`. */
export type WritingInputMode = 'translate' | 'transcribe';

export type CurrentLevel =
  | 'beginner'
  | 'elementary'
  | 'intermediate'
  | 'upper_intermediate'
  | 'advanced'
  | 'proficient';

export type AcquisitionSource =
  | 'reddit'
  | 'chatgpt'
  | 'gemini'
  | 'claude'
  | 'google'
  | 'friend'
  | 'appstore'
  | 'other';

export type LearningReason =
  | 'travel'
  | 'family'
  | 'work'
  | 'curiosity'
  | 'exam'
  | 'other';

/** Persisted as a plain number on `courseSettings.dailyTimeGoalMinutes`. The
 *  step UI offers five preset tiles (5/10/20/30/60) plus a "Custom" tile that
 *  expands to a free number input. Any value not in the preset set is
 *  treated as a custom pick. Validated to 1..120 in the wizard. Constants
 *  live in lib/constants/dailyGoal.ts (shared with the in-app editors and
 *  the Convex clamp); re-exported here for the wizard steps. */
export type DailyTimeGoalMinutes = number;
export {
  DAILY_TIME_PRESETS,
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
} from '@/lib/constants/dailyGoal';

export interface PlacementTestState {
  strategyVersion: number; // CURRENT_PLACEMENT_STRATEGY_VERSION at write time
  strategy: string; // StrategyName from lib/placementStrategies
  history: { level: number; knew: boolean }[];
  finalLevel?: number;
}

/**
 * Wizard-context shape. Mirrors `convex/schema.ts` `onboardingProgress` exactly
 * so saving progress is a flat copy.
 */
export interface OnboardingData {
  reviewMode: ReviewMode | null;
  /** Writing style picked on the review-mode step; only meaningful when
   *  `reviewMode === 'full'`. */
  writingInputMode: WritingInputMode | null;
  targetLanguages: string[];
  baseLanguages: string[];
  currentLevel: CurrentLevel | null;

  // Survey answers.
  acquisitionSource: AcquisitionSource | null;
  acquisitionSourceFreeText: string | null;
  /** Multi-select learning reasons. Empty array until the user picks at
   *  least one. Persisted as `learningGoals` on the progress + settings
   *  rows. The legacy singular field `learningGoal` is no longer written. */
  learningGoals: LearningReason[];
  learningGoalFreeText: string | null;
  dailyTimeGoalMinutes: DailyTimeGoalMinutes | null;
  placementTest: PlacementTestState | null;

  // Branch state, never persisted, only used by the wizard
  proficiencyBranch: 'new' | 'self-pick' | 'test' | null;
}

export const EMPTY_ONBOARDING_DATA: OnboardingData = {
  reviewMode: null,
  writingInputMode: null,
  targetLanguages: [],
  baseLanguages: [],
  currentLevel: null,
  acquisitionSource: null,
  acquisitionSourceFreeText: null,
  learningGoals: [],
  learningGoalFreeText: null,
  dailyTimeGoalMinutes: null,
  placementTest: null,
  proficiencyBranch: null,
};
