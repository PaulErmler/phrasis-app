'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useUpdateStudyContentFilter } from '@/hooks/use-update-study-content-filter';
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
import { buildSessionSnapshot } from '@/components/app/learning/sessionSnapshot';
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
  /** Navigate to chat (filter-blocked empty state when filter=custom). */
  onNavigateToChat: () => void;
  /** Navigate to the custom-card creation page (same condition). */
  onNavigateToAddCustomCards: () => void;
  /**
   * Render mode. In `'onboarding'`, the LearningModeSettings sheet is
   * suppressed so the user can't slip into deep settings during their guided
   * first lesson. Other behaviour (chat, FSRS, audio) is unchanged.
   */
  mode?: 'normal' | 'onboarding';
  /**
   * Fires after the user rates a card and the FSRS update is in flight.
   * Receives the rating + a snapshot of the session counters so the
   * onboarding wizard can advance / surface stats without spinning up its
   * own counter logic.
   */
  onCardRated?: (
    rating: ReviewRating | undefined,
    snapshot: {
      sessionId: string;
      dailyReviewsToday: number;
      dailyTimeMsToday: number;
      dailyNewWordsToday: number;
    },
  ) => void;
  /**
   * Fires after an undo actually reverted a review — the mirror image of
   * `onCardRated`, so the onboarding wizard can decrement its rated-card
   * counter and keep the lesson progress accurate.
   */
  onCardUndone?: (snapshot: {
    sessionId: string;
    dailyReviewsToday: number;
    dailyTimeMsToday: number;
    dailyNewWordsToday: number;
  }) => void;
}

/**
 * Learning mode body content (card, controls, settings).
 * Does NOT render its own header — the parent layout handles that.
 */
export function LearningMode({
  state,
  audio,
  onGoHome,
  onNavigateToChat,
  onNavigateToAddCustomCards,
  mode = 'normal',
  onCardRated,
  onCardUndone,
}: LearningModeProps) {
  const t = useTranslations('LearningMode');
  const chatContext = useLearningChatToggle();
  if (!chatContext) {
    throw new Error('LearningMode must be rendered inside LearningChatLayout');
  }
  const { openChat } = chatContext;
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flagConfirmOpen, setFlagConfirmOpen] = useState(false);
  const [fullReviewRevealed, setFullReviewRevealed] = useState(false);

  // Stable merged-playback surface for the card content. Identity only
  // changes on play/pause or a re-merge — NOT per frame; per-frame time
  // lives in audio.clock (see useActiveCue / useKaraokeIndex).
  const mergedPlayback = useMemo(
    () => ({
      isPlaying: audio.isPlaying,
      clock: audio.clock,
      languageCues: audio.languageCues,
      speedByLanguage: audio.speedByLanguage,
    }),
    [audio.isPlaying, audio.clock, audio.languageCues, audio.speedByLanguage],
  );
  const [allSubmitted, setAllSubmitted] = useState(false);
  const [fullReviewAccuracy, setFullReviewAccuracy] = useState<number | null>(null);
  const [audioAllTargetsRevealed, setAudioAllTargetsRevealed] = useState(true);
  const [audioRevealNonce, setAudioRevealNonce] = useState(0);

  const cardId = state.status === 'reviewing' ? state.cardId : null;
  const reviewingReviewMode =
    state.status === 'reviewing'
      ? (state.courseSettings.reviewMode ?? 'audio')
      : null;
  const reviewingWritingInputMode =
    state.status === 'reviewing'
      ? (state.courseSettings.writingInputMode ?? 'translate')
      : null;
  // Reset on a mode/style switch too (not just on card change) so toggling
  // shadowing ↔ writing (or translate ↔ transcribe) brings the card back to
  // its initial hidden state.
  useEffect(() => {
    setFullReviewRevealed(false);
    setAllSubmitted(false);
    setFullReviewAccuracy(null);
  }, [cardId, reviewingReviewMode, reviewingWritingInputMode]);

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

  // `audioAllTargetsRevealed` is driven entirely by LearningCardContent's
  // report (it fires on mount and on every change of its computed value,
  // which matches the actual blur state). Forcing it back to "hidden" here on
  // card/mode changes could contradict the child's unchanged computed value —
  // the child then never re-reports, leaving the button stuck on "Reveal"
  // while every target is already visible (so pressing it did nothing).
  // The reveal nonce is likewise monotonic — never reset — so the child can
  // treat any change as a fresh "reveal all" request.

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

  // Wrap handleNext to include accuracy from full review mode + notify the
  // onboarding container (if any) that a card was just rated, along with a
  // session-state snapshot so the wizard can show the celebration screen.
  const handleNextWithAccuracy = useCallback(
    (ratingOverride?: ReviewRating) => {
      if (state.status !== 'reviewing') return;
      state.handleNext(ratingOverride, fullReviewAccuracy ?? undefined);
      onCardRated?.(ratingOverride, buildSessionSnapshot(state));
    },
    [state, fullReviewAccuracy, onCardRated],
  );
  // Mirror of handleNextWithAccuracy for the undo direction — only notifies
  // when a review was actually reverted (empty stack / races resolve false).
  const handleUndoWithNotify = useCallback(async () => {
    if (state.status !== 'reviewing') return;
    const undone = await state.handleUndo();
    if (undone) onCardUndone?.(buildSessionSnapshot(state));
  }, [state, onCardUndone]);
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
  // Card-level flag — the mutation flags every non-source-language
  // translation on the card at once, so no per-language pick here.
  const handleConfirmFlag = useCallback(async () => {
    if (state.status !== 'reviewing') return;
    setFlagConfirmOpen(false);
    await state.handleFlag();
  }, [state]);
  // Declared up here (above the early returns) so its `useCallback` keeps a
  // stable position in the hook list across loading → reviewing transitions.
  // Gates on status internally — non-reviewing states get a no-op.
  const handleRegenerateAudioWithPause = useCallback(() => {
    if (state.status !== 'reviewing') return;
    audio.pause();
    void state.handleRegenerateAudio();
  }, [audio, state]);

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
          isPlaying={audio.isPlaying}
          isMerging={audio.isMerging}
          durationSec={audio.durationSec}
          onSeek={audio.seekTo}
          onNext={() => {}}
          onUndo={() => {}}
          undoDisabled={true}
          isReviewing={true}
          shortcutsDisabled={state.settingsOpen}
        />
      </div>
    );
  }

  if (state.status === 'noCollection') {
    return (
      <div className="flex flex-col h-full">
        <NoCollectionState onGoHome={onGoHome} />
        {mode === 'onboarding' ? null : (
          <LearningModeSettings
            open={state.settingsOpen}
            onOpenChange={state.setSettingsOpen}
            courseSettings={state.courseSettings}
            baseLanguages={state.baseLanguages}
            targetLanguages={state.targetLanguages}
          />
        )}
      </div>
    );
  }

  if (state.status === 'noCardsDue') {
    return (
      <div className="flex flex-col h-full">
        <NoCardsDueWithFilter
          handleAddCards={state.handleAddCards}
          isAddingCards={state.isAddingCards}
          batchSize={state.batchSize}
          sentencesRemaining={state.sentencesRemaining}
          remainingInCollection={state.remainingInCollection}
          courseId={state.courseSettings.courseId}
          onUpgrade={() => setPaywallOpen(true)}
          onNavigateToChat={onNavigateToChat}
          onNavigateToAddCustomCards={onNavigateToAddCustomCards}
        />
        {mode === 'onboarding' ? null : (
          <LearningModeSettings
            open={state.settingsOpen}
            onOpenChange={state.setSettingsOpen}
            courseSettings={state.courseSettings}
            baseLanguages={state.baseLanguages}
            targetLanguages={state.targetLanguages}
          />
        )}
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
  const isTranscribe =
    reviewMode === 'full' &&
    (state.courseSettings.writingInputMode ?? 'translate') === 'transcribe';
  // Transcribe: the post-submit replay rides the same per-language afterSubmit
  // machinery as Translate, gated by the transcribe auto-play setting
  // (chained `*Transcribe ?? *Full ?? audio`).
  const writingAutoPlay = isTranscribe
    ? (state.courseSettings.autoPlayAudioTranscribe ??
      state.courseSettings.autoPlayAudioFull ??
      state.courseSettings.autoPlayAudio ??
      DEFAULT_AUTO_PLAY)
    : (state.courseSettings.autoPlayAudioFull ??
      state.courseSettings.autoPlayAudio ??
      DEFAULT_AUTO_PLAY);

  // Flagging acts at the card level — the mutation retranslates every
  // non-source-language translation on the card. We hide the button when
  // there's no target translation to display since "flag" makes little
  // sense to the learner on a card they can't actually review.
  const hasTargetTranslation = state.translations.some(
    (tr) => tr.isTargetLanguage,
  );
  // Flag opens a confirmation dialog instead of firing immediately: the
  // action triggers a background retranslation that overwrites the
  // currently-displayed text, so we want an explicit confirm step. The
  // actual flag fires in `handleConfirmFlag` below; the card itself is
  // not deleted.
  const handleFlagPrimary = hasTargetTranslation
    ? () => {
      audio.pause();
      setFlagConfirmOpen(true);
    }
    : undefined;

  const cardContent =
    reviewMode === 'full' ? (
      <FullReviewCardContent
        // Remount on a translate ↔ transcribe switch so typed text,
        // submissions, and manual base reveals reset to the card's initial
        // state (shadowing ↔ writing already resets via the conditional
        // render swapping the component out).
        key={isTranscribe ? 'transcribe' : 'translate'}
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
        onFlag={handleFlagPrimary}
        onRegenerateAudio={handleRegenerateAudioWithPause}
        pinnedActions={state.pinnedCardActions}
        onUpdatePinnedActions={state.handleUpdatePinnedActions}
        quotaState={state.cardActionQuotas}
        onAudioPlay={audio.stop}
        // Transcribe: the merged blob plays the target as the prompt; the
        // per-language afterSubmit playback doubles as the post-submit
        // replay, gated by the writing-mode auto-play setting.
        targetAudioMode={
          isTranscribe
            ? writingAutoPlay
              ? 'afterSubmit'
              : 'never'
            : (state.courseSettings.fullReviewTargetAudioMode ?? 'afterSubmit')
        }
        transcribeMode={isTranscribe}
        afterSubmitRepetitions={
          isTranscribe
            ? state.courseSettings.transcribeAfterRepetitions
            : (state.courseSettings.languageRepetitionsFull ??
              state.courseSettings.languageRepetitions)
        }
        afterSubmitRepetitionPauses={
          isTranscribe
            ? state.courseSettings.transcribeAfterRepetitionPauses
            : (state.courseSettings.languageRepetitionPausesFull ??
              state.courseSettings.languageRepetitionPauses)
        }
        afterSubmitPlaybackSpeeds={
          isTranscribe
            ? state.courseSettings.transcribeAfterPlaybackSpeeds
            : undefined
        }
        // Blur the base by default in Transcribe (the prompt is the target
        // audio, so a visible base gives the answer away); Translate needs
        // the base text visible and defaults to off.
        hideBaseLanguages={state.courseSettings.hideBaseLanguagesFull ?? isTranscribe}
        autoRevealBaseOnSubmit={
          state.courseSettings.autoRevealBaseOnSubmit ?? true
        }
        ignorePunctuation={state.courseSettings.ignorePunctuation ?? false}
        suppressAutoPlay={state.settingsOpen}
        allRevealed={fullReviewRevealed}
        onAllSubmittedChange={setAllSubmitted}
        onAccuracyChange={setFullReviewAccuracy}
        showRomanization={state.courseSettings.showRomanization ?? true}
        cardId={state.cardId}
        shortcutsDisabled={state.settingsOpen || editDialogOpen}
        highlightEnabled={
          (isTranscribe
            ? (state.courseSettings.highlightWordsTranscribe ??
              state.courseSettings.highlightWordsFull ??
              state.courseSettings.highlightWords)
            : (state.courseSettings.highlightWordsFull ??
              state.courseSettings.highlightWords)) === true
        }
        flaggedInSession={state.flaggedInSession}
        mergedPlayback={mergedPlayback}
        languagePlaybackSpeeds={
          isTranscribe
            ? (state.courseSettings.languagePlaybackSpeedsTranscribe ??
              state.courseSettings.languagePlaybackSpeedsFull ??
              state.courseSettings.languagePlaybackSpeeds)
            : (state.courseSettings.languagePlaybackSpeedsFull ??
              state.courseSettings.languagePlaybackSpeeds)
        }
        audioSpeedOverrides={state.audioSpeedOverrides}
        onSpeedCycle={handleSpeedCycle}
        audioRef={audio.audioRef}
        durationSec={audio.durationSec}
        isPlaying={audio.isPlaying}
        isMerging={audio.isMerging}
        onSeek={audio.seekTo}
        showProgressBar={state.courseSettings.showProgressBar ?? true}
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
        onFlag={handleFlagPrimary}
        onRegenerateAudio={handleRegenerateAudioWithPause}
        pinnedActions={state.pinnedCardActions}
        onUpdatePinnedActions={state.handleUpdatePinnedActions}
        quotaState={state.cardActionQuotas}
        onAudioPlay={audio.stop}
        hideTargetLanguages={state.courseSettings.hideTargetLanguages ?? true}
        autoRevealLanguages={state.courseSettings.autoRevealLanguages ?? true}
        hideBaseLanguages={state.courseSettings.hideBaseLanguages === true}
        autoRevealBaseLanguages={state.courseSettings.autoRevealBaseLanguages ?? true}
        revealedLanguages={audio.revealedLanguages}
        showRomanization={state.courseSettings.showRomanization ?? true}
        revealAllSignal={audioRevealNonce}
        onAllTargetsRevealedChange={setAudioAllTargetsRevealed}
        highlightEnabled={state.courseSettings.highlightWords === true}
        flaggedInSession={state.flaggedInSession}
        mergedPlayback={mergedPlayback}
        languagePlaybackSpeeds={state.courseSettings.languagePlaybackSpeeds}
        audioSpeedOverrides={state.audioSpeedOverrides}
        onSpeedCycle={handleSpeedCycle}
        audioRef={audio.audioRef}
        durationSec={audio.durationSec}
        isPlaying={audio.isPlaying}
        isMerging={audio.isMerging}
        onSeek={audio.seekTo}
        showProgressBar={state.courseSettings.showProgressBar ?? true}
      />
    );

  const isRadio = state.courseSettings.schedulingMode === 'radio';

  return (
    <div className="flex flex-col h-full">
      {/* Normal mode: bar tracks `dailyReviewsToday` (audio + full, server-
          persisted, hydrated on mount) so the fill level always matches when
          the milestone celebration will fire, even after a reload or a break
          mid-day. Onboarding keeps its in-memory session counter (0/10 lesson
          progress). Radio mode never shows the bar since plays don't count
          toward the milestone. */}
      {!isRadio &&
        state.courseSettings.progressDisplayEnabled !== false && (
        <SessionProgressBar
          current={mode === 'onboarding' ? state.sessionCardCount : state.dailyReviewsToday}
          max={mode === 'onboarding' ? 10 : undefined}
        />
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
            data-coachmark-anchor="chat-button"
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
        isPlaying={audio.isPlaying}
        isMerging={audio.isMerging}
        durationSec={audio.durationSec}
        onSeek={audio.seekTo}
        onNext={handleNextWithAccuracy}
        onUndo={handleUndoWithNotify}
        undoDisabled={!state.canUndo || state.isReviewing || state.isUndoing}
        isReviewing={state.isReviewing}
        instantProceed={instantProceed}
        isFullReview={reviewMode === 'full'}
        fullReviewRevealed={fullReviewRevealed || allSubmitted}
        onReveal={handleReveal}
        shortcutsDisabled={state.settingsOpen || editDialogOpen}
        isAudioReview={reviewMode === 'audio'}
        audioAllTargetsRevealed={audioAllTargetsRevealed}
        onRevealAllAudioTargets={handleRevealAllAudioTargets}
      />

      {mode === 'onboarding' ? null : (
        <LearningModeSettings
          open={state.settingsOpen}
          onOpenChange={state.setSettingsOpen}
          courseSettings={state.courseSettings}
          baseLanguages={state.baseLanguages}
          targetLanguages={state.targetLanguages}
        />
      )}

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

      <AlertDialog open={flagConfirmOpen} onOpenChange={setFlagConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('actions.flagConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('actions.flagConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('actions.flagConfirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmFlag}>
              {t('actions.flagConfirmConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Wraps NoCardsDueState with the filter-aware empty-reason query so that
 * "no card returned" is correctly attributed to the content-source filter
 * when applicable. When the filter is hiding cards AND flipping to the
 * other source would surface some, the UI offers a one-tap unblock CTA.
 *
 * `customCardsPendingAdd` mirrors the `addCardsFromCollection` Phase 1
 * branch: any text in `activeCustomCollectionIds` that hasn't been pulled
 * yet is free to add (custom cards don't consume the `SENTENCES` quota —
 * see decks.ts). The upgrade button is gated on this so a user with custom
 * cards still queued never gets a misleading paywall.
 */
function NoCardsDueWithFilter({
  handleAddCards,
  isAddingCards,
  batchSize,
  sentencesRemaining,
  remainingInCollection,
  courseId,
  onUpgrade,
  onNavigateToChat,
  onNavigateToAddCustomCards,
}: {
  handleAddCards: () => void;
  isAddingCards: boolean;
  batchSize: number;
  sentencesRemaining?: number | null;
  remainingInCollection?: number | null;
  courseId: Id<'courses'>;
  onUpgrade: () => void;
  onNavigateToChat: () => void;
  onNavigateToAddCustomCards: () => void;
}) {
  const emptyReason = useQuery(
    api.features.scheduling.getCardForReviewEmptyReason,
    {},
  );
  const updateSettings = useUpdateStudyContentFilter();

  const isDeckEmpty = emptyReason?.reason === 'no_cards';
  const activeFilter = emptyReason?.reason === 'filtered_out'
    ? emptyReason.activeFilter
    : null;
  const filterUnblockAvailable = emptyReason?.reason === 'filtered_out'
    ? emptyReason.availableInOtherSource
    : false;
  const currentSourceHasAnyCards = emptyReason?.reason === 'filtered_out'
    ? emptyReason.currentSourceHasAnyCards
    : true;
  // Only the filtered_out and all_caught_up variants carry this field; for
  // no_cards / no_session / undefined, default to false (no custom queue).
  const customCardsPendingAdd =
    emptyReason?.reason === 'filtered_out' ||
    emptyReason?.reason === 'all_caught_up'
      ? emptyReason.customCardsPendingAdd
      : false;

  const handleIncludeOtherSource = useCallback(() => {
    updateSettings({ courseId, studyContentFilter: 'both' });
  }, [updateSettings, courseId]);

  return (
    <NoCardsDueState
      onAddCards={handleAddCards}
      isAddingCards={isAddingCards}
      batchSize={batchSize}
      sentencesRemaining={sentencesRemaining}
      remainingInCollection={remainingInCollection}
      onUpgrade={onUpgrade}
      isDeckEmpty={isDeckEmpty}
      activeFilter={activeFilter}
      currentSourceHasAnyCards={currentSourceHasAnyCards}
      filterUnblockAvailable={filterUnblockAvailable}
      customCardsPendingAdd={customCardsPendingAdd}
      onIncludeOtherSource={handleIncludeOtherSource}
      onCreateChatCards={onNavigateToChat}
      onCreateCustomCards={onNavigateToAddCustomCards}
    />
  );
}
