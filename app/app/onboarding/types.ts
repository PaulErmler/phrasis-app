export type LearningStyle = "casual" | "focused" | "advanced";

export type CurrentLevel = "beginner" | "elementary" | "intermediate" | "upper_intermediate" | "advanced";

export interface OnboardingData {
  learningStyle: LearningStyle | null;
  targetLanguages: string[];
  currentLevel: CurrentLevel | null;
  baseLanguages: string[];
}


