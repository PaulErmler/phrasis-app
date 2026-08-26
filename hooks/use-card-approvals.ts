import React, { useState, useCallback } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { convexErrorCode, isPaymentPastDueError } from '@/lib/utils';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import type {
  CardApprovalKind,
  CardApprovalResolution,
  CardApprovalStatus,
  ProposedCardMetadata,
} from '@/convex/types';
import { getUserTimezone } from '@/lib/timezone';

import { reportError } from '@/lib/report-error';

export type ApprovalData = {
  _id: Id<'cardApprovals'>;
  toolCallId: string;
  translations: { language: string; text: string }[];
  /** IPA per language (espeak), shown under the proposed sentences when the
   * course's showIpa setting is on. '' = engine failed for that entry. */
  entryIpa?: Record<string, string>;
  entryFurigana?: Record<string, string>;
  status: CardApprovalStatus;
  // Absent = 'createCard' (rows predate the field).
  kind?: CardApprovalKind;
  cardId?: Id<'cards'>;
  resolution?: CardApprovalResolution;
  changedLanguages?: string[];
  proposedMetadata?: ProposedCardMetadata;
  /** Card was missing a course language when proposed. Replace is allowed,
   * add-as-new-card is not (it would produce a card with a blank line). */
  replaceOnly?: boolean;
};

/**
 * How an approval action ended, for the caller's optimistic UI:
 *   'success': the mutation committed; keep the optimistic state.
 *   'usage_limit': quota exhausted (USAGE_LIMIT); roll back and paywall.
 *   'card_replaced': the card this proposal targets no longer exists (it was
 *                     replaced from another thread or device); roll back and
 *                     say so, rather than leaving an inert button.
 *   'error': anything else, incl. payment-past-due (whose canonical
 *                     surface is the reactive overdue dialog); roll back.
 */
export type ApprovalActionResult =
  | 'success'
  | 'usage_limit'
  | 'card_replaced'
  | 'error';

/**
 * Replace also reports WHICH card the edit left behind: Path B deletes and
 * re-inserts the card document, so the served card's `_id` changes. The learn
 * view needs that exact id to suppress its thread rotation for precisely that
 * card change and nothing else. Absent unless `result === 'success'`.
 */
export interface ApprovalReplaceOutcome {
  result: ApprovalActionResult;
  cardId?: Id<'cards'>;
}

export interface UseCardApprovalsReturn {
  approvalsByToolCallId: Map<string, ApprovalData>;
  processingApprovals: Set<string>;
  handleApprove: (
    approvalId: Id<'cardApprovals'>,
  ) => Promise<ApprovalActionResult>;
  handleReject: (
    approvalId: Id<'cardApprovals'>,
  ) => Promise<ApprovalActionResult>;
  /** Accept an also-correct proposal by replacing the discussed card's text. */
  handleReplace: (
    approvalId: Id<'cardApprovals'>,
  ) => Promise<ApprovalReplaceOutcome>;
  usageLimitHit: boolean;
  isLoaded: boolean;
}

/**
 * Manages card approval state and mutations for a given thread.
 */
export function useCardApprovals(
  threadId: string | null,
): UseCardApprovalsReturn {
  const approveCard = useMutation(api.features.chat.cardApprovals.approveCard);
  const rejectCard = useMutation(api.features.chat.cardApprovals.rejectCard);
  // "Accept" on an alsoCorrect proposal stores the wording as an accepted
  // alternative (and forks the card user-owned) rather than replacing the
  // card's text; replaceCardFromApproval remains server-side for old clients.
  const storeAlternativeFromApproval = useMutation(
    api.features.chat.cardApprovals.storeAlternativeFromApproval,
  );
  const [processingApprovals, setProcessingApprovals] = useState<Set<string>>(
    new Set(),
  );
  const [usageLimitHit, setUsageLimitHit] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(threadId);

  React.useEffect(() => {
    if (threadId !== activeThreadId) {
      setActiveThreadId(threadId);
    }
  }, [threadId, activeThreadId]);

  const isTransitioning = threadId !== activeThreadId;

  const threadApprovals = useQuery(
    api.features.chat.cardApprovals.getApprovalsByThread,
    threadId ? { threadId } : 'skip',
  );

  const approvalsByToolCallId = React.useMemo(() => {
    const byToolCallId = new Map<string, ApprovalData>();
    if (isTransitioning || !threadApprovals) return byToolCallId;
    for (const approval of threadApprovals) {
      byToolCallId.set(approval.toolCallId, approval);
      const trimmed = approval.toolCallId.trim();
      if (trimmed && trimmed !== approval.toolCallId) {
        byToolCallId.set(trimmed, approval);
      }
    }
    return byToolCallId;
  }, [threadApprovals, isTransitioning]);

  // One processing-set + error-taxonomy wrapper for every approval action.
  // The taxonomy was previously copy-pasted per handler and had already
  // drifted (reject silently lacked it). The result value is the caller's
  // contract for rolling back optimistic UI (see ApprovalActionResult).
  const runApprovalAction = useCallback(
    async <T>(
      approvalId: Id<'cardApprovals'>,
      label: string,
      fn: () => Promise<T>,
    ): Promise<{ result: ApprovalActionResult; value?: T }> => {
      setProcessingApprovals((prev) => new Set(prev).add(approvalId));
      try {
        const value = await fn();
        setUsageLimitHit(false);
        return { result: 'success', value };
      } catch (error) {
        // Silent: the reactive payment-overdue dialog is the canonical
        // surface for this state (see isPaymentPastDueError).
        if (isPaymentPastDueError(error)) {
          return { result: 'error' };
        }
        if (convexErrorCode(error) === 'USAGE_LIMIT') {
          setUsageLimitHit(true);
          return { result: 'usage_limit' };
        }
        if (convexErrorCode(error) === 'CARD_REPLACED') {
          return { result: 'card_replaced' };
        }
        reportError(error, { op: 'cardApproval', action: label });
        return { result: 'error' };
      } finally {
        setProcessingApprovals((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [],
  );

  const handleApprove = useCallback(
    async (approvalId: Id<'cardApprovals'>) =>
      (
        await runApprovalAction(approvalId, 'approve card', () =>
          approveCard({ approvalId }),
        )
      ).result,
    [runApprovalAction, approveCard],
  );

  const handleReject = useCallback(
    async (approvalId: Id<'cardApprovals'>) =>
      (
        await runApprovalAction(approvalId, 'reject card', () =>
          rejectCard({ approvalId }),
        )
      ).result,
    [runApprovalAction, rejectCard],
  );

  // Surfaces the replacement card id (see ApprovalReplaceOutcome), the only
  // action whose caller needs to know which card the edit left behind.
  const handleReplace = useCallback(
    async (approvalId: Id<'cardApprovals'>) => {
      const { result, value } = await runApprovalAction(
        approvalId,
        'store alternative',
        () =>
          storeAlternativeFromApproval({
            approvalId,
            timezone: getUserTimezone(),
          }),
      );
      return { result, cardId: value?.cardId };
    },
    [runApprovalAction, storeAlternativeFromApproval],
  );

  return {
    approvalsByToolCallId,
    processingApprovals,
    handleApprove,
    handleReject,
    handleReplace,
    usageLimitHit,
    isLoaded: !isTransitioning && threadApprovals !== undefined,
  };
}
