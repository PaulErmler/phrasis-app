'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useControllableState } from '@radix-ui/react-use-controllable-state';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  alignWordTimings,
  matchRatio,
} from '@/lib/audio/alignTimings';
import { getTextDirection, languageSupportsKaraoke } from '@/lib/languages';
import { useKaraokeIndex, type ClockBinding } from '@/hooks/use-karaoke-index';
import { useLearningChatToggle } from './LearningChatLayout';
import type { WordTiming } from './types';

interface Props {
  text: string;
  /** BCP-47 language code of `text`. Drives locale-aware word segmentation. */
  language: string;
  wordTimings: WordTiming[] | null | undefined;
  localTime: number;
  /**
   * Merged-playback word-position source. When set (and active), the word
   * index ticks from a clock subscription inside this leaf instead of the
   * `localTime` prop — no parent re-renders per frame.
   */
  clockBinding?: ClockBinding;
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

interface AskAboutWordProps {
  /** The sentence word the popover asks about (punctuation is stripped). */
  word: string;
  className?: string;
  children: ReactNode;
  /** Controlled open state — pass both to share open-state across words
   *  (ClickableWords' single-open `openIndex`). Omit for local state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Passed through to the trigger span as `data-coachmark-anchor` so
   *  onboarding's driver.js step can target this word. */
  coachmarkAnchor?: string;
}

/**
 * Per-word "Ask AI" popover — the single implementation of the clickable
 * word trigger, used both by ClickableWords' word loop and by content that
 * renders its own word visuals (e.g. the writing-mode diff chips). Falls
 * back to a plain span when there's no chat context (landing demo) or the
 * word is punctuation-only.
 */
export function AskAboutWord({
  word,
  className,
  children,
  open: openProp,
  onOpenChange,
  coachmarkAnchor,
}: AskAboutWordProps) {
  const chatContext = useLearningChatToggle();
  const t = useTranslations('Chat');
  const [open, setOpen] = useControllableState({
    prop: openProp,
    defaultProp: false,
    onChange: onOpenChange,
  });
  const cleaned = cleanWord(word);

  if (!chatContext || !cleaned) {
    // No wrapper span in the bare case — e.g. punctuation chips rely on
    // being direct flex children (their -ml-1 cancels the parent's gap).
    return className ? (
      <span className={className}>{children}</span>
    ) : (
      <>{children}</>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={t('askAboutWord', { word: cleaned })}
          data-testid="clickable-word"
          data-coachmark-anchor={coachmarkAnchor}
          className={cn('cursor-pointer', className)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(!open);
            }
          }}
        >
          {children}
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
          onClick={() => {
            chatContext.openChatWithPrompt(t('explainWord', { word: cleaned }));
            setOpen(false);
          }}
        >
          {t('askAI')}
        </Button>
      </PopoverContent>
    </Popover>
  );
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
  clockBinding,
  isActive,
  enabled,
  className,
  interactive = true,
}: Props) {
  const chatContext = useLearningChatToggle();

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

  const currentIndex = useKaraokeIndex(
    aligned,
    isActive && canKaraoke,
    localTime,
    clockBinding,
  );

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Explicit direction so RTL sentences (Arabic, Hebrew, Persian) keep a
  // trailing neutral mark (. ! ?) at the sentence END — without it the bidi
  // algorithm resolves the mark to the page's LTR direction and renders it
  // at the visual start of the sentence. `text-left` overrides the
  // right-alignment `dir="rtl"` would otherwise apply, keeping RTL sentences
  // flush with the rest of the LTR layout.
  const dir = getTextDirection(language);
  const dirClassName = cn(className, dir === 'rtl' && 'text-left');

  if (!interactive || aligned.length === 0 || !chatContext) {
    if (!canKaraoke || !isActive) {
      return <p dir={dir} className={dirClassName}>{text}</p>;
    }
    return (
      <p dir={dir} className={dirClassName}>
        {aligned.map((w, i) => (
          <Fragment key={i}>
            <span
              className={cn(
                'transition-colors duration-200',
                i === currentIndex && 'text-primary',
              )}
            >
              {w.leading}
              {w.display}
            </span>
            {w.trailing}
          </Fragment>
        ))}
      </p>
    );
  }

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
    <p dir={dir} className={dirClassName}>
      {aligned.map((w, i) => (
        // Fragment (not wrapper <span>) — wrapping each word in a span made
        // the LAST word's clickable area lose the hit-test in RTL paragraphs:
        // the picker landed on the wrapper instead of the inner trigger span,
        // and hover/click never fired on the actual word. Inline children of
        // the <p> participate directly in the parent bidi context.
        <Fragment key={i}>
          {w.leading}
          <AskAboutWord
            word={w.display}
            open={openIndex === i}
            onOpenChange={(open) => setOpenIndex(open ? i : null)}
            coachmarkAnchor={
              i === longestWordIndex ? coachmarkAnchorForLongestWord : undefined
            }
            className={cn(
              'rounded-sm transition-colors duration-200 hover:bg-muted',
              i === currentIndex && 'text-primary',
              openIndex === i && 'text-warning hover:bg-transparent',
            )}
          >
            {w.display}
          </AskAboutWord>
          {w.trailing}
        </Fragment>
      ))}
    </p>
  );
}
