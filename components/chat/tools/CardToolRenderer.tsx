'use client';

import type { ReactNode } from 'react';
import type { ToolUIPart } from 'ai';
import { CardApproval } from '@/components/chat/CardApproval';
import { isCreateCardToolPart } from '@/lib/types/tool-parts';
import type { ApprovalData } from '@/hooks/use-card-approvals';
import type { Id } from '@/convex/_generated/dataModel';

interface CardToolRendererProps {
  approvalsByToolCallId: Map<string, ApprovalData>;
  processingApprovals: Set<string>;
  handleApprove: (approvalId: Id<'cardApprovals'>) => Promise<void>;
  handleReject: (approvalId: Id<'cardApprovals'>) => Promise<void>;
}

/**
 * Creates a tool renderer function for createCard tool parts.
 * Accepts approval state from `useCardApprovals` and returns
 * a renderer compatible with the ChatMessages `toolRenderers` prop.
 */
export function createCardToolRenderer({
  approvalsByToolCallId,
  processingApprovals,
  handleApprove,
  handleReject,
}: CardToolRendererProps): (
  toolPart: ToolUIPart,
  messageId: string,
  idx: number,
) => ReactNode | null {
  return (toolPart: ToolUIPart, messageId: string, idx: number) => {
    if (!isCreateCardToolPart(toolPart)) return null;

    return (
      <CardApproval
        key={`${messageId}-card-${idx}`}
        toolPart={toolPart}
        approvalsByToolCallId={approvalsByToolCallId}
        onApprove={handleApprove}
        onReject={handleReject}
        processingApprovals={processingApprovals}
      />
    );
  };
}
