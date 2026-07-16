'use client';

import { useTranslations } from 'next-intl';
import { ClickableWords } from './ClickableWords';

/**
 * "Accuracy: N%" footer under a diffed/revealed sentence — the single
 * implementation shared by the clean reveal below and the show-diff branches
 * of WordDiff and DiffDisplay. `hideAccuracy` keeps the layout height via
 * `invisible` instead of unmounting.
 */
export function AccuracyFooter({
  accuracy,
  hideAccuracy = false,
}: {
  /** 0–100. */
  accuracy: number;
  hideAccuracy?: boolean;
}) {
  const t = useTranslations('LearningMode');
  return (
    <p className={`text-muted-xs mt-2 ${hideAccuracy ? 'invisible' : ''}`}>
      {t('accuracy')}: {accuracy}%
    </p>
  );
}

interface CleanRevealedSentenceProps {
  text: string;
  language: string;
  /** 0–100. */
  accuracy: number;
  hideAccuracy?: boolean;
}

/**
 * Clean revealed sentence for the hideErrors reveal — words are clickable
 * (ask-AI popover), matching the shadowing-mode card. Karaoke props are off;
 * this is a static reveal. Shared by the word-diff and char-diff paths so
 * space-separated and CJK languages render the reveal identically.
 */
export function CleanRevealedSentence({
  text,
  language,
  accuracy,
  hideAccuracy = false,
}: CleanRevealedSentenceProps) {
  return (
    <div>
      <ClickableWords
        text={text}
        language={language}
        wordTimings={null}
        localTime={0}
        isActive={false}
        enabled={false}
        className="leading-relaxed text-foreground"
      />
      <AccuracyFooter accuracy={accuracy} hideAccuracy={hideAccuracy} />
    </div>
  );
}
