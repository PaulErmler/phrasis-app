'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { LearningModeSettings } from '@/components/app/LearningModeSettings';
import {
  LearningCardContent,
  FullReviewCardContent,
  LearningControls,
  NoCollectionState,
  NoCardsDueState,
  ProgressDisplay,
  SessionProgressBar,
} from '@/components/app/learning';
import { useLearningChatToggle } from '@/components/app/learning/LearningChatLayout';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import type { LearningState } from '@/components/app/learning/useLearningMode';
import type { ReviewRating } from '@/lib/scheduling';
import type { AudioPlayerState } from '@/hooks/use-audio-player';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { DEFAULT_AUTO_PLAY } from '@/lib/constants/audioPlayback';
import { PROGRESS_SOUND_URL } from '@/lib/constants/learning';

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
  const t = useTranslations('LearningMode');
  const chatContext = useLearningChatToggle();
  if (!chatContext) {
    throw new Error('LearningMode must be rendered inside LearningChatLayout');
  }
  const { openChat } = chatContext;
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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

  // Warm the celebration sound's HTTP cache at session start so the very
  // first celebration's animation timeline (hardcoded peaks at 1290/1610/
  // 1925 ms in ProgressDisplay) isn't ahead of audio playback on mobile
  // cold-cache loads.
  useEffect(() => {
    const audio = new Audio(PROGRESS_SOUND_URL);
    audio.preload = 'auto';
    audio.load();
  }, []);

  // Pause card audio while the celebration screen is showing — the success
  // sound and Media Session belong to it, not the underlying card. When the
  // celebration dismisses, resume autoplay for the now-visible card if the
  // user has it enabled (the audio hook only auto-plays on cardId change, so
  // we trigger it explicitly here on the celebration → card handoff).
  // The celebration is now lifted to BaseState so it survives a transition
  // from `reviewing` to `noCardsDue` (milestone hit on the very last card).
  const progressDisplayActive = state.progressDisplayActive;
  // Mirror useLearningAudio's default exactly — `autoPlayAudio` is opt-out
  // (DEFAULT_AUTO_PLAY = true), not opt-in.
  const autoPlayAudio =
    state.status === 'reviewing'
      ? (state.courseSettings.autoPlayAudio ?? DEFAULT_AUTO_PLAY)
      : false;
  // Capture audio + setting via refs so the celebration-flag effect depends
  // only on `progressDisplayActive` — `useLearningAudio` returns a fresh
  // object on every render, which would otherwise cause that effect to
  // re-run (and call `audio.pause()`) on every parent render.
  const autoPlayAudioRef = useRef(autoPlayAudio);
  const audioRef = useRef(audio);
  useEffect(() => {
    autoPlayAudioRef.current = autoPlayAudio;
    audioRef.current = audio;
  });
  const wasProgressActiveRef = useRef(false);
  useEffect(() => {
    if (progressDisplayActive) {
      audioRef.current.pause();
      wasProgressActiveRef.current = true;
      return;
    }
    if (wasProgressActiveRef.current) {
      wasProgressActiveRef.current = false;
      if (autoPlayAudioRef.current) audioRef.current.play();
    }
  }, [progressDisplayActive]);

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
  const handleRequestDelete = useCallback(() => {
    audio.pause();
    setDeleteConfirmOpen(true);
  }, [audio]);
  const handleConfirmDelete = useCallback(async () => {
    if (state.status !== 'reviewing') return;
    setDeleteConfirmOpen(false);
    await state.handleDelete();
  }, [state]);

  // Top-level celebration: shown across every underlying status so a milestone
  // hit on the very last card still gets celebrated before "no cards due"
  // takes over. Render before any status switch so it never gets unmounted by
  // a state transition mid-celebration.
  if (state.progressDisplayActive) {
    return (
      <div className="flex flex-col h-full">
        <ProgressDisplay
          sessionId={state.sessionId}
          dailyReviewsToday={state.dailyReviewsToday}
          dailyTimeMsToday={state.dailyTimeMsToday}
          dailyNewWordsToday={state.dailyNewWordsToday}
          schedulingMode={state.schedulingMode}
          reviewMode={state.reviewMode}
          autoAdvance={state.autoAdvance}
          ready={state.progressDisplayReady}
          onContinue={state.dismissProgressDisplay}
        />
      </div>
    );
  }

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
        onDelete={handleRequestDelete}
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
        onDelete={handleRequestDelete}
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
      {state.courseSettings.progressDisplayEnabled !== false && (
        <SessionProgressBar dailyReviewsToday={state.dailyReviewsToday} />
      )}
      <div className="flex-1 min-h-0 relative">
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
        {/* Transparent overlay above the footer border so long card content
            stays visible behind the chat button on small screens. */}
        <div className="lg:hidden absolute inset-x-0 bottom-0 max-w-lg mx-auto flex justify-end px-4 pb-3 pointer-events-none">
          <Button
            variant="outline"
            size="icon"
            onClick={openChat}
            className="h-9 w-9 shrink-0 pointer-events-auto"
            aria-label="Open chat"
            data-tutorial="chat-button"
          >
            <MessageCircle className="h-5 w-5" />
          </Button>
        </div>
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

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('actions.deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('actions.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('actions.deleteConfirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={handleConfirmDelete}
            >
              {t('actions.deleteConfirmConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
