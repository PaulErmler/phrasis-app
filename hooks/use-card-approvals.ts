import React, { useState, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import type { CardApprovalStatus } from '@/convex/types';

export type ApprovalData = {
  _id: Id<'cardApprovals'>;
  toolCallId: string;
  languages: string[];
  translations: string[];
  mainLanguage: string;
  status: CardApprovalStatus;
};

export interface UseCardApprovalsReturn {
  approvalsByToolCallId: Map<string, ApprovalData>;
  processingApprovals: Set<string>;
  handleApprove: (approvalId: Id<'cardApprovals'>) => Promise<void>;
  handleReject: (approvalId: Id<'cardApprovals'>) => Promise<void>;
}

/**
 * Manages card approval state and mutations for a given thread.
 */
export function useCardApprovals(
  threadId: string | null,
): UseCardApprovalsReturn {
  const approveCard = useMutation(
    api.features.chat.cardApprovals.approveCard,
  );
  const rejectCard = useMutation(
    api.features.chat.cardApprovals.rejectCard,
  );
  const [processingApprovals, setProcessingApprovals] = useState<Set<string>>(
    new Set(),
  );

  const threadApprovals = useQuery(
    api.features.chat.cardApprovals.getApprovalsByThread,
    threadId ? { threadId } : 'skip',
  );

  const approvalsByToolCallId = React.useMemo(() => {
    const byToolCallId = new Map<string, ApprovalData>();
    if (!threadApprovals) return byToolCallId;
    for (const approval of threadApprovals) {
      byToolCallId.set(approval.toolCallId, approval);
      const trimmed = approval.toolCallId.trim();
      if (trimmed && trimmed !== approval.toolCallId) {
        byToolCallId.set(trimmed, approval);
      }
    }
    return byToolCallId;
  }, [threadApprovals]);

  const handleApprove = useCallback(
    async (approvalId: Id<'cardApprovals'>) => {
      setProcessingApprovals((prev) => new Set(prev).add(approvalId));
      try {
        await approveCard({ approvalId });
      } catch (error) {
        console.error('Failed to approve card:', error);
      } finally {
        setProcessingApprovals((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [approveCard],
  );

  const handleReject = useCallback(
    async (approvalId: Id<'cardApprovals'>) => {
      setProcessingApprovals((prev) => new Set(prev).add(approvalId));
      try {
        await rejectCard({ approvalId });
      } catch (error) {
        console.error('Failed to reject card:', error);
      } finally {
        setProcessingApprovals((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [rejectCard],
  );

  return {
    approvalsByToolCallId,
    processingApprovals,
    handleApprove,
    handleReject,
  };
}
