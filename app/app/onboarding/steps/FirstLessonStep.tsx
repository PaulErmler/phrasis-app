'use client';

import { FirstLessonContainer } from '../components/FirstLessonContainer';
import type { OnboardingSessionSummary } from '../components/OnboardingFirstLesson';
import type { ReviewMode } from '../types';

interface Props {
  initialReviewMode: ReviewMode;
  initialCardsRated?: number;
  initialSessionId?: string;
  onModeSelected: (mode: ReviewMode) => void;
  onCardsRatedChange?: (n: number) => void;
  onSessionIdDiscovered?: (sessionId: string) => void;
  /** Live snapshot on every rated card — see `FirstLessonContainer`. */
  onSnapshotUpdate?: (snapshot: OnboardingSessionSummary) => void;
  onLessonComplete: (summary: OnboardingSessionSummary) => void;
  onSkipLesson: () => void;
}

export function FirstLessonStep({
  initialReviewMode,
  initialCardsRated,
  initialSessionId,
  onModeSelected,
  onCardsRatedChange,
  onSessionIdDiscovered,
  onSnapshotUpdate,
  onLessonComplete,
  onSkipLesson,
}: Props) {
  return (
    <FirstLessonContainer
      initialReviewMode={initialReviewMode}
      initialCardsRated={initialCardsRated}
      initialSessionId={initialSessionId}
      onModeSelected={onModeSelected}
      onCardsRatedChange={onCardsRatedChange}
      onSessionIdDiscovered={onSessionIdDiscovered}
      onSnapshotUpdate={onSnapshotUpdate}
      onLessonComplete={onLessonComplete}
      onSkipLesson={onSkipLesson}
    />
  );
}
