'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LearningMode } from '@/components/app/LearningMode';
import { Button } from '@/components/ui/button';
import { ChevronLeft, MessageSquarePlus } from 'lucide-react';
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
import type { MessageFooterRenderer } from '@/components/chat/ChatMessages';
import {
  QuickActionsGrid,
  QuickActionsRow,
  quickActionMessage,
} from '@/components/chat/QuickActionsRow';
import { useCourseLanguages } from '@/hooks/use-course-languages';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import type { SentenceQuickActionKind } from '@/convex/features/chat/quickActions';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { createAlsoCorrectToolRenderer } from '@/components/chat/tools/AlsoCorrectToolRenderer';
import {
  useCardApprovals,
  type ApprovalActionResult,
} from '@/hooks/use-card-approvals';
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock';
import { useReloadBlock } from '@/components/app/AppUpdateGate';
import { useThread } from '@/hooks/use-thread';
import { useCardThreadRotation } from '@/hooks/use-card-thread-rotation';
import { Loader } from '@/components/ai-elements/loader';
import { useTutorial } from '@/lib/tutorials/use-tutorial';
import { TUTORIAL_IDS } from '@/lib/tutorials/registry';
import type { Id } from '@/convex/_generated/dataModel';
import {
  buildSessionSnapshot,
  type SessionSnapshot,
} from '@/components/app/learning/sessionSnapshot';

function WrappedChatPanel({
  threadId,
  cardId,
  onMessageSent,
  onNewChat,
  onCardReplaced,
}: {
  threadId: string;
  cardId?: Id<'cards'>;
  onMessageSent?: () => void;
  onNewChat?: () => void;
  /**
   * Called after a successful "replace" with the id of the card the edit left
   * behind (Path B deletes and re-inserts the card doc, so `getCardForReview`
   * starts returning a new `_id`). Tells LearnView's card-change effect that
   * this ONE upcoming change is the replace, not a real advance, so accepting
   * doesn't wipe the conversation it came from.
   */
  onCardReplaced?: (cardId: Id<'cards'>) => void;
}) {
  const chatContext = useLearningChatToggle();
  if (!chatContext) {
    throw new Error('WrappedChatPanel must be rendered inside LearningChatLayout');
  }
  const { closeChat, pendingPrompt, claimPrompt, openChatWithAction } = chatContext;
  const {
    approvalsByToolCallId,
    processingApprovals,
    handleApprove,
    handleReject,
    handleReplace,
    isLoaded: approvalsLoaded,
  } = useCardApprovals(threadId);
  const t = useTranslations('Chat');
  const tQuick = useTranslations('Chat.quickActions');
  const locale = useLocale();
  const { targetLanguages } = useCourseLanguages();

  // Naming the target language in the prompt ("…this Romanian sentence…")
  // removes the ambiguity that made the tutor analyze the base-language
  // rendering of the card. Only for single-target courses — with several
  // targets there is no single name to insert, and the server-side steering
  // still lists every target sentence explicitly.
  const targetLanguageLabel = useMemo(
    () =>
      targetLanguages.length === 1
        ? getLocalizedLanguageNameByCode(targetLanguages[0], locale)
        : undefined,
    [targetLanguages, locale],
  );

  const handleQuickAction = useCallback(
    (kind: SentenceQuickActionKind) => {
      openChatWithAction(
        { kind },
        quickActionMessage(tQuick, kind, targetLanguageLabel),
      );
    },
    [openChatWithAction, tQuick, targetLanguageLabel],
  );

  // Identity-stable (ChatMessageRow's memo comparator checks messageFooter
  // by reference). Rendered only under the latest, fully-generated assistant
  // message, and only in learning mode (cardId present).
  const messageFooter = useCallback<MessageFooterRenderer>(
    (message, { isLastMessage }) =>
      isLastMessage && message.status === 'success' && cardId ? (
        <QuickActionsRow
          onAction={handleQuickAction}
          languageLabel={targetLanguageLabel}
        />
      ) : null,
    [cardId, handleQuickAction, targetLanguageLabel],
  );

  // Replace is the only approval action that rewrites the card document, so
  // it is the only one that needs the rotation suppression — and it reports
  // exactly which card it produced, so the suppression can be keyed to that id
  // rather than to a time window. `handleApprove` is passed through untouched:
  // approving only appends a text to the chat collection, never changing the
  // served card.
  const replaceKeepingThread = useCallback(
    async (id: Id<'cardApprovals'>): Promise<ApprovalActionResult> => {
      const { result, cardId: replacementId } = await handleReplace(id);
      if (result === 'success' && replacementId) {
        onCardReplaced?.(replacementId);
      }
      return result;
    },
    [handleReplace, onCardReplaced],
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
      markAlsoCorrect: createAlsoCorrectToolRenderer({
        approvalsByToolCallId,
        processingApprovals,
        handleApprove,
        handleReplace: replaceKeepingThread,
        handleReject,
        isLoaded: approvalsLoaded,
      }),
    }),
    [approvalsByToolCallId, processingApprovals, handleApprove, handleReject, replaceKeepingThread, approvalsLoaded],
  );

  return (
    <ChatPanel
      threadId={threadId}
      toolRenderers={toolRenderers}
      messageFooter={messageFooter}
      cardId={cardId}
      onMessageSent={onMessageSent}
      onNewChat={onNewChat}
      emptyStateExtra={
        cardId ? (
          <QuickActionsGrid
            onAction={handleQuickAction}
            languageLabel={targetLanguageLabel}
          />
        ) : undefined
      }
      header={
        onNewChat ? (
          <div className="flex items-center justify-end gap-2 border-b px-4 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              onClick={onNewChat}
              data-testid="learn-chat-new"
            >
              <MessageSquarePlus className="h-4 w-4" />
              {t('sidebar.newChat')}
            </Button>
          </div>
        ) : undefined
      }
      autoFocus={false}
      approvalsLoading={!approvalsLoaded}
      noBottomPadding
      initialText={pendingPrompt?.text}
      initialQuickAction={pendingPrompt?.quickAction}
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
    snapshot: SessionSnapshot,
  ) => void;
  /** Mirror of `onCardRated` for the undo direction — fires after an undo
   *  actually reverted a review, so the wizard can decrement its counter. */
  onCardUndone?: (snapshot: SessionSnapshot) => void;
  /** External autoplay override (onboarding-mode only). When true, autoplay
   *  stays gated regardless of course settings — used by the wizard to keep
   *  card audio silent while the first-lesson coachmarks are running so the
   *  spoken sentence doesn't fight the popover. */
  forceDisableAutoPlay?: boolean;
  /** Onboarding-only: hands the wizard an imperative "kick playback" so it
   *  can start the card audio synchronously inside the popover-dismiss
   *  click. The merged audio lives in a detached `new Audio()` element that
   *  has never played, so iOS Safari rejects any `.play()` issued outside a
   *  user gesture — a state-driven effect (see the falling-edge fallback
   *  below) arrives too late to keep the gesture. */
  registerResumeAudio?: (fn: () => void) => void;
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
  registerResumeAudio,
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
  // Hold off the silent update reload for the whole session, not just while
  // reviewing: the merged audio plays through a detached `new Audio()` that
  // keeps going when the tab is hidden ("listen all day"), so a hidden-long-
  // enough tab is emphatically not idle here.
  useReloadBlock(true);
  const reviewMode = state.status !== 'loading' ? (state.courseSettings?.reviewMode ?? 'audio') : 'audio';
  const schedulingMode = state.status !== 'loading'
    ? (state.courseSettings?.schedulingMode ?? 'learnAndReview')
    : 'learnAndReview';
  // Free play is one mode; `reviewMode` picks the face. Only the listening
  // face (Radio) runs hands-free — the writing face (Free Study) is a
  // user-paced typing session.
  const isFreePlay = schedulingMode === 'radio';
  const isHandsFree = isFreePlay && reviewMode === 'audio';
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
    // Free play is its own flow — don't trigger the review tutorials when
    // the user explicitly chose it (its writing face also hides the rating
    // buttons the full-review tour anchors on).
    // Onboarding flow: suppressed — coachmarks are the only teaching layer.
    enabled:
      !isOnboarding &&
      state.status === 'reviewing' &&
      !state.settingsOpen &&
      !isFreePlay,
    onComplete: () => playAfterTutorialRef.current(),
    // Both review tours END on the chat button purely to explain it — a
    // curiosity click there must not mark the tour completed.
    lastStepCompleteOnClick: false,
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
    // Free play's listening face forces autoplay + auto-advance. Neither
    // face runs the tutorial or the celebration, so those gates don't apply
    // to free play at all — including the pending-completion state, which
    // would otherwise block autoplay forever there. In onboarding mode the
    // in-app `useTutorial` is suppressed so `isCompleted` would likewise stay
    // false — hence the `mode !== 'onboarding'` check.
    // `hasInflightCardAction` keeps the user on the current card while a
    // flag retranslation or audio regenerate is mid-flight — auto-advancing
    // before the new content lands would skip past the very thing they
    // asked for.
    disableAutoAdvance:
      (!isHandsFree && reviewMode === 'audio' && isActive) ||
      hasInflightCardAction,
    disableAutoPlay:
      !isFreePlay &&
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
  // hand it the kick instead, which it invokes synchronously inside the
  // popover-dismiss click so iOS gets its user gesture.
  useEffect(() => {
    registerResumeAudio?.(() => playAfterTutorialRef.current());
  }, [registerResumeAudio]);

  // Fallback for gate releases that don't pass through a dismissal click
  // (and for pre-gesture-fix callers): kick playback on the gate's falling
  // edge. After a normal dismissal this runs right behind the synchronous
  // kick — `audio.play()` on an already-playing element is a no-op.
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

  const currentCardId = state.status === 'reviewing' ? state.cardId : null;

  // Thread rotation on card change, and its one exception: the card change a
  // chat "replace" itself caused (see the hook for the full rationale).
  const { markThreadHasMessages, resetThreadMessages, handleCardReplaced } =
    useCardThreadRotation(currentCardId, getOrCreateEmptyThread);

  const handleMessageSent = useCallback(() => {
    audio.pause();
    markThreadHasMessages();
  }, [audio, markThreadHasMessages]);

  // getOrCreateEmptyThread returns the current thread when it is still
  // empty, so mashing the button can't spam empty threads.
  const handleNewChat = useCallback(() => {
    resetThreadMessages();
    getOrCreateEmptyThread().catch((err) =>
      console.error('Failed to start a new chat:', err),
    );
  }, [getOrCreateEmptyThread, resetThreadMessages]);

  const handleChatOpen = useCallback(() => {
    audio.pause();
  }, [audio]);

  const cardId = state.status === 'reviewing' ? state.cardId : undefined;

  const chatPanel = threadId ? (
    <WrappedChatPanel
      threadId={threadId}
      cardId={cardId}
      onMessageSent={handleMessageSent}
      onNewChat={handleNewChat}
      onCardReplaced={handleCardReplaced}
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
      ratingCount={
        state.status === 'reviewing' ? state.validRatings.length : undefined
      }
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
