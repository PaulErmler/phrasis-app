'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  alignWords,
  charDiff,
  scoreWordAlignment,
  getCompareConfig,
  type AlignedWord,
  type WordTag,
} from '@/lib/textCompare';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

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

function tagClasses(tag: WordTag): string {
  switch (tag) {
    case 'equal':
      return 'bg-success/15 text-success';
    case 'typo':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    case 'wrong':
      return 'bg-destructive/15 text-destructive';
    case 'missing':
      return 'bg-muted text-foreground border border-dashed border-muted-foreground/40';
    case 'extra':
      return 'bg-destructive/15 text-destructive line-through';
  }
}

function WordChip({ word, language }: { word: AlignedWord; language: string }) {
  const t = useTranslations('LearningMode.diff');
  const className = `rounded-sm px-1 py-0.5 ${tagClasses(word.tag)}`;
  const surface = word.tag === 'missing' ? word.expected : word.actual;

  if (word.tag === 'equal') {
    return <span className={className}>{surface}</span>;
  }

  const tooltipContent = (() => {
    if (word.tag === 'typo') {
      const cfg = getCompareConfig(language);
      const { chunks } = charDiff(word.expected, word.actual, cfg);
      return (
        <span>
          <span className="mr-1 text-xs uppercase opacity-70">
            {t('typo')}:
          </span>
          {chunks.map((c, i) => {
            if (c.kind === 'equal') return <span key={i}>{c.text}</span>;
            if (c.kind === 'added')
              return (
                <span key={i} className="bg-destructive/30 rounded-sm px-0.5">
                  {c.text}
                </span>
              );
            return (
              <span key={i} className="bg-success/30 rounded-sm px-0.5">
                {c.text}
              </span>
            );
          })}
        </span>
      );
    }
    if (word.tag === 'wrong') {
      return (
        <span>
          <span className="mr-1 text-xs uppercase opacity-70">
            {t('expected')}:
          </span>
          <span className="font-medium">{word.expected}</span>
        </span>
      );
    }
    if (word.tag === 'missing') {
      return <span>{t('missingWord')}</span>;
    }
    return <span>{t('extraWord')}</span>;
  })();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{surface}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipContent}</TooltipContent>
    </Tooltip>
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
      <p className="leading-relaxed flex flex-wrap gap-1">
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
