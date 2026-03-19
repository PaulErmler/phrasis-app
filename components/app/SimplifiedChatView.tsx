'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ChatHistorySidebar } from '@/components/chat/ChatHistorySidebar';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { useCardApprovals } from '@/hooks/use-card-approvals';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useTranslations } from 'next-intl';
import type { Thread } from '@/lib/types/chat';

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
    isLoaded: approvalsLoaded,
  } = useCardApprovals(threadId);
  const t = useTranslations('Chat.sidebar');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const toolRenderers = useMemo(
    () => ({
      createCard: createCardToolRenderer({
        approvalsByToolCallId,
        processingApprovals,
        handleApprove,
        handleReject,
      }),
    }),
    [approvalsByToolCallId, processingApprovals, handleApprove, handleReject],
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
              <div className="w-[280px]">
                {sidebarContent}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Mobile sheet sidebar */}
      {!isDesktop && (
        <Sheet
          open={sidebarOpen}
          onOpenChange={onSidebarOpenChange}
        >
          <SheetContent side="left" className="w-[280px] p-0">
            <SheetTitle className="sr-only">{t('title')}</SheetTitle>
            {sidebarContent}
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
