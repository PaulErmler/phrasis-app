'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useUpdateCourseSettings } from '@/hooks/use-update-course-settings';
import { useNowMinute } from '@/hooks/use-now-minute';
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
import { buildCardOriginPill } from '@/components/app/learning/cardOriginPill';
import {
  isTranscribeMode,
  shouldShowTranslationAssist,
} from '@/components/app/learning/firstExposure';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
import type { LearningState } from '@/components/app/learning/useLearningMode';
import type { CardPresentation } from '@/components/app/learning/cardPresentation';
import type { ReviewRating } from '@/lib/scheduling';
import { autoRating } from '@/lib/autoRating';
import type {
  WritingAccuracySummary,
  ReviewAccuracyPayload,
} from './learning/types';
import type { AudioPlayerState } from '@/hooks/use-audio-player';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { CardActionConfirmDialogs } from '@/components/app/learning/useCardActions';
import { COACHMARK_ANCHORS, TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import { DEFAULT_AUTO_PLAY } from '@/lib/constants/audioPlayback';
import {
  resolveModeSetting,
  resolveSettingsMode,
  type AudioSettingsMode,
} from '@/lib/audio/mergeAudio';
import {
  installCelebrationSoundUnlock,
  warmCelebrationSound,
} from '@/lib/audio/celebrationSound';
import { resolveShowFurigana } from '@/lib/furigana';

interface LearningModeProps {
  state: LearningState;
  audio: AudioPlayerState;
  onGoHome: () => void;
  /** Navigate to chat (filter-blocked empty state when filter=custom). */
  onNavigateToChat: () => void;
  /** Navigate to the custom-card creation page (same condition). */
  onNavigateToAddCustomCards: () => void;
}

/**
 * Learning mode body content (card, controls, settings).
 * Does NOT render its own header. The parent layout handles that.
 */
export function LearningMode({
  state,
  audio,
  onGoHome,
  onNavigateToChat,
  onNavigateToAddCustomCards,
}: LearningModeProps) {
  const t = useTranslations('LearningMode');
  const chatContext = useLearningChatToggle();
  if (!chatContext) {
    throw new Error('LearningMode must be rendered inside LearningChatLayout');
  }
  const { openChat } = chatContext;
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [fullReviewRevealed, setFullReviewRevealed] = useState(false);

  // Stable merged-playback surface for the card content. Identity only
  // changes on play/pause or a re-merge, NOT per frame; per-frame time
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
  const [writingAccuracy, setWritingAccuracy] =
    useState<WritingAccuracySummary | null>(null);
  const [audioAllTargetsRevealed, setAudioAllTargetsRevealed] = useState(true);
  const [audioRevealNonce, setAudioRevealNonce] = useState(0);
  // Monotonic signals for the keyboard shortcuts: T replays the target clip,
  // Shift+R resets the card. Never reset. The children treat any change as
  // a fresh request (same contract as audioRevealNonce).
  const [targetReplayNonce, setTargetReplayNonce] = useState(0);
  const [cardResetNonce, setCardResetNonce] = useState(0);

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
    setWritingAccuracy(null);
  }, [cardId, reviewingReviewMode, reviewingWritingInputMode]);

  // Warm the celebration sound at session start and unlock its shared
  // element on the first tap / key. The celebration itself mounts after a
  // mutation resolves (never inside a gesture), so without this WebKit
  // refuses its `play()` and the milestone screen runs silent. See
  // lib/audio/celebrationSound.ts.
  useEffect(() => {
    warmCelebrationSound();
    return installCelebrationSoundUnlock();
  }, []);

  // Pause card audio while the celebration screen is showing. The success
  // sound and Media Session belong to it, not the underlying card. When the
  // celebration dismisses, resume autoplay for the now-visible card if the
  // user has it enabled (the audio hook only auto-plays on cardId change, so
  // we trigger it explicitly here on the celebration → card handoff).
  // The celebration is now lifted to BaseState so it survives a transition
  // from `reviewing` to `noCardsDue` (milestone hit on the very last card).
  const progressDisplayActive = state.progressDisplayActive;
  // Mirror useLearningAudio's default exactly. `autoPlayAudio` is opt-out
  // (DEFAULT_AUTO_PLAY = true), not opt-in.
  const autoPlayAudio =
    state.status === 'reviewing'
      ? (state.courseSettings.autoPlayAudio ?? DEFAULT_AUTO_PLAY)
      : false;
  // Capture audio + setting via refs so the celebration-flag effect depends
  // only on `progressDisplayActive`. `useLearningAudio` returns a fresh
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
  // card/mode changes could contradict the child's unchanged computed value.
  // The child then never re-reports, leaving the button stuck on "Reveal"
  // while every target is already visible (so pressing it did nothing).
  // The reveal nonce is likewise monotonic, never reset, so the child can
  // treat any change as a fresh "reveal all" request.

  const handleReveal = useCallback(() => setFullReviewRevealed(true), []);

  // Per-card speed override mutation with an optimistic update so the badge
  // displays the new value immediately without waiting for the server round
  // trip. The Convex query validator returns `audioSpeedOverrides` as part of
  // the card payload, so we mutate that field on the cached card.
  const setCardAudioSpeedOverrideMutation = useMutation(
    api.features.scheduling.setCardAudioSpeedOverride,
  ).withOptimisticUpdate((localStore, args) => {
    // Patch every cached getCardForReview instance (args carry timezone +
    // minute-quantized `now`, so the key varies); matching all instances
    // keeps the optimistic write applying regardless of args.
    for (const q of localStore.getAllQueries(
      api.features.scheduling.getCardForReview,
    )) {
      if (q.value == null || q.value._id !== args.cardId) continue;
      const nextOverrides: Record<string, number> = {
        ...(q.value.audioSpeedOverrides ?? {}),
      };
      if (args.speed === null) {
        delete nextOverrides[args.language];
      } else {
        nextOverrides[args.language] = args.speed;
      }
      localStore.setQuery(api.features.scheduling.getCardForReview, q.args, {
        ...q.value,
        audioSpeedOverrides: nextOverrides,
      });
    }
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

  // Auto-rating: derive a rating from the WORST target language submitted so
  // far, so a perfect answer in one language can't mask a failed one in
  // another. Pushed into the hook rather than computed there because the
  // summary lives here. It only ever preselects, nothing advances the card.
  const settingsForAutoRate =
    state.status === 'reviewing' ? state.courseSettings : null;
  // A copy-through card ("Abschreiben") prints the target above the input, so
  // a verbatim copy scores 100%. That is not recall, so it must neither
  // preselect a rating nor reach the accuracy series, otherwise instantProceed
  // graduates the card on a copy and the stats read as a perfect answer.
  // Recomputed here because the render-time `firstExposure` below sits after
  // this component's early returns, and hooks have to run before those.
  const autoRateFirstExposure =
    state.status === 'reviewing' &&
    shouldShowTranslationAssist(
      state.courseSettings,
      state.preReviewCount,
      state.fsrsState?.reps ?? 0,
      state.freeStudyPlayCount,
    );
  const autoRateEnabled =
    (settingsForAutoRate?.reviewMode ?? 'audio') === 'full' &&
    (settingsForAutoRate?.autoRateFromAccuracy ?? true) &&
    !autoRateFirstExposure;
  const autoRateAccuracy =
    (settingsForAutoRate?.ignorePunctuation ?? false)
      ? writingAccuracy?.minWithoutPunctuation
      : writingAccuracy?.minWithPunctuation;
  const autoRateThresholds = settingsForAutoRate?.autoRateThresholds;
  const setAutoRating = state.setAutoRating;
  useEffect(() => {
    setAutoRating(
      autoRating({
        enabled: autoRateEnabled,
        accuracy: autoRateAccuracy,
        thresholds: autoRateThresholds,
      }),
    );
  }, [autoRateEnabled, autoRateAccuracy, autoRateThresholds, setAutoRating]);

  // Wrap handleNext to include accuracy from full review mode.
  const handleNextWithAccuracy = useCallback(
    (ratingOverride?: ReviewRating) => {
      if (state.status !== 'reviewing') return;
      // Only a fully answered card contributes to the accuracy stats. The
      // same rule as before this became a summary. Both punctuation variants
      // are recorded together; `primary` is whichever one matches the learner's
      // setting, so the historical series keeps the meaning it always had.
      // Copy-through cards are excluded outright: the answer was on screen, so
      // the score measures typing, not recall.
      const summary = autoRateFirstExposure ? undefined : writingAccuracy;
      const accuracy: ReviewAccuracyPayload | undefined =
        summary?.allSubmitted &&
        summary.avgWithPunctuation != null &&
        summary.avgWithoutPunctuation != null
          ? {
              primary:
                (state.courseSettings.ignorePunctuation ?? false)
                  ? summary.avgWithoutPunctuation
                  : summary.avgWithPunctuation,
              strict: summary.avgWithPunctuation,
              lenient: summary.avgWithoutPunctuation,
            }
          : undefined;
      state.handleNext(ratingOverride, accuracy);
    },
    [state, writingAccuracy, autoRateFirstExposure],
  );
  const handleUndoWithNotify = useCallback(async () => {
    if (state.status !== 'reviewing') return;
    await state.handleUndo();
  }, [state]);
  const handleRevealAllAudioTargets = useCallback(() => {
    setAudioRevealNonce((n) => n + 1);
  }, []);
  // Stepwise back (Left Arrow): the writing card registers a revert handler
  // that unwinds one submitted translation per press and reports whether it
  // consumed the press; only when nothing is left to revert does the press
  // fall through to undoing the last review.
  const revertHandlerRef = useRef<(() => boolean) | null>(null);
  const registerRevertHandler = useCallback((fn: (() => boolean) | null) => {
    revertHandlerRef.current = fn;
  }, []);
  // Returns whether anything was actually taken back. The ← shortcut only
  // consumes the keypress when it acts (see LearningControls).
  const handleBack = useCallback((): boolean => {
    if (revertHandlerRef.current?.()) return true;
    if (state.status !== 'reviewing') return false;
    if (!state.canUndo || state.isReviewing || state.isUndoing) return false;
    void handleUndoWithNotify();
    return true;
  }, [state, handleUndoWithNotify]);
  const handleReplayTarget = useCallback(() => {
    setTargetReplayNonce((n) => n + 1);
  }, []);
  // "Turn off AI feedback" from the quota-reached line under an answer. Same
  // write as the settings-sheet toggle, offered where the limit actually
  // bites so the user isn't forced to either upgrade or dig through settings.
  const updateSettings = useUpdateCourseSettings();
  const handleDisableAiFeedback = useCallback(async () => {
    if (state.status !== 'reviewing') return;
    await updateSettings({
      courseId: state.courseSettings.courseId,
      aiWritingFeedback: false,
    });
  }, [state, updateSettings]);
  // Restart the current card from scratch: re-blur everything, drop typed and
  // submitted translations, clear the picked rating, and replay the merged
  // audio from 0 (deliberately unconditional, like the R shortcut, the user
  // just asked for a restart).
  const handleRestartCard = useCallback(() => {
    if (state.status !== 'reviewing') return;
    setFullReviewRevealed(false);
    setAllSubmitted(false);
    setWritingAccuracy(null);
    setCardResetNonce((n) => n + 1);
    state.setSelectedRating(null);
    audio.resetRevealed();
    audio.pause();
    audio.seekTo(0);
    if (audio.durationSec > 0) audio.play();
  }, [state, audio]);
  const handleEdit = useCallback(() => {
    audio.pause();
    setEditDialogOpen(true);
  }, [audio]);
  // Delete + flag confirms live on the shared card-action surface
  // (state.cardActions, from useCardActions): it holds the dialog state and
  // fires the confirmed action (delete routes back through the hook's
  // exit-animation flow, flag fires the card-level retranslation).
  const handleRequestDelete = useCallback(() => {
    if (state.status !== 'reviewing') return;
    audio.pause();
    state.cardActions.requestDelete(state.cardId);
  }, [audio, state]);
  // Declared up here (above the early returns) so its `useCallback` keeps a
  // stable position in the hook list across loading → reviewing transitions.
  // Gates on status internally. Non-reviewing states get a no-op.
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
  const instantProceed =
    reviewMode === 'full'
      ? (state.courseSettings.instantProceedFull ?? true)
      : (state.courseSettings.instantProceedAudio ?? false);
  const isTranscribe = isTranscribeMode(state.courseSettings);
  // Which copy of the playback settings this session reads. The SAME helper
  // useLearningAudio uses to build the merged blob, so the card's display
  // (word highlighting, speed badges, manual row taps) can never resolve a
  // different mode than the audio playing over it — which is exactly what
  // happened when this branch read the raw fields and Radio grew its own.
  const settingsMode: AudioSettingsMode = resolveSettingsMode(
    state.courseSettings,
  );
  // Transcribe: the post-submit replay rides the same per-language afterSubmit
  // machinery as Translate, gated by the transcribe auto-play setting
  // (chained `*Transcribe ?? *Full ?? audio` via resolveModeSetting).
  const writingAutoPlay =
    resolveModeSetting(state.courseSettings, 'autoPlayAudio', settingsMode) ??
    DEFAULT_AUTO_PLAY;

  // Flagging acts at the card level. The mutation retranslates every
  // non-source-language translation on the card. We hide the button when
  // there's no target translation to display since "flag" makes little
  // sense to the learner on a card they can't actually review.
  const hasTargetTranslation = state.translations.some(
    (tr) => tr.isTargetLanguage,
  );
  // Flag opens a confirmation dialog instead of firing immediately: the
  // action triggers a background retranslation that overwrites the
  // currently-displayed text, so we want an explicit confirm step. The
  // confirm state and the flag itself live on the shared card-action
  // surface; the card is not deleted.
  const handleFlagPrimary = hasTargetTranslation
    ? () => {
        audio.pause();
        state.cardActions.requestFlag(state.cardId);
      }
    : undefined;

  // Card-origin pill: premade cards show the collection shorthand ("A1.2")
  // tinted with its CEFR color; custom/chat cards get a short localized
  // bucket label. Gated by the off-by-default course setting.
  const originPill = buildCardOriginPill(
    state.courseSettings.showCardOrigin ?? false,
    state,
    t,
  );

  // "Show translation on new sentences" (both writing styles): the answer
  // is shown above the input to copy-type on the card's first N reviews. In
  // transcribe the sentence IS what the audio says, and that is the point:
  // the first passes are copy-work, the unassisted test starts afterwards.
  // freeStudyPlayCount is passed because free play advances neither
  // preReviewCount nor the FSRS reps, so without it the assist would never
  // retire in the Free Study face.
  const firstExposure = shouldShowTranslationAssist(
    state.courseSettings,
    state.preReviewCount,
    state.fsrsState?.reps ?? 0,
    state.freeStudyPlayCount,
  );

  // The shared card-presentation bundle, built once for both modes (the two
  // card components previously spelled these ~30 props identically twice).
  // A plain object rebuilt per render on purpose: the card components are
  // not memo-wrapped, and their internal memoization keys on these leaf
  // values, whose identities are unchanged. See cardPresentation.ts.
  const presentation: CardPresentation = {
    cardId: state.cardId,
    preReviewCount: state.preReviewCount,
    schedulingPhase: state.phase,
    fsrsState: state.fsrsState,
    originPill,
    sourceText: state.sourceText,
    translations: state.translations,
    audioRecordings: state.audioRecordings,
    isFavorite: state.isFavorite,
    isPendingMaster: state.isPendingMaster,
    isPendingHide: state.isPendingHide,
    flaggedInSession: state.flaggedInSession,
    showRomanization: state.courseSettings.showRomanization ?? true,
    showIpa: state.courseSettings.showIpa ?? false,
    showFurigana: resolveShowFurigana(state.courseSettings),
    onMaster: state.handleMaster,
    onHide: state.handleHide,
    onFavorite: state.handleFavorite,
    onEdit: handleEdit,
    onDelete: handleRequestDelete,
    onFlag: handleFlagPrimary,
    onRegenerateAudio: handleRegenerateAudioWithPause,
    pinnedActions: state.pinnedCardActions,
    onUpdatePinnedActions: state.handleUpdatePinnedActions,
    quotaState: state.cardActionQuotas,
    onAudioPlay: audio.stop,
    mergedPlayback,
    audioSpeedOverrides: state.audioSpeedOverrides,
    onSpeedCycle: handleSpeedCycle,
    audioRef: audio.audioRef,
    durationSec: audio.durationSec,
    isPlaying: audio.isPlaying,
    isMerging: audio.isMerging,
    onSeek: audio.seekTo,
    showProgressBar: state.courseSettings.showProgressBar ?? true,
    resetSignal: cardResetNonce,
    replayTargetSignal: targetReplayNonce,
  };

  const cardContent =
    reviewMode === 'full' ? (
      <FullReviewCardContent
        // Remount on a translate ↔ transcribe switch so typed text,
        // submissions, and manual base reveals reset to the card's initial
        // state (shadowing ↔ writing already resets via the conditional
        // render swapping the component out).
        key={isTranscribe ? 'transcribe' : 'translate'}
        presentation={presentation}
        firstExposure={firstExposure}
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
        hideBaseLanguages={
          state.courseSettings.hideBaseLanguagesFull ?? isTranscribe
        }
        autoRevealBaseOnSubmit={
          state.courseSettings.autoRevealBaseOnSubmit ?? true
        }
        ignorePunctuation={state.courseSettings.ignorePunctuation ?? false}
        aiFeedbackEnabled={state.courseSettings.aiWritingFeedback ?? true}
        onDisableAiFeedback={handleDisableAiFeedback}
        suppressAutoPlay={state.settingsOpen}
        allRevealed={fullReviewRevealed}
        onAllSubmittedChange={setAllSubmitted}
        onAccuracyChange={setWritingAccuracy}
        onRegisterRevert={registerRevertHandler}
        highlightEnabled={
          resolveModeSetting(
            state.courseSettings,
            'highlightWords',
            settingsMode,
          ) === true
        }
        languagePlaybackSpeeds={resolveModeSetting(
          state.courseSettings,
          'languagePlaybackSpeeds',
          settingsMode,
        )}
      />
    ) : (
      <LearningCardContent
        presentation={presentation}
        hideTargetLanguages={state.courseSettings.hideTargetLanguages ?? true}
        autoRevealLanguages={state.courseSettings.autoRevealLanguages ?? true}
        hideBaseLanguages={state.courseSettings.hideBaseLanguages === true}
        autoRevealBaseLanguages={
          state.courseSettings.autoRevealBaseLanguages ?? true
        }
        revealedLanguages={audio.revealedLanguages}
        revealAllSignal={audioRevealNonce}
        onAllTargetsRevealedChange={setAudioAllTargetsRevealed}
        highlightEnabled={
          resolveModeSetting(
            state.courseSettings,
            'highlightWords',
            settingsMode,
          ) === true
        }
        languagePlaybackSpeeds={resolveModeSetting(
          state.courseSettings,
          'languagePlaybackSpeeds',
          settingsMode,
        )}
      />
    );

  const isFreePlay = state.courseSettings.schedulingMode === 'radio';

  return (
    <div className="flex flex-col h-full">
      {/* The bar tracks `dailyReviewsToday` (audio + full, server-persisted,
          hydrated on mount) so the fill level always matches when the
          milestone celebration will fire, even after a reload or a break
          mid-day. Free play never shows the bar in either face, since plays
          don't count toward the milestone. */}
      {!isFreePlay && state.courseSettings.progressDisplayEnabled !== false && (
        <SessionProgressBar current={state.dailyReviewsToday} />
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
            aria-label={t('openChat')}
            data-tutorial={TUTORIAL_ANCHORS.chatButton}
            data-coachmark-anchor={COACHMARK_ANCHORS.chatButton}
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
        onBack={handleBack}
        onRestartCard={handleRestartCard}
        onReplayTarget={handleReplayTarget}
        isReviewing={state.isReviewing}
        instantProceed={instantProceed}
        isFullReview={reviewMode === 'full'}
        fullReviewRevealed={fullReviewRevealed || allSubmitted}
        onReveal={handleReveal}
        shortcutsDisabled={
          // Any overlay that owns the keyboard must silence the session
          // shortcuts, with a confirm dialog open, a stray ← would undo
          // the previous review behind the modal. Dialogs/menus that manage
          // their own open state (help, card menu) are caught structurally in
          // LearningControls' handler. The chat only counts as an overlay in
          // the narrow layout, where it covers the card; beside the card
          // (desktop) the shortcuts stay live, and keys pressed inside the
          // panel are filtered by its marker in the same handler. Silencing
          // them wholesale there left the writing card without Enter, Space
          // or R for as long as the chat stayed open.
          state.settingsOpen ||
          editDialogOpen ||
          state.cardActions.deleteConfirmOpen ||
          state.cardActions.flagConfirmOpen ||
          chatContext.chatCoversCard
        }
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

      <CardActionConfirmDialogs actions={state.cardActions} />
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
 * yet is free to add (custom cards don't consume the `SENTENCES` quota.
 * See decks.ts). The upgrade button is gated on this so a user with custom
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
  // Minute-quantized `now` bounds the due-card probes (no-wall-clock query
  // guideline, house pattern: getWorkloadForecast).
  const emptyReasonNow = useNowMinute();
  const emptyReason = useQuery(
    api.features.scheduling.getCardForReviewEmptyReason,
    { now: emptyReasonNow },
  );
  const updateSettings = useUpdateCourseSettings();

  const isDeckEmpty = emptyReason?.reason === 'no_cards';
  const activeFilter =
    emptyReason?.reason === 'filtered_out' ? emptyReason.activeFilter : null;
  const filterUnblockAvailable =
    emptyReason?.reason === 'filtered_out'
      ? emptyReason.availableInOtherSource
      : false;
  const currentSourceHasAnyCards =
    emptyReason?.reason === 'filtered_out'
      ? emptyReason.currentSourceHasAnyCards
      : true;
  // Only the filtered_out and all_caught_up variants carry this field; for
  // no_cards / no_session / undefined, default to false (no custom queue).
  const customCardsPendingAdd =
    emptyReason?.reason === 'filtered_out' ||
    emptyReason?.reason === 'all_caught_up'
      ? emptyReason.customCardsPendingAdd
      : false;
  // separateModeTracking enable-time seed still running. The writing queue
  // is empty only because cards aren't seeded yet.
  const isPreparingWriting = emptyReason?.reason === 'preparing_writing';

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
      isPreparingWriting={isPreparingWriting}
      onIncludeOtherSource={handleIncludeOtherSource}
      onCreateChatCards={onNavigateToChat}
      onCreateCustomCards={onNavigateToAddCustomCards}
    />
  );
}
