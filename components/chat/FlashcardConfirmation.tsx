'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Id } from '@/convex/_generated/dataModel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { CreateFlashcardToolPart } from '@/lib/types/tool-parts';

/**
 * Props for FlashcardConfirmation component
 */
export interface FlashcardConfirmationProps {
  toolPart: CreateFlashcardToolPart;
  approvalsByToolCallId: Map<
    string,
    {
      _id: Id<'flashcardApprovals'>;
      toolCallId: string;
      text: string;
      note: string;
      status: string;
    }
  >;
  onApprove: (approvalId: Id<'flashcardApprovals'>) => Promise<void>;
  onReject: (approvalId: Id<'flashcardApprovals'>) => Promise<void>;
  processingApprovals: Set<string>;
}

/**
 * Component for displaying flashcard confirmation UI
 * Handles approval/rejection of flashcards created by the AI assistant
 */
export function FlashcardConfirmation({
  toolPart,
  approvalsByToolCallId,
  onApprove,
  onReject,
  processingApprovals,
}: FlashcardConfirmationProps) {
  const t = useTranslations('Chat.flashcardConfirmation');

  // Local state for optimistic updates when user clicks approve/reject
  const [optimisticState, setOptimisticState] = useState<
    'approved' | 'rejected' | null
  >(null);

  // Extract stable values from toolPart (now properly typed)
  // Handle cases where input might not be populated yet during streaming
  const text = toolPart.input?.text || '';
  const note = toolPart.input?.note || '';
  const toolCallId = toolPart.toolCallId;

  // If input data isn't ready yet (still streaming), don't render
  if (!text && !note) {
    return null;
  }

  const approval = toolCallId
    ? approvalsByToolCallId.get(toolCallId)
    : undefined;

  const approvalId = approval?._id ?? null;

  // Determine the current state: use optimistic state if available, otherwise use backend status
  const approvalState =
    optimisticState ||
    (approval?.status as 'pending' | 'approved' | 'rejected') ||
    'pending';

  const handleApprovalClick = async () => {
    if (!approvalId) return;
    setOptimisticState('approved');
    await onApprove(approvalId);
  };

  const handleRejectionClick = async () => {
    if (!approvalId) return;
    setOptimisticState('rejected');
    await onReject(approvalId);
  };

  const isProcessing = approvalId ? processingApprovals.has(approvalId) : false;

  // Check if the tool is still executing (not yet completed)
  // The 'state' property exists at runtime but isn't in our type definition
  const toolState = (toolPart as unknown as { state?: string }).state;
  const isToolExecuting = toolState === 'partial-call' || toolState === 'call';

  // Show "creating" message only if the tool is still executing AND approval doesn't exist yet
  // After tool completes, if approval still doesn't exist, don't show anything (avoid stuck state)
  if (!approval) {
    // Only show loading state if tool is actively executing
    if (isToolExecuting) {
      return (
        <Alert className="my-3 border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
          <AlertDescription className="text-yellow-700 dark:text-yellow-300">
            {t('creatingApproval')}
          </AlertDescription>
        </Alert>
      );
    }
    // Tool has completed but approval not yet in query results - don't render anything
    // (the query will update shortly and re-render with the approval)
    return null;
  }

  if (approvalState === 'approved') {
    return (
      <Alert className="my-3 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <AlertDescription className="text-success">
          ✓ {t('approved')}
        </AlertDescription>
      </Alert>
    );
  }

  if (approvalState === 'rejected') {
    return (
      <Alert className="my-3 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
        <AlertDescription className="text-red-700 dark:text-red-300">
          {t('rejected')}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="my-3 flex flex-col gap-3">
      <AlertDescription>
        <div className="space-y-2 text-sm">
          <p>
            <strong>{t('textLabel')}:</strong> {text}
          </p>
          <p>
            <strong>{t('noteLabel')}:</strong> {note}
          </p>
        </div>
      </AlertDescription>
      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={handleRejectionClick}
          disabled={isProcessing || !approvalId}
          variant="outline"
          size="sm"
          className="h-8 px-3 text-sm"
        >
          {t('rejectButton')}
        </Button>
        <Button
          onClick={handleApprovalClick}
          disabled={isProcessing || !approvalId}
          size="sm"
          className="h-8 px-3 text-sm"
        >
          {t('approveButton')}
        </Button>
      </div>
    </Alert>
  );
}
