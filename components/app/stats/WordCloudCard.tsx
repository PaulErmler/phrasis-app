'use client';

import { useMemo, useRef, useLayoutEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { WordCloud } from '@isoterik/react-word-cloud';
import type { Word, WordRendererData } from '@isoterik/react-word-cloud';

// App brand colors: primary (blue), accent-orange, warning (yellow)
const COLORS = [
  'oklch(0.7162 0.119 217.31)',   // --primary (blue)
  'oklch(0.6189 0.1636 40.89)',   // --accent-orange
  'oklch(0.8179 0.1705 77.95)',   // --warning (yellow)
];

function buildWords(wordList: string[]): Word[] {
  return wordList.map((text, i) => ({
    text,
    value: wordList.length - i,
  }));
}

function StaticWordRenderer(
  data: WordRendererData,
  ref?: React.Ref<SVGTextElement>,
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

const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', el: 'Greek',
  cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', uk: 'Ukrainian', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', he: 'Hebrew', fa: 'Persian',
};

function getLangName(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

function SingleWordCloud({
  language,
  words,
  isFirst,
}: {
  language: string;
  words: string[];
  isFirst: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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

  const wordData = useMemo(() => buildWords(words.slice(0, 500)), [words]);

  const { width, height } = size;
  const scale = Math.max(width / 400, 1); // scale up on wider screens, never shrink below base

  return (
    <div className="card-surface p-3">
      <div className="mb-2">
        <span className="text-sm font-medium text-muted-foreground">
          {isFirst ? `Recently learned words — ${getLangName(language)}` : getLangName(language)}
        </span>
      </div>
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
            fontSize={(word) => {
              const t = word.value / wordData.length;
              return Math.round((10 + t * 10) * scale);
            }}
            fontWeight={(word) => {
              const t = word.value / wordData.length;
              return Math.round(400 + t * 100);
            }}
            rotate={() => -360}
            fill={(_, i) => COLORS[i % COLORS.length]}
            transition="none"
            enableTooltip={false}
            renderWord={StaticWordRenderer}
          />
        ) : null}
      </div>
    </div>
  );
}

export function WordCloudSection() {
  const data = useQuery(api.features.stats.getRecentWords);

  if (!data || data.length === 0) return null;

  return (
    <>
      {data.map((entry, i) => (
        <SingleWordCloud
          key={entry.language}
          language={entry.language}
          words={entry.words}
          isFirst={i === 0}
        />
      ))}
    </>
  );
}
