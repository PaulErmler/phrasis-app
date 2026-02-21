import React, { useState, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export type ApprovalData = {
  _id: Id<'flashcardApprovals'>;
  toolCallId: string;
  text: string;
  note: string;
  status: string;
};

interface UseFlashcardApprovalsReturn {
  approvalsByToolCallId: Map<string, ApprovalData>;
  processingApprovals: Set<string>;
  handleApprove: (approvalId: Id<'flashcardApprovals'>) => Promise<void>;
  handleReject: (approvalId: Id<'flashcardApprovals'>) => Promise<void>;
}

/**
 * Manages flashcard approval state and mutations for a given thread.
 * Extracted from ChatMessages to enable pluggable tool rendering.
 */
export function useFlashcardApprovals(
  threadId: string | null,
): UseFlashcardApprovalsReturn {
  const approveFlashcard = useMutation(
    api.features.chat.flashcardApprovals.approveFlashcard,
  );
  const rejectFlashcard = useMutation(
    api.features.chat.flashcardApprovals.rejectFlashcard,
  );
  const [processingApprovals, setProcessingApprovals] = useState<Set<string>>(
    new Set(),
  );

  const threadApprovals = useQuery(
    api.features.chat.flashcardApprovals.getApprovalsByThread,
    threadId ? { threadId } : 'skip',
  );

  const approvalsByToolCallId = React.useMemo(() => {
    const byToolCallId = new Map<string, ApprovalData>();
    if (!threadApprovals) return byToolCallId;
    for (const approval of threadApprovals) {
      byToolCallId.set(approval.toolCallId, approval);
    }
    return byToolCallId;
  }, [threadApprovals]);

  const handleApprove = useCallback(
    async (approvalId: Id<'flashcardApprovals'>) => {
      setProcessingApprovals((prev) => new Set(prev).add(approvalId));
      try {
        await approveFlashcard({ approvalId });
      } catch (error) {
        console.error('Failed to approve flashcard:', error);
      } finally {
        setProcessingApprovals((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [approveFlashcard],
  );

  const handleReject = useCallback(
    async (approvalId: Id<'flashcardApprovals'>) => {
      setProcessingApprovals((prev) => new Set(prev).add(approvalId));
      try {
        await rejectFlashcard({ approvalId });
      } catch (error) {
        console.error('Failed to reject flashcard:', error);
      } finally {
        setProcessingApprovals((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [rejectFlashcard],
  );

  return {
    approvalsByToolCallId,
    processingApprovals,
    handleApprove,
    handleReject,
  };
}
