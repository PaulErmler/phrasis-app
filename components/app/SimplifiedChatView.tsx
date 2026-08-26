'use client';

import { useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ChatHistorySidebar } from '@/components/chat/ChatHistorySidebar';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { createAlsoCorrectToolRenderer } from '@/components/chat/tools/AlsoCorrectToolRenderer';
import { useCardApprovals } from '@/hooks/use-card-approvals';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useTranslations } from 'next-intl';
import type { Thread } from '@/lib/types/chat';
import type { Id } from '@/convex/_generated/dataModel';

interface SimplifiedChatViewProps {
  threadId: string;
  onNewChat?: () => void;
  onThreadSelect?: (id: string) => void;
  threads?: Thread[];
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
}

export function SimplifiedChatView({
  threadId,
  onNewChat,
  onThreadSelect,
  threads,
  sidebarOpen = false,
  onSidebarOpenChange,
}: SimplifiedChatViewProps) {
  const {
    approvalsByToolCallId,
    processingApprovals,
    handleApprove,
    handleReject,
    handleReplace,
    isLoaded: approvalsLoaded,
  } = useCardApprovals(threadId);
  const t = useTranslations('Chat.sidebar');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // The chat tab has no served card, so it has no thread rotation to suppress
  // It only needs the result, not the replacement card id that LearnView
  // keys its suppression off.
  const replaceOnly = useCallback(
    async (id: Id<'cardApprovals'>) => (await handleReplace(id)).result,
    [handleReplace],
  );

  // Both card tools: learn-view threads (where markAlsoCorrect fires) are
  // reachable from this tab's history sidebar, so their approval boxes must
  // render, and stay actionable. Here too.
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
        handleReplace: replaceOnly,
        handleReject,
        isLoaded: approvalsLoaded,
      }),
    }),
    [
      approvalsByToolCallId,
      processingApprovals,
      handleApprove,
      handleReject,
      replaceOnly,
      approvalsLoaded,
    ],
  );

  const handleThreadSelect = (id: string) => {
    onThreadSelect?.(id);
    if (!isDesktop) onSidebarOpenChange?.(false);
  };

  const handleNewChat = () => {
    onNewChat?.();
    if (!isDesktop) onSidebarOpenChange?.(false);
  };

  const sidebarContent = (
    <ChatHistorySidebar
      threads={threads}
      currentThreadId={threadId}
      onThreadSelect={handleThreadSelect}
      onNewChat={handleNewChat}
    />
  );

  const sidebarContentForSheet = (
    <ChatHistorySidebar
      threads={threads}
      currentThreadId={threadId}
      onThreadSelect={handleThreadSelect}
      onNewChat={handleNewChat}
      insetForSheetClose
    />
  );

  return (
    <div className="flex h-full w-full min-w-0">
      {/* Desktop inline sidebar */}
      {isDesktop && (
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="flex flex-shrink-0 border-r overflow-hidden"
            >
              <div className="w-[280px] min-w-0 max-w-[280px] overflow-x-hidden">
                {sidebarContent}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Mobile sheet sidebar */}
      {!isDesktop && (
        <Sheet open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
          <SheetContent
            side="left"
            className="w-[280px] min-w-0 max-w-[280px] overflow-x-hidden p-0"
          >
            <SheetTitle className="sr-only">{t('title')}</SheetTitle>
            {sidebarContentForSheet}
          </SheetContent>
        </Sheet>
      )}

      {/* Chat panel */}
      <div className="flex-1 min-w-0">
        <ChatPanel
          threadId={threadId}
          toolRenderers={toolRenderers}
          onNewChat={onNewChat}
          className="max-w-xl mx-auto"
          approvalsLoading={!approvalsLoaded}
        />
      </div>
    </div>
  );
}
