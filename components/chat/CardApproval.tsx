'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Pencil } from 'lucide-react';
import type { Id } from '@/convex/_generated/dataModel';
import { AudioButton } from '@/components/app/learning/AudioButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { getLanguageShortLabel, getTextDirection } from '@/lib/languages';
import {
  CREATE_CARD_SUCCESS,
  type CreateCardToolPart,
} from '@/lib/types/tool-parts';
import type { CardApprovalStatus } from '@/convex/types';
import type { ApprovalActionResult } from '@/hooks/use-card-approvals';
import { FeatureBadge } from '@/components/feature_tracking/FeatureBadge';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { useCourseLanguages } from '@/hooks/use-course-languages';
import { cn } from '@/lib/utils';
import { EditApprovalDialog } from './EditApprovalDialog';
import { Ruby } from '@/components/app/learning/Ruby';
import { furiganaDisplay } from '@/lib/furigana';
import {
  ApprovalErrorAlert,
  ApprovalStreamingSkeleton,
  deriveApprovalToolState,
  useApprovalAudio,
  useOptimisticApprovalAction,
  useShowFurigana,
  useShowIpa,
  type EntryAudio,
} from './approvalCommon';

// Re-exported for existing importers; the definition lives with the other
// shared approval pieces.
export type { EntryAudio } from './approvalCommon';

export interface CardApprovalProps {
  toolPart: CreateCardToolPart;
  approvalsByToolCallId: Map<
    string,
    {
      _id: Id<'cardApprovals'>;
      toolCallId: string;
      translations: { language: string; text: string }[];
      entryIpa?: Record<string, string>;
      entryFurigana?: Record<string, string>;
      status: CardApprovalStatus;
    }
  >;
  onApprove: (approvalId: Id<'cardApprovals'>) => Promise<ApprovalActionResult>;
  onReject: (approvalId: Id<'cardApprovals'>) => Promise<ApprovalActionResult>;
  processingApprovals: Set<string>;
}

export function Lang({ code }: { code: string }) {
  return (
    <span className="font-medium text-muted-foreground uppercase text-xs">
      {getLanguageShortLabel(code)}
    </span>
  );
}

/**
 * Sentence lines for an approval box. `baseEntries` render muted/small,
 * `targetEntries` bold. CardApproval maps base/target languages onto the
 * slots; AlsoCorrectApproval maps unchanged/changed entries instead (the
 * split is purely presentational).
 */
export function EntryLines({
  baseEntries,
  targetEntries,
  className,
  audio,
  ipaByLanguage,
  showIpa = false,
  furiganaByLanguage,
  showFurigana = true,
}: {
  baseEntries: { language: string; text: string }[];
  targetEntries: { language: string; text: string }[];
  className?: string;
  /** When set, each line gets a play icon (click-to-generate, like collection previews). */
  audio?: EntryAudio;
  /**
   * IPA per language (cardApprovals.entryIpa), rendered under the sentence
   * when `showIpa` is on. `''` = espeak failed (hidden).
   */
  ipaByLanguage?: Record<string, string>;
  /**
   * IPA line toggle (from courseSettings.showIpa; default OFF). Passed in
   * rather than read from context here: this component also renders outside
   * AppDataProvider, in the store-screenshot route (app/store-frames).
   */
  showIpa?: boolean;
  /**
   * Bracketed furigana per language (cardApprovals.entryFurigana), rendered
   * as ruby over the sentence when `showFurigana` is on. `''` = nothing to
   * annotate (hidden); an entry that no longer matches the (edited) text is
   * rejected by parseFurigana and renders plain.
   */
  furiganaByLanguage?: Record<string, string>;
  /** Furigana toggle (courseSettings.showFurigana; default ON). */
  showFurigana?: boolean;
}) {
  const renderLine = (
    entry: { language: string; text: string },
    key: string,
    textClass: string,
  ) => {
    const ipa = showIpa ? ipaByLanguage?.[entry.language] : undefined;
    // Ruby readings over the proposed sentence. The '' sentinel and
    // annotations that no longer reconstruct an edited text both come back
    // with null segments, so both fall back to the plain sentence.
    const { segments: furiganaSegments, rubyClass } = furiganaDisplay(
      showFurigana ? furiganaByLanguage?.[entry.language] : undefined,
      entry.text,
    );
    const line = (
      <div key={audio ? undefined : key}>
        <p className={cn(textClass, rubyClass)}>
          <Lang code={entry.language} />{' '}
          {/* Own dir-scoped span: the Latin language label shares this <p>,
              so the sentence needs its own bidi context for RTL languages. */}
          <span dir={getTextDirection(entry.language)}>
            {furiganaSegments ? <Ruby segments={furiganaSegments} /> : entry.text}
          </span>
        </p>
        {ipa && <p className="text-ipa">/{ipa}/</p>}
      </div>
    );
    if (!audio) return line;
    return (
      <div key={key} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{line}</div>
        <AudioButton
          url={audio.urlByLanguage.get(entry.language) ?? null}
          language={entry.language}
          onRequestGenerate={
            entry.text.length > 0
              ? () => audio.onRequestAudio(entry.language)
              : undefined
          }
        />
      </div>
    );
  };
  return (
    <div className={cn('space-y-1.5 text-sm', className)}>
      {baseEntries.map((entry, i) =>
        renderLine(entry, `base-${i}`, 'text-sm text-muted-foreground'),
      )}
      {targetEntries.map((entry, i) =>
        renderLine(entry, `target-${i}`, 'text-base font-semibold'),
      )}
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
  const showIpa = useShowIpa();
  const showFurigana = useShowFurigana();
  // Optimistic-with-rollback + paywall machine, shared with
  // AlsoCorrectApproval (approvalCommon.tsx). This box bills exactly one
  // quota, so `paywallFeature` reduces to an open flag.
  const { optimisticState, paywallFeature, setPaywallFeature, runAction } =
    useOptimisticApprovalAction<'approved' | 'rejected', 'custom_sentences'>();
  const paywallOpen = paywallFeature !== null;
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

  // Per-line playback + streaming-state machine, shared with
  // AlsoCorrectApproval (approvalCommon.tsx).
  const entryAudio: EntryAudio | undefined = useApprovalAudio(approvalId);
  const { isToolComplete, isError } = deriveApprovalToolState(
    { state: toolState, output: toolOutput },
    CREATE_CARD_SUCCESS,
  );
  const isWaiting = !approval || entries.length === 0;
  const isProcessing = approvalId ? processingApprovals.has(approvalId) : false;

  const handleApprove = () =>
    runAction(approvalId, 'approved', onApprove, {
      paywall: 'custom_sentences',
      available: isAvailable,
    });

  const handleReject = () => runAction(approvalId, 'rejected', onReject);

  if (isError) {
    return <ApprovalErrorAlert label={t('failed')} />;
  }

  if (isWaiting && !isToolComplete) {
    return <ApprovalStreamingSkeleton label={t('creatingApproval')} />;
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
            ipaByLanguage={approval?.entryIpa}
            showIpa={showIpa}
            furiganaByLanguage={approval?.entryFurigana}
            showFurigana={showFurigana}
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
            audio={entryAudio}
            ipaByLanguage={approval?.entryIpa}
            showIpa={showIpa}
            furiganaByLanguage={approval?.entryFurigana}
            showFurigana={showFurigana}
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
        <EntryLines
          baseEntries={baseEntries}
          targetEntries={targetEntries}
          audio={entryAudio}
          ipaByLanguage={approval?.entryIpa}
          showIpa={showIpa}
          furiganaByLanguage={approval?.entryFurigana}
          showFurigana={showFurigana}
        />
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
              onClick={() => setPaywallFeature('custom_sentences')}
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
          setOpen={(open: boolean) => {
            if (!open) setPaywallFeature(null);
          }}
          featureId="custom_sentences"
        />
      )}
    </Alert>
  );
}
