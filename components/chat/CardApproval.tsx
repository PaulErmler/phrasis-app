'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Id } from '@/convex/_generated/dataModel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getLanguageByCode } from '@/lib/languages';
import type { CreateCardToolPart } from '@/lib/types/tool-parts';
import type { CardApprovalStatus } from '@/convex/types';

const TOOL_SUCCESS = "I've prepared a card for you to review and approve.";

export interface CardApprovalProps {
  toolPart: CreateCardToolPart;
  approvalsByToolCallId: Map<
    string,
    {
      _id: Id<'cardApprovals'>;
      toolCallId: string;
      languages: string[];
      translations: string[];
      mainLanguage: string;
      status: CardApprovalStatus;
    }
  >;
  onApprove: (approvalId: Id<'cardApprovals'>) => Promise<void>;
  onReject: (approvalId: Id<'cardApprovals'>) => Promise<void>;
  processingApprovals: Set<string>;
}

function Lang({ code }: { code: string }) {
  const lang = getLanguageByCode(code);
  return (
    <span className="font-medium text-muted-foreground uppercase text-xs">
      {lang?.code ?? code}
    </span>
  );
}

export function CardApproval({
  toolPart,
  approvalsByToolCallId,
  onApprove,
  onReject,
  processingApprovals,
}: CardApprovalProps) {
  const t = useTranslations('Chat.cardApproval');
  const [optimisticState, setOptimisticState] = useState<
    'approved' | 'rejected' | null
  >(null);

  const toolCallId = toolPart.toolCallId?.trim();
  const tool = toolPart as CreateCardToolPart & {
    state?: string;
    errorText?: string;
    output?: unknown;
  };
  const { state: toolState, errorText: toolErrorText, output: toolOutput } = tool;

  const languages = toolPart.input?.languages ?? [];
  const translations = toolPart.input?.translations ?? [];
  const mainLanguage = toolPart.input?.mainLanguage ?? '';
  const approval = toolCallId ? approvalsByToolCallId.get(toolCallId) : undefined;
  const approvalId = approval?._id ?? null;
  const approvalState = optimisticState ?? approval?.status ?? 'pending';
  const isToolComplete =
    toolState === 'output-available' || toolState === 'output-error';
  const isError =
    toolState === 'output-error' ||
    (isToolComplete &&
      toolOutput !== undefined &&
      toolOutput !== TOOL_SUCCESS);
  const isWaiting =
    !approval ||
    languages.length === 0 ||
    translations.length === 0;
  const isProcessing = approvalId ? processingApprovals.has(approvalId) : false;

  const handleApprove = async () => {
    if (!approvalId) return;
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

  if (isWaiting) {
    const msg = isToolComplete ? t('loading') : t('creatingApproval');
    return (
      <Alert className="my-3 border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
        <AlertDescription className="text-yellow-700 dark:text-yellow-300">
          {msg}
        </AlertDescription>
      </Alert>
    );
  }

  if (approvalState === 'approved') {
    return (
      <Alert className="my-3 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <AlertDescription className="text-success">{t('approved')}</AlertDescription>
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

  const mainIdx = languages.indexOf(mainLanguage);
  const mainText = mainIdx >= 0 ? translations[mainIdx] : translations[0];

  return (
    <Alert className="my-3 flex flex-col gap-3">
      <AlertDescription>
        <div className="space-y-1.5 text-sm">
          <p className="text-base font-medium">
            <Lang code={mainLanguage} /> {mainText}
          </p>
          {languages.map((lang, i) =>
            lang === mainLanguage ? null : (
              <p key={lang}>
                <Lang code={lang} /> {translations[i]}
              </p>
            ),
          )}
        </div>
      </AlertDescription>
      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={handleReject}
          disabled={isProcessing || !approvalId}
          variant="outline"
          size="sm"
          className="h-8 px-3 text-sm"
        >
          {t('rejectButton')}
        </Button>
        <Button
          onClick={handleApprove}
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
