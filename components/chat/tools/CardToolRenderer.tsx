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
  isLoaded: boolean;
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
  isLoaded,
}: CardToolRendererProps): (
  toolPart: ToolUIPart,
  messageId: string,
  idx: number,
) => ReactNode | null {
  function CardToolRenderer(toolPart: ToolUIPart, messageId: string, idx: number) {
    if (!isCreateCardToolPart(toolPart)) return null;

    if (!isLoaded) return <span key={`${messageId}-card-${idx}`} />;

    const stableKey = toolPart.toolCallId
      ? `card-${toolPart.toolCallId}`
      : `${messageId}-card-${idx}`;
    return (
      <CardApproval
        key={stableKey}
        toolPart={toolPart}
        approvalsByToolCallId={approvalsByToolCallId}
        onApprove={handleApprove}
        onReject={handleReject}
        processingApprovals={processingApprovals}
      />
    );
  }
  return CardToolRenderer;
}
