'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { LearningMode } from '@/components/app/LearningMode';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import {
  LearningChatLayout,
  useLearningChatToggle,
} from '@/components/app/learning/LearningChatLayout';
import {
  LearningHeader,
  useLearningMode,
  useLearningAudio,
} from '@/components/app/learning';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { useCardApprovals } from '@/hooks/use-card-approvals';
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock';
import { useThread } from '@/hooks/use-thread';
import { Loader } from '@/components/ai-elements/loader';
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';
import type { Id } from '@/convex/_generated/dataModel';
import { buildSessionSnapshot } from '@/components/app/learning/sessionSnapshot';

function WrappedChatPanel({
  threadId,
  cardId,
  onMessageSent,
}: {
  threadId: string;
  cardId?: Id<'cards'>;
  onMessageSent?: () => void;
}) {
  const chatContext = useLearningChatToggle();
  if (!chatContext) {
    throw new Error('WrappedChatPanel must be rendered inside LearningChatLayout');
  }
  const { closeChat, pendingPrompt, claimPrompt } = chatContext;
  const {
    approvalsByToolCallId,
    processingApprovals,
    handleApprove,
    handleReject,
    isLoaded: approvalsLoaded,
  } = useCardApprovals(threadId);
  const t = useTranslations('Chat');

  const suggestions = useMemo(
    () => [
      t('suggestions.grammar'),
      t('suggestions.simpler'),
      t('suggestions.moreCards'),
    ],
    [t],
  );

  const toolRenderers = useMemo(
    () => ({
      createCard: createCardToolRenderer({
        approvalsByToolCallId,
        processingApprovals,
        handleApprove,
        handleReject,
        isLoaded: approvalsLoaded,
      }),
    }),
    [approvalsByToolCallId, processingApprovals, handleApprove, handleReject, approvalsLoaded],
  );

  return (
    <ChatPanel
      threadId={threadId}
      toolRenderers={toolRenderers}
      cardId={cardId}
      onMessageSent={onMessageSent}
      suggestions={suggestions}
      showSuggestions
      autoFocus={false}
      approvalsLoading={!approvalsLoaded}
      noBottomPadding
      initialText={pendingPrompt?.text}
      initialTextNonce={pendingPrompt?.nonce}
      claimInitialText={claimPrompt}
      aboveFooterAction={
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={closeChat}
          className="h-9 w-9 shrink-0"
          aria-label={t('back')}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      }
    />
  );
}

interface LearnViewProps {
  onBack: () => void;
  prefetchedThreadId?: string;
  /** Navigate to the chat. Surfaces in the filter-blocked empty state. */
  onNavigateToChat: () => void;
  /** Navigate to the custom-card creation page. Same condition. */
  onNavigateToAddCustomCards: () => void;
  /**
   * Render mode. `'onboarding'`:
   *   - Suppresses the auto-firing `useTutorial(FULL_REVIEW_INTRO|AUDIO_REVIEW_INTRO)`
   *     so the onboarding wizard's coachmarks are the only teaching layer.
   *   - Renders a minimal header (no back/settings/help) — chrome is
   *     handled by the wizard around it.
   *   - Forwards to `LearningMode`'s `mode='onboarding'` (hides the
   *     settings sheet).
   * Defaults to `'normal'`.
   */
  mode?: 'normal' | 'onboarding';
  /** Optional minimal header content (e.g. just the ReviewModeSwitcher) for
   *  `mode='onboarding'`. Ignored in normal mode. */
  onboardingHeader?: React.ReactNode;
  /** Called when a user rates a card — wizard uses this to count cards
   *  toward the lesson-complete threshold AND to capture session counters
   *  for the celebration screen. */
  onCardRated?: (
    rating: import('@/lib/scheduling').ReviewRating | undefined,
    snapshot: {
      sessionId: string;
      dailyReviewsToday: number;
      dailyTimeMsToday: number;
      dailyNewWordsToday: number;
    },
  ) => void;
  /** Mirror of `onCardRated` for the undo direction — fires after an undo
   *  actually reverted a review, so the wizard can decrement its counter. */
  onCardUndone?: (snapshot: {
    sessionId: string;
    dailyReviewsToday: number;
    dailyTimeMsToday: number;
    dailyNewWordsToday: number;
  }) => void;
  /** External autoplay override (onboarding-mode only). When true, autoplay
   *  stays gated regardless of course settings — used by the wizard to keep
   *  card audio silent while the first-lesson coachmarks are running so the
   *  spoken sentence doesn't fight the popover. */
  forceDisableAutoPlay?: boolean;
  /** Onboarding-only: seed the underlying session so a mid-lesson reload
   *  resumes the same session — the X/N progress bar continues from where
   *  the user left off, and `getNewWordsForCelebration` keeps returning
   *  the same hero number on the stats-recap screen. */
  initialSessionId?: string;
  initialSessionCardCount?: number;
}

export function LearnView(props: LearnViewProps) {
  return <LearnViewInner {...props} />;
}

/**
 * Onboarding-only wrapper around `LearnView`. The wizard uses this so it
 * can't accidentally forget to set `mode='onboarding'` (which would re-enable
 * the auto-firing tutorial and the full header chrome). Normal-mode callers
 * should use `LearnView` directly.
 */
export type LearnViewOnboardingProps = Omit<
  LearnViewProps,
  'mode' | 'onNavigateToChat' | 'onNavigateToAddCustomCards'
> & {
  onboardingHeader: React.ReactNode;
};

export function LearnViewOnboarding(props: LearnViewOnboardingProps) {
  return (
    <LearnView
      {...props}
      mode="onboarding"
      onNavigateToChat={() => {
        /* chat navigation disabled inside the wizard */
      }}
      onNavigateToAddCustomCards={() => {
        /* custom-card flow disabled inside the wizard */
      }}
    />
  );
}

function LearnViewInner({
  onBack,
  prefetchedThreadId,
  onNavigateToChat,
  onNavigateToAddCustomCards,
  mode = 'normal',
  onboardingHeader,
  onCardRated,
  onCardUndone,
  forceDisableAutoPlay = false,
  initialSessionId,
  initialSessionCardCount,
}: LearnViewProps) {
  const state = useLearningMode({
    initialSessionId,
    initialSessionCardCount,
    // Onboarding adds 2 cards at a time (smaller batches keep the first
    // lesson feeling brisk and unblocked). In-memory override only — the
    // persisted `cardsToAddBatchSize` written by `completeOnboarding`
    // stays at `ONBOARDING_CARDS_BATCH_SIZE`, so regular learning after
    // onboarding resumes the normal batch.
    batchSizeOverride: mode === 'onboarding' ? 2 : undefined,
  });
  useScreenWakeLock(state.status === 'reviewing');
  const reviewMode = state.status !== 'loading' ? (state.courseSettings?.reviewMode ?? 'audio') : 'audio';
  const schedulingMode = state.status !== 'loading'
    ? (state.courseSettings?.schedulingMode ?? 'learnAndReview')
    : 'learnAndReview';
  const isRadio = schedulingMode === 'radio';
  const isOnboarding = mode === 'onboarding';
  const tutorialId = reviewMode === 'full' ? TUTORIAL_IDS.FULL_REVIEW_INTRO : TUTORIAL_IDS.AUDIO_REVIEW_INTRO;
  // Autoplay is gated while the tutorial popovers are up, and the audio hook
  // only auto-plays on card change — so when the user dismisses the tutorial
  // we have to kick playback off explicitly. `audio` doesn't exist yet at
  // this point in the render, so the callback goes through a ref assigned
  // below once `useLearningAudio` has run.
  const playAfterTutorialRef = useRef<() => void>(() => {});
  const { isActive, isCompleted, restartTutorial } = useTutorial(tutorialId, {
    delayMs: 1000,
    // Radio mode is its own flow — don't trigger the audio-review tutorial
    // when the user explicitly chose to listen.
    // Onboarding flow: suppressed — coachmarks are the only teaching layer.
    enabled:
      !isOnboarding &&
      state.status === 'reviewing' &&
      !state.settingsOpen &&
      !isRadio,
    onComplete: () => playAfterTutorialRef.current(),
  });
  // `progressDisplayActive` lives on BaseState so it persists across status
  // transitions (e.g. milestone hit on the last card → noCardsDue mid-cele).
  const progressDisplayActive = state.progressDisplayActive;
  // Audio-mode auto-advance bypasses `LearningMode.handleNextWithAccuracy`
  // (and therefore the wizard's `onCardRated` plumbing) by calling
  // `state.handleNext()` directly. Fire `onCardRated` from here so
  // auto-advanced cards still count toward the onboarding card threshold
  // and the staged coachmark unlocks.
  const fireOnCardRated = useCallback(() => {
    if (state.status !== 'reviewing' || !onCardRated) return;
    onCardRated(undefined, buildSessionSnapshot(state));
  }, [state, onCardRated]);

  const hasInflightCardAction =
    state.status === 'reviewing' && state.hasInflightCardAction;
  const { audio, openSettings, userAutoPlay } = useLearningAudio(state, {
    // Radio mode forces autoplay + auto-advance. The tutorial gates and the
    // celebration pause don't apply (no tutorial in radio, no celebration in
    // radio). In onboarding mode, the in-app `useTutorial` is suppressed so
    // `isCompleted` would stay false forever and block every card's autoplay
    // — gate the tutorial-completion check on `mode !== 'onboarding'`.
    // `hasInflightCardAction` keeps the user on the current card while a
    // flag retranslation or audio regenerate is mid-flight — auto-advancing
    // before the new content lands would skip past the very thing they
    // asked for.
    disableAutoAdvance:
      (!isRadio && reviewMode === 'audio' && isActive) || hasInflightCardAction,
    disableAutoPlay:
      !isRadio &&
      (isActive ||
        (!isOnboarding && !isCompleted) ||
        progressDisplayActive ||
        forceDisableAutoPlay),
    onAutoNext: fireOnCardRated,
  });

  // Assigned every render so the tutorial's onComplete always sees the
  // current audio object + settings. Mirrors the celebration → card handoff
  // in LearningMode: replay only when the user has autoplay enabled.
  playAfterTutorialRef.current = () => {
    if (state.status !== 'reviewing' || !userAutoPlay) return;
    audio.play();
  };

  // Onboarding popups gate audio via `forceDisableAutoPlay` instead of the
  // in-app tutorial's `isActive`. The merged card audio lives in a detached
  // `new Audio()` element, so the wizard can't reach it through the DOM —
  // kick playback off here on the gate's falling edge (i.e. when the user
  // dismisses the popover).
  const prevForceDisableAutoPlayRef = useRef(forceDisableAutoPlay);
  useEffect(() => {
    const wasDisabled = prevForceDisableAutoPlayRef.current;
    prevForceDisableAutoPlayRef.current = forceDisableAutoPlay;
    if (wasDisabled && !forceDisableAutoPlay) {
      playAfterTutorialRef.current();
    }
  }, [forceDisableAutoPlay]);

  const goHome = useCallback(() => {
    audio.pause();
    onBack();
  }, [audio, onBack]);

  const { threadId, isLoading: isThreadLoading, getOrCreateEmptyThread } = useThread({
    threadId: prefetchedThreadId,
    autoCreate: !prefetchedThreadId,
  });

  const threadHasMessagesRef = useRef(false);
  const prevCardIdRef = useRef<string | null>(null);
  const currentCardId = state.status === 'reviewing' ? state.cardId : null;

  useEffect(() => {
    if (!currentCardId) return;
    if (prevCardIdRef.current === null) {
      prevCardIdRef.current = currentCardId;
      return;
    }
    if (prevCardIdRef.current === currentCardId) return;

    prevCardIdRef.current = currentCardId;

    if (threadHasMessagesRef.current) {
      threadHasMessagesRef.current = false;
      getOrCreateEmptyThread().catch((err) =>
        console.error('Failed to create new thread on card change:', err),
      );
    }
  }, [currentCardId, getOrCreateEmptyThread]);

  const handleMessageSent = useCallback(() => {
    audio.pause();
    threadHasMessagesRef.current = true;
  }, [audio]);

  const handleChatOpen = useCallback(() => {
    audio.pause();
  }, [audio]);

  const cardId = state.status === 'reviewing' ? state.cardId : undefined;

  const chatPanel = threadId ? (
    <WrappedChatPanel
      threadId={threadId}
      cardId={cardId}
      onMessageSent={handleMessageSent}
    />
  ) : isThreadLoading ? (
    <div className="flex-1 flex items-center justify-center">
      <Loader size={24} />
    </div>
  ) : null;

  const header = isOnboarding ? (
    // Onboarding renders its own minimal header (typically just the mode
    // switcher) — no back/settings/help chrome. Wizard handles navigation.
    onboardingHeader ?? null
  ) : (
    <LearningHeader
      onBack={goHome}
      onSettingsOpen={openSettings}
      onRestartTutorial={restartTutorial}
      onHelpOpen={audio.pause}
      reviewMode={reviewMode}
      schedulingMode={schedulingMode}
    />
  );

  return (
    <LearningChatLayout
      header={header}
      chatPanel={chatPanel}
      onChatOpen={handleChatOpen}
      hideChatToggle={progressDisplayActive}
    >
      <LearningMode
        state={state}
        audio={audio}
        onGoHome={goHome}
        mode={mode}
        onCardRated={onCardRated}
        onCardUndone={onCardUndone}
        onNavigateToChat={onNavigateToChat}
        onNavigateToAddCustomCards={onNavigateToAddCustomCards}
      />
    </LearningChatLayout>
  );
}
