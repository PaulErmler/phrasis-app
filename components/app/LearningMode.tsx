'use client';

import { useState } from 'react';
import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import {
  LearningCardContent,
  FullReviewCardContent,
  LearningControls,
  NoCollectionState,
  NoCardsDueState,
} from '@/components/app/learning';
import type { LearningState } from '@/components/app/learning/useLearningMode';
import type { AudioPlayerState } from '@/hooks/use-audio-player';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { FEATURE_IDS } from '@/convex/features/featureIds';

interface LearningModeProps {
  state: LearningState;
  audio: AudioPlayerState;
  onGoHome: () => void;
}

/**
 * Learning mode body content (card, controls, settings).
 * Does NOT render its own header — the parent layout handles that.
 */
export function LearningMode({ state, audio, onGoHome }: LearningModeProps) {
  const [paywallOpen, setPaywallOpen] = useState(false);

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col h-full">
        <main className="flex-1" />
        <LearningControls
          validRatings={[]}
          activeRating={'good'}
          ratingIntervals={{}}
          onSelectRating={() => {}}
          onPlay={audio.play}
          onPause={audio.pause}
          audioRef={audio.audioRef}
          isPlaying={audio.isPlaying}
          isMerging={audio.isMerging}
          durationSec={audio.durationSec}
          onSeek={audio.seekTo}
          onNext={() => {}}
          isReviewing={true}
          showProgressBar={true}
        />
      </div>
    );
  }

  if (state.status === 'noCollection') {
    return (
      <div className="flex flex-col h-full">
        <NoCollectionState onGoHome={onGoHome} />
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
          sentencesRemaining={state.sentencesRemaining}
          onUpgrade={() => setPaywallOpen(true)}
        />
        <LearningModeSettings
          open={state.settingsOpen}
          onOpenChange={state.setSettingsOpen}
          courseSettings={state.courseSettings}
          baseLanguages={state.baseLanguages}
          targetLanguages={state.targetLanguages}
        />
        {paywallOpen && (
          <PaywallDialog
            open={paywallOpen}
            setOpen={setPaywallOpen}
            featureId={FEATURE_IDS.SENTENCES}
          />
        )}
      </div>
    );
  }

  const reviewMode = state.courseSettings.reviewMode ?? 'audio';

  return (
    <div className="flex flex-col h-full">
      {reviewMode === 'full' ? (
        <FullReviewCardContent
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
          onAudioPlay={audio.stop}
          targetAudioMode={state.courseSettings.fullReviewTargetAudioMode ?? 'afterSubmit'}
        />
      ) : (
        <LearningCardContent
          preReviewCount={state.preReviewCount}
          schedulingPhase={state.phase}
          fsrsState={state.fsrsState}
          sourceText={state.sourceText}
          translations={state.translations}
          audioRecordings={state.audioRecordings}
          isFavorite={state.isFavorite}
          isPendingMaster={state.isPendingMaster}
          isPendingHide={state.isPendingHide}
          onMaster={state.handleMaster}
          onHide={state.handleHide}
          onFavorite={state.handleFavorite}
          onAudioPlay={audio.stop}
          hideTargetLanguages={state.courseSettings.hideTargetLanguages ?? true}
          autoRevealLanguages={state.courseSettings.autoRevealLanguages ?? false}
          revealedLanguages={audio.revealedLanguages}
        />
      )}

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
