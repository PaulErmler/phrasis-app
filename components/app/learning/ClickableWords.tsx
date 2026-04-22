'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  alignWordTimings,
  findCurrentIndex,
  matchRatio,
} from '@/lib/audio/alignTimings';
import { useLearningChatToggle } from './LearningChatLayout';
import type { WordTiming } from './types';

interface Props {
  text: string;
  wordTimings: WordTiming[] | null | undefined;
  localTime: number;
  isActive: boolean;
  /** User setting — when false, karaoke is off but words remain clickable. */
  enabled: boolean;
  className?: string;
  /** When false, renders plain text without popovers (e.g. blurred translations). */
  interactive?: boolean;
}

/** Strip leading/trailing punctuation/symbols so "Haus," → "Haus". */
function cleanWord(display: string): string {
  return display.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

const MIN_MATCH_RATIO = 0.5;

/**
 * Tokenized card text: each word is clickable and opens a popover with an
 * "Ask AI" button that pre-fills the learning-mode chat with an explanation
 * prompt. Preserves the karaoke highlighting behavior of HighlightedText.
 */
export function ClickableWords({
  text,
  wordTimings,
  localTime,
  isActive,
  enabled,
  className,
  interactive = true,
}: Props) {
  const { openChatWithPrompt } = useLearningChatToggle();
  const t = useTranslations('Chat');

  const aligned = useMemo(
    () => alignWordTimings(text, wordTimings),
    [text, wordTimings],
  );

  const canKaraoke = useMemo(
    () =>
      enabled &&
      !!wordTimings &&
      wordTimings.length > 0 &&
      matchRatio(aligned) >= MIN_MATCH_RATIO,
    [enabled, wordTimings, aligned],
  );

  const currentIndex =
    isActive && canKaraoke ? findCurrentIndex(aligned, localTime) : -1;

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (!interactive || aligned.length === 0) {
    if (!canKaraoke || !isActive) {
      return <p className={className}>{text}</p>;
    }
    return (
      <p className={className}>
        {aligned.map((w, i) => (
          <span
            key={i}
            className={cn(
              'transition-colors duration-200',
              i === currentIndex && 'text-primary',
            )}
          >
            {w.leading}
            {w.display}
          </span>
        ))}
      </p>
    );
  }

  const handleAsk = (word: string) => {
    const cleaned = cleanWord(word);
    if (!cleaned) return;
    openChatWithPrompt(t('explainWord', { word: cleaned }));
    setOpenIndex(null);
  };

  return (
    <p className={className}>
      {aligned.map((w, i) => (
        <span key={i}>
          {w.leading}
          <Popover
            open={openIndex === i}
            onOpenChange={(open) => setOpenIndex(open ? i : null)}
          >
            <PopoverTrigger asChild>
              <span
                role="button"
                tabIndex={0}
                aria-label={t('askAboutWord', { word: cleanWord(w.display) })}
                data-testid="clickable-word"
                className={cn(
                  'cursor-pointer rounded-sm transition-colors duration-200 hover:bg-muted',
                  i === currentIndex && 'text-primary',
                  openIndex === i && 'text-warning hover:bg-transparent',
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenIndex((prev) => (prev === i ? null : i));
                  }
                }}
              >
                {w.display}
              </span>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-1"
              side="top"
              align="center"
              sideOffset={6}
            >
              <Button
                size="sm"
                variant="secondary"
                data-testid="ask-ai-button"
                onClick={() => handleAsk(w.display)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('askAI')}
              </Button>
            </PopoverContent>
          </Popover>
        </span>
      ))}
    </p>
  );
}
