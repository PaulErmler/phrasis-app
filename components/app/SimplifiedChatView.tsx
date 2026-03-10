'use client';

import { useMemo } from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { useCardApprovals } from '@/hooks/use-card-approvals';

interface SimplifiedChatViewProps {
  threadId: string;
}

/**
 * Simplified chat view that displays and manages an existing conversation.
 * No thread creation or initialization logic — that's handled by the caller.
 */
export function SimplifiedChatView({ threadId }: SimplifiedChatViewProps) {
  const approvals = useCardApprovals(threadId);

  const toolRenderers = useMemo(
    () => ({
      createCard: createCardToolRenderer(approvals),
    }),
    [approvals],
  );

  return (
    <ChatPanel
      threadId={threadId}
      toolRenderers={toolRenderers}
    />
  );
}
