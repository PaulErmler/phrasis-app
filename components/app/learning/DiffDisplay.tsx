'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  charDiff,
  alignWords,
  scoreWordAlignment,
  getCompareConfig,
} from '@/lib/textCompare';
import { WordDiff } from './WordDiff';

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
  if (cfg.hasWordBoundaries) {
    return Math.round(
      scoreWordAlignment(alignWords(expected, actual, cfg)) * 100,
    );
  }
  return Math.round(charDiff(expected, actual, cfg).accuracy * 100);
}

export function DiffDisplay({
  expected,
  actual,
  language = 'en',
  hideAccuracy = false,
  hideErrors = false,
}: DiffDisplayProps) {
  const t = useTranslations('LearningMode');
  const cfg = useMemo(() => getCompareConfig(language), [language]);

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
  const cfg = useMemo(() => getCompareConfig(language), [language]);
  const { chunks, accuracy } = useMemo(
    () => charDiff(expected, actual, cfg),
    [expected, actual, cfg],
  );
  const accuracyPct = Math.round(accuracy * 100);

  return (
    <div>
      <p className="leading-relaxed">
        {chunks.map((chunk, i) => {
          if (chunk.kind === 'added') {
            if (hideErrors) return null;
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
                className={
                  hideErrors
                    ? 'text-foreground'
                    : 'text-foreground bg-muted rounded-sm px-0.5'
                }
              >
                {chunk.text}
              </span>
            );
          }
          return (
            <span
              key={i}
              className={
                hideErrors
                  ? 'text-foreground'
                  : 'bg-success/15 text-success rounded-sm px-0.5'
              }
            >
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
