'use client';

import { useMemo, useCallback, useRef, useLayoutEffect, useState, type Ref } from 'react';
import { useTranslations } from 'next-intl';
import { WordCloud } from '@isoterik/react-word-cloud';
import type { Word, WordRendererData } from '@isoterik/react-word-cloud';
import { LandingWordSentencesDialog } from './LandingWordSentencesDialog';

const COLORS = [
  'oklch(0.7162 0.119 217.31)',   // primary blue
  'oklch(0.6189 0.1636 40.89)',   // accent orange
  'oklch(0.8179 0.1705 77.95)',   // warning yellow
];

const MOCK_WORD_LIST = [
  'amigo', 'vida', 'país', 'manera', 'tiempo',
  'parte', 'estado', 'quiere', 'esta', 'muy',
  'nunca', 'casa', 'fiesta', 'todavía', 'llegó',
  'cómo', 'poco', 'importante', 'tiene', 'hasta',
  'era', 'próxima', 'dígame',
];

function buildWords(wordList: string[]): Word[] {
  return wordList.map((text, i) => ({
    text,
    value: wordList.length - i,
  }));
}

function StaticWordRenderer(
  data: WordRendererData,
  ref?: Ref<SVGTextElement>,
) {
  const { index, onWordClick, onWordMouseOver, onWordMouseOut, ...word } = data;
  return (
    <text
      ref={ref}
      textAnchor="middle"
      transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
      style={{
        fontFamily: word.font,
        fontStyle: word.style,
        fontWeight: word.weight,
        fontSize: `${word.size}px`,
        fill: word.fill,
        transition: word.transition,
        cursor: onWordClick ? 'pointer' : 'text',
      }}
      onClick={(event) => onWordClick?.(word, index, event)}
      onMouseOver={(event) => onWordMouseOver?.(word, index, event)}
      onMouseOut={(event) => onWordMouseOut?.(word, index, event)}
    >
      {word.text}
    </text>
  );
}

export function LandingWordCloud() {
  const t = useTranslations('LandingPage.analytics');
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const apply = (w: number, h: number) => {
      if (w > 0 && h > 0) {
        setSize({ width: Math.round(w), height: Math.round(h) });
      }
    };

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        apply(cr.width, cr.height);
      }
    });
    ro.observe(el);

    const r = el.getBoundingClientRect();
    apply(r.width, r.height);

    return () => ro.disconnect();
  }, []);

  const wordData = useMemo(() => buildWords(MOCK_WORD_LIST), []);

  const { width, height } = size;
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
  const fillFn = useCallback((_: Word, i: number) => COLORS[i % COLORS.length], []);
  const handleWordClick = useCallback(
    (word: { text: string }) => setSelectedWord(word.text),
    [],
  );

  const randomFn = useMemo(() => {
    let seed = 42;
    return () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    };
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
