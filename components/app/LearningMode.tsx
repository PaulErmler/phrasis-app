'use client';

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import {
  LearningCardContent,
  FullReviewCardContent,
  LearningControls,
  NoCollectionState,
  NoCardsDueState,
} from '@/components/app/learning';
import type { LearningState } from '@/components/app/learning/useLearningMode';
import type { ReviewRating } from '@/lib/scheduling';
import type { AudioPlayerState } from '@/hooks/use-audio-player';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
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
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [fullReviewRevealed, setFullReviewRevealed] = useState(false);
  const [allSubmitted, setAllSubmitted] = useState(false);
  const [fullReviewAccuracy, setFullReviewAccuracy] = useState<number | null>(null);
  const [audioAllTargetsRevealed, setAudioAllTargetsRevealed] = useState(true);
  const [audioRevealNonce, setAudioRevealNonce] = useState(0);

  const cardId = state.status === 'reviewing' ? state.cardId : null;
  useEffect(() => {
    setFullReviewRevealed(false);
    setAllSubmitted(false);
    setFullReviewAccuracy(null);
  }, [cardId]);

  const reviewingReviewMode =
    state.status === 'reviewing'
      ? (state.courseSettings.reviewMode ?? 'audio')
      : null;
  const reviewingHideTargets =
    state.status === 'reviewing'
      ? (state.courseSettings.hideTargetLanguages ?? true)
      : null;

  useEffect(() => {
    if (reviewingReviewMode !== 'audio' || reviewingHideTargets === null) return;
    setAudioAllTargetsRevealed(!reviewingHideTargets);
    setAudioRevealNonce(0);
  }, [cardId, reviewingReviewMode, reviewingHideTargets]);

  const handleReveal = useCallback(() => setFullReviewRevealed(true), []);

  // Per-card speed override mutation with an optimistic update so the badge
  // displays the new value immediately without waiting for the server round
  // trip. The Convex query validator returns `audioSpeedOverrides` as part of
  // the card payload, so we mutate that field on the cached card.
  const setCardAudioSpeedOverrideMutation = useMutation(
    api.features.scheduling.setCardAudioSpeedOverride,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.scheduling.getCardForReview,
      {},
    );
    if (current == null || current._id !== args.cardId) return;
    const nextOverrides: Record<string, number> = {
      ...(current.audioSpeedOverrides ?? {}),
    };
    if (args.speed === null) {
      delete nextOverrides[args.language];
    } else {
      nextOverrides[args.language] = args.speed;
    }
    localStore.setQuery(api.features.scheduling.getCardForReview, {}, {
      ...current,
      audioSpeedOverrides: nextOverrides,
    });
  });

  const reviewingCardId = state.status === 'reviewing' ? state.cardId : null;
  const handleSpeedCycle = useCallback(
    (language: string, next: number | null) => {
      if (reviewingCardId === null) return;
      setCardAudioSpeedOverrideMutation({
        cardId: reviewingCardId,
        language,
        speed: next,
      });
    },
    [reviewingCardId, setCardAudioSpeedOverrideMutation],
  );

  // Wrap handleNext to include accuracy from full review mode
  const handleNextWithAccuracy = useCallback(
    (ratingOverride?: ReviewRating) => {
      if (state.status !== 'reviewing') return;
      state.handleNext(ratingOverride, fullReviewAccuracy ?? undefined);
    },
    [state, fullReviewAccuracy],
  );
  const handleRevealAllAudioTargets = useCallback(() => {
    setAudioRevealNonce((n) => n + 1);
  }, []);
  const handleEdit = useCallback(() => {
    audio.pause();
    setEditDialogOpen(true);
  }, [audio]);

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
          showProgressBar={false}
          shortcutsDisabled={state.settingsOpen}
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
          remainingInCollection={state.remainingInCollection}
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
  const instantProceed = reviewMode === 'full'
    ? (state.courseSettings.instantProceedFull ?? true)
    : (state.courseSettings.instantProceedAudio ?? false);

  const cardContent =
    reviewMode === 'full' ? (
      <FullReviewCardContent
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
        onEdit={handleEdit}
        onAudioPlay={audio.stop}
        targetAudioMode={state.courseSettings.fullReviewTargetAudioMode ?? 'afterSubmit'}
        allRevealed={fullReviewRevealed}
        onAllSubmittedChange={setAllSubmitted}
        onAccuracyChange={setFullReviewAccuracy}
        showRomanization={state.courseSettings.showRomanization ?? true}
        cardId={state.cardId}
        shortcutsDisabled={state.settingsOpen || editDialogOpen}
        highlightEnabled={state.courseSettings.highlightWords !== false}
        mergedPlayback={{
          isPlaying: audio.isPlaying,
          currentTime: audio.currentTime,
          languageCues: audio.languageCues,
          speedByLanguage: audio.speedByLanguage,
        }}
        languagePlaybackSpeeds={state.courseSettings.languagePlaybackSpeeds}
        audioSpeedOverrides={state.audioSpeedOverrides}
        onSpeedCycle={handleSpeedCycle}
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
        onEdit={handleEdit}
        onAudioPlay={audio.stop}
        hideTargetLanguages={state.courseSettings.hideTargetLanguages ?? true}
        autoRevealLanguages={state.courseSettings.autoRevealLanguages ?? true}
        revealedLanguages={audio.revealedLanguages}
        showRomanization={state.courseSettings.showRomanization ?? true}
        revealAllSignal={audioRevealNonce}
        onAllTargetsRevealedChange={setAudioAllTargetsRevealed}
        highlightEnabled={state.courseSettings.highlightWords !== false}
        mergedPlayback={{
          isPlaying: audio.isPlaying,
          currentTime: audio.currentTime,
          languageCues: audio.languageCues,
          speedByLanguage: audio.speedByLanguage,
        }}
        languagePlaybackSpeeds={state.courseSettings.languagePlaybackSpeeds}
        audioSpeedOverrides={state.audioSpeedOverrides}
        onSpeedCycle={handleSpeedCycle}
      />
    );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait" initial={false}>
          {!state.isExiting && (
            <motion.div
              key={state.animationKey}
              className="h-full flex flex-col"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15, ease: 'easeInOut' }}
            >
              {cardContent}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
        onNext={handleNextWithAccuracy}
        isReviewing={state.isReviewing}
        showProgressBar={state.courseSettings.showProgressBar ?? false}
        instantProceed={instantProceed}
        isFullReview={reviewMode === 'full'}
        fullReviewRevealed={fullReviewRevealed || allSubmitted}
        onReveal={handleReveal}
        shortcutsDisabled={state.settingsOpen || editDialogOpen}
        isAudioReview={reviewMode === 'audio'}
        audioAllTargetsRevealed={audioAllTargetsRevealed}
        onRevealAllAudioTargets={handleRevealAllAudioTargets}
      />

      <LearningModeSettings
        open={state.settingsOpen}
        onOpenChange={state.setSettingsOpen}
        courseSettings={state.courseSettings}
        baseLanguages={state.baseLanguages}
        targetLanguages={state.targetLanguages}
      />

      <EditCardDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        cardId={state.cardId}
        translations={state.translations}
      />
    </div>
  );
}
