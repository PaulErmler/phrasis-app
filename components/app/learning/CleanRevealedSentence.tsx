'use client';

import { useTranslations } from 'next-intl';
import { ClickableWords } from './ClickableWords';

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
  const t = useTranslations('LearningMode');
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
      <p className={`text-muted-xs mt-2 ${hideAccuracy ? 'invisible' : ''}`}>
        {t('accuracy')}: {accuracy}%
      </p>
    </div>
  );
}
