'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  alignWords,
  charDiff,
  scoreWordAlignment,
  getCompareConfig,
  type AlignedWord,
  type CharChunk,
} from '@/lib/textCompare';

interface WordDiffProps {
  expected: string;
  actual: string;
  language: string;
  hideAccuracy?: boolean;
  hideErrors?: boolean;
}

export function computeWordAccuracy(
  expected: string,
  actual: string,
  language: string,
): number {
  const cfg = getCompareConfig(language);
  const result = alignWords(expected, actual, cfg);
  return scoreWordAlignment(result);
}

interface AlignedSegment {
  correct: string;
  wrong: string | null;
  equal: boolean;
}

function buildSegments(chunks: CharChunk[]): AlignedSegment[] {
  const segments: AlignedSegment[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.kind === 'equal') {
      segments.push({ correct: c.text, wrong: null, equal: true });
    } else if (c.kind === 'removed') {
      const next = chunks[i + 1];
      if (next && next.kind === 'added') {
        segments.push({ correct: c.text, wrong: next.text, equal: false });
        i++;
      } else {
        segments.push({ correct: c.text, wrong: '', equal: false });
      }
    } else if (c.kind === 'added') {
      segments.push({ correct: '', wrong: c.text, equal: false });
    }
  }
  return segments;
}

function WordChip({ word, language }: { word: AlignedWord; language: string }) {
  if (word.tag === 'equal') {
    return (
      <span className="rounded-sm bg-success/15 text-success px-1 py-0.5">
        {word.actual}
      </span>
    );
  }

  if (word.tag === 'extra') {
    return (
      <span className="rounded-sm bg-destructive/15 text-destructive line-through px-1 py-0.5">
        {word.actual}
      </span>
    );
  }

  if (word.tag === 'missing') {
    return (
      <span className="rounded-sm border border-dashed border-success/50 bg-success/10 text-success px-1 py-0.5 font-medium">
        {word.expected}
      </span>
    );
  }

  // typo or wrong: render expected word inline at baseline; for each diverging
  // character, float the user's incorrect characters above as a small annotation.
  const cfg = getCompareConfig(language);
  const { chunks } = charDiff(word.expected, word.actual, cfg);
  const segments = buildSegments(chunks);

  const wrapperClass =
    word.tag === 'typo'
      ? 'rounded-sm bg-amber-500/15 text-amber-800 dark:text-amber-200 px-1 py-0.5'
      : 'rounded-sm bg-destructive/10 text-destructive px-1 py-0.5';

  const underlineClass =
    word.tag === 'typo'
      ? 'underline decoration-amber-500/60 decoration-2 underline-offset-2'
      : 'underline decoration-destructive/60 decoration-2 underline-offset-2';

  return (
    <span className={wrapperClass}>
      {segments.map((s, i) => {
        // Unpaired extra char (user typed something that wasn't in the expected word).
        // Render inline as small strike-through so we don't leave an annotation floating
        // above empty space.
        if (s.correct === '' && s.wrong) {
          return (
            <span
              key={i}
              className="text-destructive line-through text-[0.75em]"
            >
              {s.wrong}
            </span>
          );
        }
        return (
          <span key={i} className="relative inline-block">
            {s.wrong !== null && s.wrong.length > 0 && (
              <span
                aria-hidden
                className="absolute left-1/2 -translate-x-1/2 -top-2.5 text-[0.7rem] leading-none text-destructive line-through whitespace-pre pointer-events-none font-medium"
              >
                {s.wrong}
              </span>
            )}
            <span className={s.equal ? '' : underlineClass}>{s.correct}</span>
          </span>
        );
      })}
    </span>
  );
}

export function WordDiff({
  expected,
  actual,
  language,
  hideAccuracy = false,
  hideErrors = false,
}: WordDiffProps) {
  const t = useTranslations('LearningMode');
  const cfg = useMemo(() => getCompareConfig(language), [language]);

  const { words, accuracy } = useMemo(() => {
    const result = alignWords(expected, actual, cfg);
    return {
      words: result.words,
      accuracy: Math.round(scoreWordAlignment(result) * 100),
    };
  }, [expected, actual, cfg]);

  if (hideErrors) {
    return (
      <div>
        <p className="leading-relaxed text-foreground">{expected}</p>
        <p className={`text-muted-xs mt-2 ${hideAccuracy ? 'invisible' : ''}`}>
          {t('accuracy')}: {accuracy}%
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="leading-relaxed flex flex-wrap items-baseline gap-x-1 gap-y-3 pt-3">
        {words.map((w, i) => (
          <WordChip key={i} word={w} language={language} />
        ))}
      </p>
      <p className={`text-muted-xs mt-2 ${hideAccuracy ? 'invisible' : ''}`}>
        {t('accuracy')}: {accuracy}%
      </p>
    </div>
  );
}
