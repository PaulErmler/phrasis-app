'use client';

import type { ReactNode } from 'react';
import type { ToolUIPart } from 'ai';
import { FlashcardConfirmation } from '@/components/chat/FlashcardConfirmation';
import { isCreateFlashcardToolPart } from '@/lib/types/tool-parts';
import type { ApprovalData } from '@/hooks/use-flashcard-approvals';
import type { Id } from '@/convex/_generated/dataModel';

interface FlashcardToolRendererProps {
  approvalsByToolCallId: Map<string, ApprovalData>;
  processingApprovals: Set<string>;
  handleApprove: (approvalId: Id<'flashcardApprovals'>) => Promise<void>;
  handleReject: (approvalId: Id<'flashcardApprovals'>) => Promise<void>;
}

/**
 * Creates a tool renderer function for flashcard tool parts.
 * Accepts approval state from `useFlashcardApprovals` and returns
 * a renderer compatible with the ChatMessages `toolRenderers` prop.
 */
export function createFlashcardToolRenderer({
  approvalsByToolCallId,
  processingApprovals,
  handleApprove,
  handleReject,
}: FlashcardToolRendererProps): (
  toolPart: ToolUIPart,
  messageId: string,
  idx: number,
) => ReactNode | null {
  return (toolPart: ToolUIPart, messageId: string, idx: number) => {
    if (!isCreateFlashcardToolPart(toolPart)) return null;

    return (
      <FlashcardConfirmation
        key={`${messageId}-flashcard-${idx}`}
        toolPart={toolPart}
        approvalsByToolCallId={approvalsByToolCallId}
        onApprove={handleApprove}
        onReject={handleReject}
        processingApprovals={processingApprovals}
      />
    );
  };
}
