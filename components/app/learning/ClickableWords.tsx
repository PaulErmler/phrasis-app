'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { languageSupportsKaraoke } from '@/lib/languages';
import { useLearningChatToggle } from './LearningChatLayout';
import type { WordTiming } from './types';

interface Props {
  text: string;
  /** BCP-47 language code of `text`. Drives locale-aware word segmentation. */
  language: string;
  wordTimings: WordTiming[] | null | undefined;
  localTime: number;
  isActive: boolean;
  /** User setting — when false, karaoke is off but words remain clickable. */
  enabled: boolean;
  className?: string;
  /** When false, renders plain text without popovers (e.g. blurred translations). */
  interactive?: boolean;
  /** When set, tag the longest cleaned word with this `data-coachmark-anchor`
   *  value so onboarding's driver.js step can target a single concrete word
   *  rather than the whole sentence wrapper. Only the target-language
   *  instance of `ClickableWords` should set this. */
  coachmarkAnchorForLongestWord?: string;
}

/** Strip leading/trailing punctuation/symbols so "Haus," → "Haus". */
function cleanWord(display: string): string {
  return display.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

const MIN_MATCH_RATIO = 0.5;

/**
 * Tokenized card text: each word is clickable and opens a popover with an
 * "Explain this word" button that pre-fills the learning-mode chat with an
 * explanation prompt. Preserves the karaoke highlighting behavior of
 * HighlightedText.
 */
export function ClickableWords({
  coachmarkAnchorForLongestWord,
  text,
  language,
  wordTimings,
  localTime,
  isActive,
  enabled,
  className,
  interactive = true,
}: Props) {
  const chatContext = useLearningChatToggle();
  const t = useTranslations('Chat');

  const aligned = useMemo(
    () => alignWordTimings(text, wordTimings, language),
    [text, wordTimings, language],
  );

  const canKaraoke = useMemo(() => {
    if (!languageSupportsKaraoke(language)) return false;
    return (
      enabled &&
      !!wordTimings &&
      wordTimings.length > 0 &&
      matchRatio(aligned) >= MIN_MATCH_RATIO
    );
  }, [language, enabled, wordTimings, aligned]);

  const currentIndex =
    isActive && canKaraoke ? findCurrentIndex(aligned, localTime) : -1;

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (!interactive || aligned.length === 0 || !chatContext) {
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
    chatContext.openChatWithPrompt(t('explainWord', { word: cleaned }));
    setOpenIndex(null);
  };

  // Tag the longest cleaned word with a `data-coachmark-anchor` *only* when
  // the caller opted in (target-language instance). Without the opt-in, the
  // first ClickableWords in DOM order would win the global query selector —
  // typically the source paragraph, which is the wrong thing to highlight.
  const longestWordIndex = coachmarkAnchorForLongestWord
    ? aligned.reduce<{ idx: number; len: number }>(
      (best, w, i) => {
        const cleanedLen = cleanWord(w.display).length;
        return cleanedLen > best.len ? { idx: i, len: cleanedLen } : best;
      },
      { idx: -1, len: 0 },
    ).idx
    : -1;

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
                data-coachmark-anchor={
                  i === longestWordIndex ? coachmarkAnchorForLongestWord : undefined
                }
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
                {t('askAI')}
              </Button>
            </PopoverContent>
          </Popover>
        </span>
      ))}
    </p>
  );
}
