'use client';

import { useMemo, useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { WordCloud } from '@isoterik/react-word-cloud';
import type { Word } from '@isoterik/react-word-cloud';
import { LandingWordSentencesDialog } from './LandingWordSentencesDialog';
import {
  WORD_CLOUD_COLORS as COLORS,
  StaticWordRenderer,
  buildWords,
  useCloudSize,
} from '@/lib/wordCloud';

const MOCK_WORD_LIST = [
  'amigo',
  'vida',
  'país',
  'manera',
  'tiempo',
  'parte',
  'estado',
  'quiere',
  'esta',
  'muy',
  'nunca',
  'casa',
  'fiesta',
  'todavía',
  'llegó',
  'cómo',
  'poco',
  'importante',
  'tiene',
  'hasta',
  'era',
  'próxima',
  'dígame',
];

export function LandingWordCloud() {
  const t = useTranslations('LandingPage.analytics');
  const { ref: containerRef, width, height } = useCloudSize();
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  const wordData = useMemo(() => buildWords(MOCK_WORD_LIST), []);

  const scale = Math.max(width / 300, 0.7);

  const wordCount = wordData.length;
  const fontSizeFn = useCallback(
    (word: Word) => Math.round((10 + (word.value / wordCount) * 10) * scale),
    [wordCount, scale],
  );
  const fontWeightFn = useCallback(
    (word: Word) => Math.round(400 + (word.value / wordCount) * 100),
    [wordCount],
  );
  const rotateFn = useCallback(() => -360, []);
  const fillFn = useCallback(
    (_: Word, i: number) => COLORS[i % COLORS.length],
    [],
  );
  const handleWordClick = useCallback(
    (word: { text: string }) => setSelectedWord(word.text),
    [],
  );

  // Deterministic PRNG. The seed lives in a ref so the closure's mutation
  // isn't flagged as an after-render reassignment. `randomFn` is only invoked
  // by the word-cloud layout (inside WordCloud), not during this component's
  // render body, so reading/writing the ref there is safe.
  const seedRef = useRef(42);
  const randomFn = useCallback(() => {
    seedRef.current = (seedRef.current * 16807 + 0) % 2147483647;
    return (seedRef.current - 1) / 2147483646;
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className={
          width > 0 && height > 0
            ? 'relative w-full aspect-[20/8] overflow-hidden rounded-lg'
            : 'relative w-full aspect-[20/8] overflow-hidden rounded-lg bg-muted/20'
        }
      >
        {width > 0 && height > 0 ? (
          <WordCloud
            words={wordData}
            width={width}
            height={height}
            timeInterval={1.0}
            spiral="archimedean"
            padding={0}
            font="Impact"
            fontStyle="normal"
            fontSize={fontSizeFn}
            fontWeight={fontWeightFn}
            rotate={rotateFn}
            fill={fillFn}
            random={randomFn}
            transition="none"
            enableTooltip={false}
            renderWord={StaticWordRenderer}
            onWordClick={handleWordClick}
          />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground text-center mt-2">
        {t('wordCloudHint')}
      </p>
      {selectedWord && (
        <LandingWordSentencesDialog
          word={selectedWord}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedWord(null);
          }}
        />
      )}
    </div>
  );
}
