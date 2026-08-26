'use client';

import { useTranslations } from 'next-intl';
import { Check, Lock } from 'lucide-react';
import type { Id } from '@/convex/_generated/dataModel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  MARK_ALSO_CORRECT_NOOP,
  MARK_ALSO_CORRECT_SUCCESS,
  type MarkAlsoCorrectToolPart,
} from '@/lib/types/tool-parts';
import type {
  ApprovalActionResult,
  ApprovalData,
} from '@/hooks/use-card-approvals';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { cn } from '@/lib/utils';
import { EntryLines } from './CardApproval';
import {
  ApprovalErrorAlert,
  ApprovalStreamingSkeleton,
  deriveApprovalToolState,
  useApprovalAudio,
  useOptimisticApprovalAction,
  useApprovalDisplaySettings,
} from './approvalCommon';

export interface AlsoCorrectApprovalProps {
  toolPart: MarkAlsoCorrectToolPart;
  approvalsByToolCallId: Map<string, ApprovalData>;
  onAddAsNewCard: (
    approvalId: Id<'cardApprovals'>,
  ) => Promise<ApprovalActionResult>;
  onReplace: (approvalId: Id<'cardApprovals'>) => Promise<ApprovalActionResult>;
  onReject: (approvalId: Id<'cardApprovals'>) => Promise<ApprovalActionResult>;
  processingApprovals: Set<string>;
}

/** Chips like "voice: female" for the metadata fields the model proposed. */
function MetadataChips({
  metadata,
}: {
  metadata: NonNullable<ApprovalData['proposedMetadata']>;
}) {
  const t = useTranslations('Chat.alsoCorrect');
  const entries = Object.entries(metadata).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([field, value]) => (
        <span
          key={field}
          className="rounded-full border border-muted-foreground/20 px-2 py-0.5 text-xs text-muted-foreground"
        >
          {t(`metadataFields.${field}`)}: {t(`metadataValues.${String(value)}`)}
        </span>
      ))}
    </div>
  );
}

/**
 * Inline chat element for a markAlsoCorrect tool call: the tutor judged the
 * user's own phrasing of the reviewed card as also correct, and the user
 * chooses to add it as a new card, replace the card's text with it, or
 * dismiss. Follows CardApproval's state machine (streaming skeleton →
 * pending action row → resolved label).
 */
export function AlsoCorrectApproval({
  toolPart,
  approvalsByToolCallId,
  onAddAsNewCard,
  onReplace,
  onReject,
  processingApprovals,
}: AlsoCorrectApprovalProps) {
  const t = useTranslations('Chat.alsoCorrect');
  const { showIpa, showFurigana } = useApprovalDisplaySettings();
  // Optimistic-with-rollback + paywall machine, shared with CardApproval
  // (approvalCommon.tsx).
  const { optimisticState, paywallFeature, setPaywallFeature, runAction } =
    useOptimisticApprovalAction<
      'newCard' | 'replaced' | 'alternative' | 'rejected',
      'custom_sentences' | 'card_edits'
    >();
  const { isAvailable: addAvailable } = useFeatureQuota('custom_sentences');

  const toolCallId = toolPart.toolCallId?.trim();
  const tool = toolPart as MarkAlsoCorrectToolPart & {
    state?: string;
    errorText?: string;
    output?: unknown;
  };
  const { state: toolState, output: toolOutput } = tool;

  const approval = toolCallId ? approvalsByToolCallId.get(toolCallId) : undefined;
  const approvalId = approval?._id ?? null;
  const entries = approval?.translations ?? [];
  const changedLanguages = new Set(approval?.changedLanguages ?? []);
  const status = approval?.status ?? 'pending';
  const resolution =
    optimisticState === 'rejected'
      ? undefined
      : (optimisticState ?? approval?.resolution);
  const isReplaceOnly = approval?.replaceOnly === true;
  const isRejected = optimisticState === 'rejected' || status === 'rejected';
  const isResolved =
    isRejected || resolution !== undefined || status === 'approved';

  // Same per-line playback + streaming-state machine as CardApproval.
  const entryAudio = useApprovalAudio(approvalId);
  const { isToolComplete, isError } = deriveApprovalToolState(
    { state: toolState, output: toolOutput },
    [MARK_ALSO_CORRECT_SUCCESS, MARK_ALSO_CORRECT_NOOP],
  );
  // No-op outcome: the user's version already matched the card, so no approval
  // row was created and there is nothing to show. Checked before `isWaiting`,
  // which would otherwise sit on "Loading…" forever waiting for a row that is
  // never coming.
  const isNoop = toolOutput === MARK_ALSO_CORRECT_NOOP;
  const isWaiting = !approval || entries.length === 0;
  const isProcessing = approvalId ? processingApprovals.has(approvalId) : false;

  const handleAdd = () =>
    runAction(approvalId, 'newCard', onAddAsNewCard, {
      paywall: 'custom_sentences',
      available: addAvailable,
    });

  // Accepting stores the wording as one of the user's accepted alternatives
  // (writingAlternatives) and forks the card user-owned; the card's own text
  // is untouched. Free, so no paywall/quota gate on this action.
  const handleReplace = () => runAction(approvalId, 'alternative', onReplace);

  const handleReject = () => runAction(approvalId, 'rejected', onReject);

  if (isNoop) return null;

  if (isError) {
    return <ApprovalErrorAlert label={t('failed')} />;
  }

  if (isWaiting && !isToolComplete) {
    return <ApprovalStreamingSkeleton label={t('loading')} />;
  }

  if (isWaiting) {
    return (
      <Alert className="my-3 border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
        <AlertDescription className="text-yellow-700 dark:text-yellow-300">
          {t('loading')}
        </AlertDescription>
      </Alert>
    );
  }

  // Unchanged entries render muted, the changed (also-correct) entries bold.
  // EntryLines' base/target slots are purely presentational.
  const unchangedEntries = entries.filter(
    (e) => !changedLanguages.has(e.language),
  );
  const changedEntries = entries.filter((e) => changedLanguages.has(e.language));

  const isPending = !isResolved && status === 'pending';

  const resolvedLabel = isRejected
    ? t('dismissed')
    : resolution === 'replaced'
      ? t('replaced')
      : resolution === 'alternative'
        ? t('savedAsAlternative')
        : t('added');

  return (
    <Alert
      data-testid="also-correct-approval"
      className={cn(
        'my-3 flex flex-col gap-3',
        isResolved &&
          !isRejected &&
          'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
      )}
    >
      <AlertDescription>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="h-4 w-4" />
          {t('header')}
        </div>
        <EntryLines
          baseEntries={unchangedEntries}
          targetEntries={changedEntries}
          audio={entryAudio}
          ipaByLanguage={approval?.entryIpa}
          furiganaByLanguage={approval?.entryFurigana}
          showFurigana={showFurigana}
          showIpa={showIpa}
        />
        {approval?.proposedMetadata && isPending && (
          <MetadataChips metadata={approval.proposedMetadata} />
        )}
      </AlertDescription>
      <div className="flex w-full flex-wrap items-center gap-2 min-h-8">
        {isPending ? (
          <>
            <Button
              onClick={handleReject}
              disabled={isProcessing || !approvalId}
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-sm"
              data-testid="also-correct-dismiss"
            >
              {t('dismissButton')}
            </Button>
            {/* Dismiss stays left; the accepting actions sit right. Saving
                as an alternative is free (no badge); Add bills
                custom_sentences, so the number next to it describes that
                button. */}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                onClick={handleReplace}
                disabled={isProcessing || !approvalId}
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-3 text-sm"
                title={t('alternativeHint')}
                data-testid="also-correct-replace"
              >
                {t('alternativeButton')}
              </Button>
              {/* Replace-only proposal: the card is still missing text for at
                  least one course language, so adding it as a new card would
                  create a card with a blank line. */}
              {!isReplaceOnly && (
                <>
                  <FeatureBadge featureId="custom_sentences" />
                  <Button
                    onClick={handleAdd}
                    disabled={isProcessing || !approvalId}
                    size="sm"
                    className="h-8 gap-1.5 px-3 text-sm"
                    title={t('addHint')}
                    data-testid="also-correct-add"
                  >
                    {!addAvailable && <Lock className="h-3.5 w-3.5" />}
                    {t('addButton')}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <Button
            disabled
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-3 text-xs font-medium hover:bg-transparent disabled:opacity-100',
              isRejected ? 'text-muted-foreground' : 'text-success',
            )}
            data-testid="also-correct-resolved"
          >
            {resolvedLabel}
          </Button>
        )}
      </div>
      {paywallFeature && (
        <PaywallDialog
          open={paywallFeature !== null}
          setOpen={(open: boolean) => {
            if (!open) setPaywallFeature(null);
          }}
          featureId={paywallFeature}
        />
      )}
    </Alert>
  );
}
