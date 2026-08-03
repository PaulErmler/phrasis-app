import type { SessionSnapshot } from '@/components/app/learning/sessionSnapshot';

export type ReviewMode = 'audio' | 'full';

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
 *  expands to a free number input — any value not in the preset set is
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

/** Snapshot of the embedded first-lesson session, persisted on
 *  `onboardingProgress.firstLessonSummary` so the stats-recap +
 *  word-projection screens have their data even after a mid-flow reload. */
export interface FirstLessonSummary extends SessionSnapshot {
  cardsRated: number;
}

/**
 * Wizard-context shape. Mirrors `convex/schema.ts` `onboardingProgress` exactly
 * so saving progress is a flat copy.
 */
export interface OnboardingData {
  // Existing legacy fields (kept for compatibility with `completeOnboarding`)
  reviewMode: ReviewMode | null;
  targetLanguages: string[];
  baseLanguages: string[];
  currentLevel: CurrentLevel | null;

  // New onboarding fields
  acquisitionSource: AcquisitionSource | null;
  acquisitionSourceFreeText: string | null;
  /** Multi-select learning reasons. Empty array until the user picks at
   *  least one. Persisted as `learningGoals` on the progress + settings
   *  rows. The legacy singular field `learningGoal` is no longer written. */
  learningGoals: LearningReason[];
  learningGoalFreeText: string | null;
  dailyTimeGoalMinutes: DailyTimeGoalMinutes | null;
  placementTest: PlacementTestState | null;
  /** Cards already rated in the embedded first lesson — persisted so a reload
   *  mid-lesson resumes the right count and skips already-fired tutorials. */
  firstLessonCardsRated: number;
  /** Persisted session id for the embedded first lesson — captured on the
   *  first card rated and forwarded back into `useLearningMode` on the next
   *  mount so the in-session progress bar (X/N) and the +N new-words hero
   *  on the stats-recap screen stay continuous across a mid-flow reload. */
  firstLessonSessionId: string | null;
  /** Persisted lesson session snapshot — set when the first lesson completes
   *  (or null if the user skipped). Lets the stats-recap + word-projection
   *  screens survive a mid-flow reload. */
  firstLessonSummary: FirstLessonSummary | null;

  // Branch state — never persisted, only used by the wizard
  proficiencyBranch: 'new' | 'self-pick' | 'test' | null;
}

export const EMPTY_ONBOARDING_DATA: OnboardingData = {
  reviewMode: null,
  targetLanguages: [],
  baseLanguages: [],
  currentLevel: null,
  acquisitionSource: null,
  acquisitionSourceFreeText: null,
  learningGoals: [],
  learningGoalFreeText: null,
  dailyTimeGoalMinutes: null,
  placementTest: null,
  firstLessonCardsRated: 0,
  firstLessonSessionId: null,
  firstLessonSummary: null,
  proficiencyBranch: null,
};
