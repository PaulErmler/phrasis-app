'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Pencil } from 'lucide-react';
import type { Id } from '@/convex/_generated/dataModel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { getLanguageShortLabel, getTextDirection } from '@/lib/languages';
import type { CreateCardToolPart } from '@/lib/types/tool-parts';
import type { CardApprovalStatus } from '@/convex/types';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { useCourseLanguages } from '@/hooks/use-course-languages';
import { cn } from '@/lib/utils';
import { EditApprovalDialog } from './EditApprovalDialog';

const TOOL_SUCCESS = "Card has been created.";

export interface CardApprovalProps {
  toolPart: CreateCardToolPart;
  approvalsByToolCallId: Map<
    string,
    {
      _id: Id<'cardApprovals'>;
      toolCallId: string;
      translations: { language: string; text: string }[];
      status: CardApprovalStatus;
    }
  >;
  onApprove: (approvalId: Id<'cardApprovals'>) => Promise<void>;
  onReject: (approvalId: Id<'cardApprovals'>) => Promise<void>;
  processingApprovals: Set<string>;
}

function Lang({ code }: { code: string }) {
  return (
    <span className="font-medium text-muted-foreground uppercase text-xs">
      {getLanguageShortLabel(code)}
    </span>
  );
}

function EntryLines({
  baseEntries,
  targetEntries,
  className,
}: {
  baseEntries: { language: string; text: string }[];
  targetEntries: { language: string; text: string }[];
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5 text-sm', className)}>
      {baseEntries.map((entry, i) => (
        <p key={`base-${i}`} className="text-sm text-muted-foreground">
          <Lang code={entry.language} />{' '}
          {/* Own dir-scoped span: the Latin language label shares this <p>,
              so the sentence needs its own bidi context for RTL languages. */}
          <span dir={getTextDirection(entry.language)}>{entry.text}</span>
        </p>
      ))}
      {targetEntries.map((entry, i) => (
        <p key={`target-${i}`} className="text-base font-semibold">
          <Lang code={entry.language} />{' '}
          <span dir={getTextDirection(entry.language)}>{entry.text}</span>
        </p>
      ))}
    </div>
  );
}

export function CardApproval({
  toolPart,
  approvalsByToolCallId,
  onApprove,
  onReject,
  processingApprovals,
}: CardApprovalProps) {
  const { targetLanguages } = useCourseLanguages();
  const t = useTranslations('Chat.cardApproval');
  const [optimisticState, setOptimisticState] = useState<
    'approved' | 'rejected' | null
  >(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { isAvailable } = useFeatureQuota('custom_sentences');

  const toolCallId = toolPart.toolCallId?.trim();
  const tool = toolPart as CreateCardToolPart & {
    state?: string;
    errorText?: string;
    output?: unknown;
  };
  const { state: toolState, output: toolOutput } = tool;

  const approval = toolCallId ? approvalsByToolCallId.get(toolCallId) : undefined;
  const entries =
    approval?.translations && approval.translations.length > 0
      ? approval.translations
      : (toolPart.input?.translations ?? []);
  const approvalId = approval?._id ?? null;
  const approvalState = optimisticState ?? approval?.status ?? 'pending';
  const isToolComplete =
    toolState === 'output-available' || toolState === 'output-error';
  const isError =
    toolState === 'output-error' ||
    (isToolComplete &&
      toolOutput !== undefined &&
      toolOutput !== TOOL_SUCCESS);
  const isWaiting = !approval || entries.length === 0;
  const isProcessing = approvalId ? processingApprovals.has(approvalId) : false;

  const handleApprove = async () => {
    if (!approvalId) return;
    if (!isAvailable) {
      setPaywallOpen(true);
      return;
    }
    setOptimisticState('approved');
    await onApprove(approvalId);
  };

  const handleReject = async () => {
    if (!approvalId) return;
    setOptimisticState('rejected');
    await onReject(approvalId);
  };

  if (isError) {
    return (
      <Alert className="my-3 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
        <AlertDescription className="text-red-700 dark:text-red-300">
          {t('failed')}
        </AlertDescription>
      </Alert>
    );
  }

  if (isWaiting && !isToolComplete) {
    return (
      <Alert className="my-3 border-muted animate-pulse">
        <AlertDescription>
          <div className="space-y-2">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-5 w-5/6 rounded bg-muted" />
          </div>
          <div className="mt-3">
            <Shimmer duration={1.5}>{t('creatingApproval')}</Shimmer>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const targetEntries = entries.filter((e) => targetLanguages.includes(e.language));
  const baseEntries = entries.filter((e) => !targetLanguages.includes(e.language));

  if (isWaiting && entries.length > 0) {
    return (
      <Alert className="my-3 flex flex-col gap-3 border-muted">
        <AlertDescription>
          <EntryLines
            baseEntries={baseEntries}
            targetEntries={targetEntries}
          />
        </AlertDescription>
        <div className="flex items-center justify-end gap-2 h-8">
          <Shimmer duration={1.5}>{t('loading')}</Shimmer>
        </div>
      </Alert>
    );
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

  if (!isToolComplete) {
    return (
      <Alert className="my-3 flex flex-col gap-3 border-muted">
        <AlertDescription>
          <EntryLines
            baseEntries={baseEntries}
            targetEntries={targetEntries}
            className="opacity-60"
          />
          <div className="mt-3">
            <Shimmer duration={1.5}>{t('creatingApproval')}</Shimmer>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const isPending = approvalState === 'pending';
  const isApproved = approvalState === 'approved';

  return (
    <Alert
      data-testid="card-approval"
      className={cn(
        'my-3 flex flex-col gap-3',
        isApproved && 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
        approvalState === 'rejected' && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950',
      )}
    >
      <AlertDescription>
        <EntryLines baseEntries={baseEntries} targetEntries={targetEntries} />
      </AlertDescription>
      <div className="flex w-full items-center gap-2 h-8">
        {isPending && <FeatureBadge featureId="custom_sentences" />}
        {isPending && (
          <Button
            onClick={handleReject}
            disabled={isProcessing || !approvalId}
            variant="outline"
            size="sm"
            className="h-8 px-3 text-sm"
            data-testid="card-reject"
          >
            {t('rejectButton')}
          </Button>
        )}
        {isPending ? (
          !isAvailable ? (
            <Button
              key="approve-upgrade"
              onClick={() => setPaywallOpen(true)}
              size="sm"
              className="h-8 px-3 text-sm gap-1.5"
              data-testid="card-approve"
            >
              <Lock className="h-3.5 w-3.5" />
              Upgrade
            </Button>
          ) : (
            <Button
              key="approve-action"
              onClick={handleApprove}
              disabled={isProcessing || !approvalId}
              size="sm"
              className="h-8 px-3 text-sm"
              data-testid="card-approve"
            >
              {t('approveButton')}
            </Button>
          )
        ) : (
          <Button
            key="approval-status"
            disabled
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-3 text-xs font-medium hover:bg-transparent disabled:opacity-100',
              isApproved ? 'text-success' : 'text-red-700 dark:text-red-300',
            )}
            {...(isApproved ? { 'data-testid': 'card-approved-indicator' } : {})}
          >
            {isApproved ? t('approved') : t('rejected')}
          </Button>
        )}
        {isPending && approvalId && (
          <Button
            onClick={() => setEditOpen(true)}
            disabled={isProcessing}
            variant="outline"
            size="icon"
            className="ml-auto h-8 w-8"
            aria-label={t('editButton')}
            data-testid="card-edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {approvalId && (
        <EditApprovalDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          approvalId={approvalId}
          translations={entries}
        />
      )}
      {paywallOpen && (
        <PaywallDialog
          open={paywallOpen}
          setOpen={setPaywallOpen}
          featureId="custom_sentences"
        />
      )}
    </Alert>
  );
}
