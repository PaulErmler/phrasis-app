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
import { useMilestoneTips } from '@/lib/tutorials/use-milestone-tips';
import { useDifficultyCheck } from '@/components/app/learning/useDifficultyCheck';
import { DifficultyCheckDialog } from '@/components/app/learning/DifficultyCheckDialog';
import type { Id } from '@/convex/_generated/dataModel';

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
}

export function LearnView(props: LearnViewProps) {
  return <LearnViewInner {...props} />;
}

function LearnViewInner({
  onBack,
  prefetchedThreadId,
  onNavigateToChat,
  onNavigateToAddCustomCards,
}: LearnViewProps) {
  // One-time difficulty check: holds the FIRST auto-add until the user has
  // confirmed (or changed) their level in the dialog below.
  const difficultyCheck = useDifficultyCheck();
  const state = useLearningMode({ holdAutoAdd: difficultyCheck.pending });
  const difficultyDialogOpen = difficultyCheck.pending && state.autoAddHeld;
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
  const transcribe =
    state.status !== 'loading' &&
    (state.courseSettings?.writingInputMode ?? 'translate') === 'transcribe';
  // Autoplay is gated while a tip popover is up, and the audio hook only
  // auto-plays on card change — so when the user dismisses a tip we have to
  // kick playback off explicitly. `audio` doesn't exist yet at this point in
  // the render, so the callbacks go through refs assigned below once
  // `useLearningAudio` has run.
  const playAfterTutorialRef = useRef<() => void>(() => {});
  const pauseAudioRef = useRef<() => void>(() => {});
  const { isActive, introPending, restartIntro } = useMilestoneTips({
    // Free play is its own flow — don't run the teaching layer when the
    // user explicitly chose it (its writing face also hides the rating
    // buttons the intro anchors on). Held back while the difficulty-check
    // dialog is up so a milestone popover can't stack on top of it.
    enabled:
      state.status === 'reviewing' &&
      !state.settingsOpen &&
      !isFreePlay &&
      !difficultyDialogOpen,
    reviewMode,
    transcribe,
    // The merged card audio lives in a detached `new Audio()` element the
    // tip hook's DOM sweep can't reach — pause it through the host.
    onWillShow: () => pauseAudioRef.current(),
    // Runs inside the dismissing click, so iOS gets its user gesture.
    onClosed: () => playAfterTutorialRef.current(),
  });
  // `progressDisplayActive` lives on BaseState so it persists across status
  // transitions (e.g. milestone hit on the last card → noCardsDue mid-cele).
  const progressDisplayActive = state.progressDisplayActive;

  const hasInflightCardAction =
    state.status === 'reviewing' && state.hasInflightCardAction;
  const { audio, openSettings, userAutoPlay } = useLearningAudio(state, {
    // Free play's listening face forces autoplay + auto-advance. Neither
    // face runs the tips or the celebration, so those gates don't apply
    // to free play at all — including the pending-completion state, which
    // would otherwise block autoplay forever there.
    // `hasInflightCardAction` keeps the user on the current card while a
    // flag retranslation or audio regenerate is mid-flight — auto-advancing
    // before the new content lands would skip past the very thing they
    // asked for.
    disableAutoAdvance:
      (!isHandsFree && reviewMode === 'audio' && isActive) ||
      hasInflightCardAction,
    // `introPending` keeps card audio silent until the current mode's intro
    // walkthrough has fully run (or been ruled out) — the spoken sentence
    // must not fight the popovers.
    disableAutoPlay:
      !isFreePlay && (isActive || introPending || progressDisplayActive),
  });

  // Assigned every render so the tip callbacks always see the current audio
  // object + settings. Mirrors the celebration → card handoff in
  // LearningMode: replay only when the user has autoplay enabled.
  playAfterTutorialRef.current = () => {
    if (state.status !== 'reviewing' || !userAutoPlay) return;
    audio.play();
  };
  pauseAudioRef.current = () => audio.pause();

  // Kick playback on the autoplay gate's falling edge for releases that
  // don't pass through a dismissal click — notably the veteran guard
  // silently retiring the intro (no popover, no gesture). After a normal
  // dismissal this runs right behind the synchronous kick — `audio.play()`
  // on an already-playing element is a no-op.
  const prevIntroPendingRef = useRef(introPending);
  useEffect(() => {
    const wasPending = prevIntroPendingRef.current;
    prevIntroPendingRef.current = introPending;
    if (wasPending && !introPending) {
      playAfterTutorialRef.current();
    }
  }, [introPending]);

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

  const header = (
    <LearningHeader
      onBack={goHome}
      onSettingsOpen={openSettings}
      onRestartTutorial={restartIntro}
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
        onNavigateToChat={onNavigateToChat}
        onNavigateToAddCustomCards={onNavigateToAddCustomCards}
      />
      {/* `pending` (and so `difficultyDialogOpen`) is only ever true with a
          resolved level, so the guard is a type narrow, not a second gate. */}
      {difficultyCheck.currentLevel !== null ? (
        <DifficultyCheckDialog
          open={difficultyDialogOpen}
          currentLevel={difficultyCheck.currentLevel}
          onDone={difficultyCheck.complete}
        />
      ) : null}
    </LearningChatLayout>
  );
}
