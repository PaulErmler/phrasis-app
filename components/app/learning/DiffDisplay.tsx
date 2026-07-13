'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  charDiff,
  alignWords,
  scoreWordAlignment,
  getCompareConfig,
  toDiffOptions,
} from '@/lib/textCompare';
import { WordDiff } from './WordDiff';
import { ClickableWords } from './ClickableWords';

interface DiffDisplayProps {
  expected: string;
  actual: string;
  /** Target-language code, e.g. 'en', 'ja'. Drives locale-aware segmentation. */
  language?: string;
  hideAccuracy?: boolean;
  hideErrors?: boolean;
}

/** 0–100 accuracy. Word-weighted for languages with word boundaries; otherwise grapheme-level. */
export function computeAccuracy(
  expected: string,
  actual: string,
  language: string = 'en',
): number {
  const cfg = getCompareConfig(language);
  const diffOpts = toDiffOptions(cfg);
  if (cfg.hasWordBoundaries) {
    return Math.round(
      scoreWordAlignment(alignWords(expected, actual, diffOpts)) * 100,
    );
  }
  return Math.round(charDiff(expected, actual, diffOpts).accuracy * 100);
}

export function DiffDisplay({
  expected,
  actual,
  language = 'en',
  hideAccuracy = false,
  hideErrors = false,
}: DiffDisplayProps) {
  const t = useTranslations('LearningMode');
  const cfg = getCompareConfig(language);

  if (cfg.hasWordBoundaries) {
    return (
      <WordDiff
        expected={expected}
        actual={actual}
        language={language}
        hideAccuracy={hideAccuracy}
        hideErrors={hideErrors}
      />
    );
  }

  return (
    <CharDiffView
      expected={expected}
      actual={actual}
      language={language}
      hideAccuracy={hideAccuracy}
      hideErrors={hideErrors}
      accuracyLabel={t('accuracy')}
    />
  );
}

interface CharDiffViewProps {
  expected: string;
  actual: string;
  language: string;
  hideAccuracy: boolean;
  hideErrors: boolean;
  accuracyLabel: string;
}

function CharDiffView({
  expected,
  actual,
  language,
  hideAccuracy,
  hideErrors,
  accuracyLabel,
}: CharDiffViewProps) {
  const diffOpts = useMemo(
    () => toDiffOptions(getCompareConfig(language)),
    [language],
  );
  const { chunks, accuracy } = useMemo(
    () => charDiff(expected, actual, diffOpts),
    [expected, actual, diffOpts],
  );
  const accuracyPct = Math.round(accuracy * 100);

  // Clean revealed sentence — the char chunks reassemble to exactly
  // `expected` once 'added' runs are hidden, so render it via
  // ClickableWords instead: locale-aware segmentation makes each word
  // clickable (ask-AI popover), matching the shadowing-mode card.
  if (hideErrors) {
    return (
      <div>
        <ClickableWords
          text={expected}
          language={language}
          wordTimings={null}
          localTime={0}
          isActive={false}
          enabled={false}
          className="leading-relaxed text-foreground"
        />
        <p className={`text-muted-xs mt-2 ${hideAccuracy ? 'invisible' : ''}`}>
          {accuracyLabel}: {accuracyPct}%
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="leading-relaxed">
        {chunks.map((chunk, i) => {
          if (chunk.kind === 'added') {
            return (
              <span
                key={i}
                className="bg-destructive/15 text-destructive rounded-sm px-0.5"
              >
                {chunk.text}
              </span>
            );
          }
          if (chunk.kind === 'removed') {
            return (
              <span
                key={i}
                className="text-foreground bg-muted rounded-sm px-0.5"
              >
                {chunk.text}
              </span>
            );
          }
          return (
            <span key={i} className="bg-success/15 text-success rounded-sm px-0.5">
              {chunk.text}
            </span>
          );
        })}
      </p>
      <p className={`text-muted-xs mt-2 ${hideAccuracy ? 'invisible' : ''}`}>
        {accuracyLabel}: {accuracyPct}%
      </p>
    </div>
  );
}
