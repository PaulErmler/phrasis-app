'use client';

import { useTranslations } from 'next-intl';
import {
  BookOpenText,
  Clock,
  Handshake,
  Minimize2,
  RefreshCcw,
  Shuffle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Suggestions } from '@/components/ai-elements/suggestion';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  SENTENCE_QUICK_ACTION_KINDS,
  type SentenceQuickActionKind,
} from '@/convex/features/chat/quickActions';

const ICONS: Record<SentenceQuickActionKind, LucideIcon> = {
  grammar: BookOpenText,
  conjugation: RefreshCcw,
  tenses: Clock,
  paraphrase: Shuffle,
  formal: Handshake,
  simpler: Minimize2,
};

interface QuickActionsRowProps {
  onAction: (kind: SentenceQuickActionKind) => void;
  /**
   * Localized target-language name. When set, the prompts name it
   * explicitly ("…this Romanian sentence…") so it is unambiguous which
   * language the tutor should analyze. Omitted for multi-target courses.
   */
  languageLabel?: string;
  disabled?: boolean;
}

/**
 * The message a quick action sends — language-qualified when the course has
 * a single target language. Shared by the row, the grid, and the sender in
 * LearnView so the tooltip/tile text always matches what is sent.
 */
export function quickActionMessage(
  t: (key: string, values?: Record<string, string>) => string,
  kind: SentenceQuickActionKind,
  languageLabel?: string,
): string {
  return languageLabel
    ? t(`${kind}.messageWithLanguage`, { language: languageLabel })
    : t(`${kind}.message`);
}

/**
 * Sentence-level tutor quick actions rendered below the latest chat
 * explanation. Mobile: horizontally scrollable pill row. Desktop: wrapping
 * chips, each with a tooltip previewing the message that will be sent.
 */
export function QuickActionsRow({
  onAction,
  languageLabel,
  disabled,
}: QuickActionsRowProps) {
  const t = useTranslations('Chat.quickActions');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const buttons = SENTENCE_QUICK_ACTION_KINDS.map((kind) => {
    const Icon = ICONS[kind];
    const button = (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-full gap-1.5 px-3 text-xs"
        disabled={disabled}
        data-testid={`quick-action-${kind}`}
        onClick={() => onAction(kind)}
      >
        <Icon className="h-3.5 w-3.5" />
        {t(`${kind}.label`)}
      </Button>
    );
    if (!isDesktop) {
      return <span key={kind}>{button}</span>;
    }
    return (
      <Tooltip key={kind}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom">
          {quickActionMessage(t, kind, languageLabel)}
        </TooltipContent>
      </Tooltip>
    );
  });

  if (isDesktop) {
    return <div className="mt-2 flex flex-wrap gap-1.5">{buttons}</div>;
  }
  return (
    <div className="mt-2 w-full min-w-0">
      <Suggestions>{buttons}</Suggestions>
    </div>
  );
}

/**
 * Empty-thread variant: the same actions as labeled tiles in a 2-column
 * grid, with the message each tile sends as its description.
 */
export function QuickActionsGrid({
  onAction,
  languageLabel,
  disabled,
}: QuickActionsRowProps) {
  const t = useTranslations('Chat.quickActions');

  return (
    <div className="grid w-full grid-cols-2 gap-2">
      {SENTENCE_QUICK_ACTION_KINDS.map((kind) => {
        const Icon = ICONS[kind];
        return (
          <Button
            key={kind}
            type="button"
            variant="outline"
            disabled={disabled}
            data-testid={`quick-tile-${kind}`}
            onClick={() => onAction(kind)}
            className="h-auto flex-col items-start gap-1 whitespace-normal rounded-xl p-3 text-left"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Icon className="h-4 w-4 shrink-0" />
              {t(`${kind}.label`)}
            </span>
            <span className="text-xs font-normal leading-snug text-muted-foreground">
              {quickActionMessage(t, kind, languageLabel)}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
