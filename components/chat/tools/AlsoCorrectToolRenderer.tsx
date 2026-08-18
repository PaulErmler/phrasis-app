'use client';

import type { ReactNode } from 'react';
import type { ToolUIPart } from 'ai';
import { AlsoCorrectApproval } from '@/components/chat/AlsoCorrectApproval';
import { isMarkAlsoCorrectToolPart } from '@/lib/types/tool-parts';
import type {
  ApprovalActionResult,
  ApprovalData,
} from '@/hooks/use-card-approvals';
import type { Id } from '@/convex/_generated/dataModel';

interface AlsoCorrectToolRendererProps {
  approvalsByToolCallId: Map<string, ApprovalData>;
  processingApprovals: Set<string>;
  handleApprove: (
    approvalId: Id<'cardApprovals'>,
  ) => Promise<ApprovalActionResult>;
  handleReplace: (
    approvalId: Id<'cardApprovals'>,
  ) => Promise<ApprovalActionResult>;
  handleReject: (
    approvalId: Id<'cardApprovals'>,
  ) => Promise<ApprovalActionResult>;
  isLoaded: boolean;
}

/**
 * Creates a tool renderer function for markAlsoCorrect tool parts.
 * Mirrors createCardToolRenderer — approval state comes from
 * `useCardApprovals`; the add path reuses the approveCard mutation, the
 * replace path uses replaceCardFromApproval.
 */
export function createAlsoCorrectToolRenderer({
  approvalsByToolCallId,
  processingApprovals,
  handleApprove,
  handleReplace,
  handleReject,
  isLoaded,
}: AlsoCorrectToolRendererProps): (
  toolPart: ToolUIPart,
  messageId: string,
  idx: number,
) => ReactNode | null {
  function AlsoCorrectToolRenderer(
    toolPart: ToolUIPart,
    messageId: string,
    idx: number,
  ) {
    if (!isMarkAlsoCorrectToolPart(toolPart)) return null;

    if (!isLoaded) return <span key={`${messageId}-alsocorrect-${idx}`} />;

    const stableKey = toolPart.toolCallId
      ? `alsocorrect-${toolPart.toolCallId}`
      : `${messageId}-alsocorrect-${idx}`;
    return (
      <AlsoCorrectApproval
        key={stableKey}
        toolPart={toolPart}
        approvalsByToolCallId={approvalsByToolCallId}
        onAddAsNewCard={handleApprove}
        onReplace={handleReplace}
        onReject={handleReject}
        processingApprovals={processingApprovals}
      />
    );
  }
  return AlsoCorrectToolRenderer;
}
