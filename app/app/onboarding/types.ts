export type ReviewMode = 'audio' | 'full';

export type CurrentLevel =
  | 'beginner'
  | 'elementary'
  | 'intermediate'
  | 'upper_intermediate'
  | 'advanced'
  | 'proficient';

export interface OnboardingData {
  reviewMode: ReviewMode | null;
  targetLanguages: string[];
  currentLevel: CurrentLevel | null;
  baseLanguages: string[];
}
