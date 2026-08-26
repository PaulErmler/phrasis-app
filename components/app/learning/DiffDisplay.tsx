'use client';

import { useMemo, type ReactNode } from 'react';
import { charDiff, getCompareConfig, toDiffOptions } from '@/lib/textCompare';
import { WordDiff } from './WordDiff';
import { AccuracyFooter, CleanRevealedSentence } from './CleanRevealedSentence';
import { getTextDirection } from '@/lib/languages';

interface DiffDisplayProps {
  expected: string;
  actual: string;
  /** Target-language code, e.g. 'en', 'ja'. Drives locale-aware segmentation. */
  language?: string;
  hideAccuracy?: boolean;
  /** Drop the accuracy footer entirely (see WordDiff.omitAccuracy). */
  omitAccuracy?: boolean;
  hideErrors?: boolean;
  /** `courseSettings.ignorePunctuation`. Drop punctuation from the score. */
  ignorePunctuation?: boolean;
  /**
   * Bracketed furigana for `expected` (lib/furigana.ts). Only the clean
   * reveal renders it — diff chips stay bare, readings over struck-through
   * fragments would be noise.
   */
  furigana?: string;
  /** Romanization/IPA, rendered under the sentence and above the accuracy line. */
  afterText?: ReactNode;
}

// Lives in lib/textCompare/accuracy.ts so non-React code (and the auto-rating
// helper) can use it; re-exported here because this was its original home.
export { computeAccuracy } from '@/lib/textCompare';

export function DiffDisplay({
  expected,
  actual,
  language = 'en',
  hideAccuracy = false,
  omitAccuracy = false,
  hideErrors = false,
  ignorePunctuation = false,
  furigana,
  afterText,
}: DiffDisplayProps) {
  const cfg = getCompareConfig(language);

  if (cfg.hasWordBoundaries) {
    return (
      <WordDiff
        expected={expected}
        actual={actual}
        language={language}
        hideAccuracy={hideAccuracy}
        omitAccuracy={omitAccuracy}
        hideErrors={hideErrors}
        ignorePunctuation={ignorePunctuation}
        furigana={furigana}
        afterText={afterText}
      />
    );
  }

  return (
    <CharDiffView
      expected={expected}
      actual={actual}
      language={language}
      hideAccuracy={hideAccuracy}
      omitAccuracy={omitAccuracy}
      hideErrors={hideErrors}
      ignorePunctuation={ignorePunctuation}
      furigana={furigana}
      afterText={afterText}
    />
  );
}

interface CharDiffViewProps {
  expected: string;
  actual: string;
  language: string;
  hideAccuracy: boolean;
  omitAccuracy: boolean;
  hideErrors: boolean;
  ignorePunctuation: boolean;
  furigana?: string;
  afterText?: ReactNode;
}

function CharDiffView({
  expected,
  actual,
  language,
  hideAccuracy,
  omitAccuracy,
  hideErrors,
  ignorePunctuation,
  furigana,
  afterText,
}: CharDiffViewProps) {
  const diffOpts = useMemo(
    () => toDiffOptions(getCompareConfig(language, { ignorePunctuation })),
    [language, ignorePunctuation],
  );
  const { chunks, accuracy } = useMemo(
    () => charDiff(expected, actual, diffOpts),
    [expected, actual, diffOpts],
  );
  const accuracyPct = Math.round(accuracy * 100);

  // Clean revealed sentence. The char chunks reassemble to exactly
  // `expected` once 'added' runs are hidden, so render it via
  // ClickableWords instead: locale-aware segmentation makes each word
  // clickable (ask-AI popover), matching the shadowing-mode card.
  if (hideErrors) {
    return (
      <CleanRevealedSentence
        text={expected}
        language={language}
        accuracy={accuracyPct}
        hideAccuracy={hideAccuracy}
        furigana={furigana}
        afterText={afterText}
      />
    );
  }

  return (
    <div>
      <p dir={getTextDirection(language)} className="leading-relaxed text-left">
        {chunks.map((chunk, i) => {
          // Punctuation-only mismatch while ignoring punctuation: it cost the
          // user nothing, so don't render it as an error.
          if (chunk.ignored) {
            return (
              <span
                key={i}
                className="bg-muted text-muted-foreground rounded-sm px-0.5"
              >
                {chunk.text}
              </span>
            );
          }
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
      {afterText}
      {!omitAccuracy && (
        <AccuracyFooter accuracy={accuracyPct} hideAccuracy={hideAccuracy} />
      )}
    </div>
  );
}
