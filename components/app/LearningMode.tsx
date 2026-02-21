'use client';

import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import {
  LearningCardContent,
  LearningControls,
  NoCollectionState,
  NoCardsDueState,
} from '@/components/app/learning';
import type { LearningState } from '@/components/app/learning/useLearningMode';
import type { AudioPlayerState } from '@/hooks/use-audio-player';

interface LearningModeProps {
  state: LearningState;
  audio: AudioPlayerState;
}

/**
 * Learning mode body content (card, controls, settings).
 * Does NOT render its own header — the parent layout handles that.
 */
export function LearningMode({ state, audio }: LearningModeProps) {
  const router = useRouter();
  const goHome = () => router.push('/app');

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col h-full">
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

  if (state.status === 'noCollection') {
    return (
      <div className="flex flex-col h-full">
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

  if (state.status === 'noCardsDue') {
    return (
      <div className="flex flex-col h-full">
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

  return (
    <div className="flex flex-col h-full">
      <LearningCardContent
        preReviewCount={state.preReviewCount}
        sourceText={state.sourceText}
        translations={state.translations}
        audioRecordings={state.audioRecordings}
        isFavorite={state.isFavorite}
        isPendingMaster={state.isPendingMaster}
        isPendingHide={state.isPendingHide}
        onMaster={state.handleMaster}
        onHide={state.handleHide}
        onFavorite={state.handleFavorite}
      />

      <LearningControls
        validRatings={state.validRatings}
        activeRating={state.activeRating}
        ratingIntervals={state.ratingIntervals}
        onSelectRating={state.setSelectedRating}
        onPlay={audio.play}
        onPause={audio.pause}
        audioRef={audio.audioRef}
        isPlaying={audio.isPlaying}
        isMerging={audio.isMerging}
        durationSec={audio.durationSec}
        onSeek={audio.seekTo}
        onNext={state.handleNext}
        isReviewing={state.isReviewing}
        showProgressBar={state.courseSettings.showProgressBar ?? true}
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
