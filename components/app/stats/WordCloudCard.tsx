'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { WordCloud, AnimatedWordRenderer } from '@isoterik/react-word-cloud';
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

function CloudRenderer(
  data: WordRendererData,
  ref?: React.Ref<SVGTextElement>,
) {
  return (
    <AnimatedWordRenderer
      ref={ref}
      data={data}
      animationDelay={(_, idx) => idx * 10}
      textStyle={{ transition: 'all .5s ease' }}
    />
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
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const wordData = useMemo(() => buildWords(words.slice(0, 500)), [words]);

  const width = containerWidth || 300;
  const height = Math.min(Math.round(width * 0.55), 280);
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
        className="overflow-hidden rounded-lg"
        style={{ height }}
      >
        {width > 0 && (
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
            transition="all .5s ease"
            enableTooltip={false}
            renderWord={CloudRenderer}
          />
        )}
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
