'use client';

import { useRouter } from 'next/navigation';
import { Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Skeleton } from '@/components/ui/skeleton';
import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import {
  useLearningMode,
  LearningHeader,
  LearningCardContent,
  LearningControls,
  NoCollectionState,
  NoCardsDueState,
} from '@/components/app/learning';
import type { PreloadedLearningData } from '@/components/app/learning/useLearningMode';

export function LearningMode({
  preloadedCard,
  preloadedCourseSettings,
  preloadedActiveCourse,
}: {
  preloadedCard: Preloaded<typeof api.features.scheduling.getCardForReview>;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedActiveCourse: Preloaded<typeof api.features.courses.getActiveCourse>;
}) {
  const router = useRouter();
  const state = useLearningMode({
    card: preloadedCard,
    courseSettings: preloadedCourseSettings,
    activeCourse: preloadedActiveCourse,
  });

  const goHome = () => router.push('/app');

  // Loading
  if (state.status === 'loading') {
    return (
      <div className="flex flex-col h-screen">
        <LearningHeader
          onBack={goHome}
          onSettingsOpen={() => state.setSettingsOpen(true)}
        />
        <main className="flex-1 flex items-center justify-center">
          <div className="space-y-4 w-full max-w-md px-4">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  // No collection selected
  if (state.status === 'noCollection') {
    return (
      <div className="flex flex-col h-screen">
        <LearningHeader
          onBack={goHome}
          onSettingsOpen={() => state.setSettingsOpen(true)}
        />
        <NoCollectionState onGoHome={goHome} />
        <LearningModeSettings
          open={state.settingsOpen}
          onOpenChange={state.setSettingsOpen}
          courseSettings={state.courseSettings}
          baseLanguages={state.baseLanguages}
          targetLanguages={state.targetLanguages}
        />
      </div>
    );
  }

  // No cards due
  if (state.status === 'noCardsDue') {
    return (
      <div className="flex flex-col h-screen">
        <LearningHeader
          onBack={goHome}
          onSettingsOpen={() => state.setSettingsOpen(true)}
        />
        <NoCardsDueState
          onAddCards={state.handleAddCards}
          isAddingCards={state.isAddingCards}
          batchSize={state.batchSize}
        />
        <LearningModeSettings
          open={state.settingsOpen}
          onOpenChange={state.setSettingsOpen}
          courseSettings={state.courseSettings}
          baseLanguages={state.baseLanguages}
          targetLanguages={state.targetLanguages}
        />
      </div>
    );
  }

  // Reviewing
  return (
    <div className="flex flex-col h-screen">
      <LearningHeader
        onBack={goHome}
        onSettingsOpen={() => state.setSettingsOpen(true)}
      />

      <LearningCardContent
        phase={state.phase}
        preReviewCount={state.preReviewCount}
        sourceText={state.sourceText}
        translations={state.translations}
        audioRecordings={state.audioRecordings}
        stopAudioPlayback={state.settingsOpen}
        onMaster={state.handleMaster}
        onHide={state.handleHide}
      />

      <LearningControls
        validRatings={state.validRatings}
        activeRating={state.activeRating}
        ratingIntervals={state.ratingIntervals}
        onSelectRating={state.setSelectedRating}
        onAutoPlay={state.handleAutoPlay}
        onStopAutoPlay={state.handleStopAutoPlay}
        isAutoPlaying={state.isAutoPlaying}
        onNext={state.handleNext}
        isReviewing={state.isReviewing}
      />

      <LearningModeSettings
        open={state.settingsOpen}
        onOpenChange={state.setSettingsOpen}
        courseSettings={state.courseSettings}
        baseLanguages={state.baseLanguages}
        targetLanguages={state.targetLanguages}
      />
    </div>
  );
}
