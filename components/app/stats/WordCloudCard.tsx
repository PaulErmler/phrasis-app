'use client';

import { useMemo, useCallback, useRef, useLayoutEffect, useState, type Ref } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { WordCloud } from '@isoterik/react-word-cloud';
import type { Word, WordRendererData } from '@isoterik/react-word-cloud';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WordSentencesDialog } from './WordSentencesDialog';
import { WordSearchDialog } from './WordSearchDialog';

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

export const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', el: 'Greek',
  cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', uk: 'Ukrainian', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', he: 'Hebrew', fa: 'Persian',
};

export function getLangName(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

function SingleWordCloud({
  language,
  words,
  isFirst,
  t,
  onWordClick,
  onSearchClick,
}: {
  language: string;
  t: ReturnType<typeof useTranslations<'StatsPage'>>;
  words: string[];
  isFirst: boolean;
  onWordClick: (word: string, language: string) => void;
  onSearchClick: () => void;
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

  // Memoize all callback props so the WordCloud (React.memo) doesn't
  // re-render and re-animate on every parent state change.
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
    (word: { text: string }) => onWordClick(word.text, language),
    [onWordClick, language],
  );

  // Fixed seed so layout is deterministic across any forced recompute
  const randomFn = useMemo(() => {
    let seed = 42;
    return () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }, []);

  return (
    <div className="card-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {isFirst ? t('recentlyLearnedWords', { language: getLangName(language) }) : getLangName(language)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          aria-label={t('searchWords')}
          onClick={onSearchClick}
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
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
    </div>
  );
}

export function WordCloudSection() {
  const t = useTranslations('StatsPage');
  const data = useQuery(api.features.stats.getRecentWords);
  const [selectedWord, setSelectedWord] = useState<{
    word: string;       // normalized (lowercase NFC) — used for the query
    displayWord: string; // original casing from the cloud — shown in dialog title
    language: string;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const handleWordClick = useCallback(
    (displayWord: string, language: string) =>
      setSelectedWord({
        word: displayWord.toLowerCase().normalize('NFC'),
        displayWord,
        language,
      }),
    [],
  );

  if (!data || data.length === 0) return null;

  return (
    <>
      {data.map((entry, i) => (
        <SingleWordCloud
          key={entry.language}
          language={entry.language}
          words={entry.words}
          isFirst={i === 0}
          t={t}
          onWordClick={handleWordClick}
          onSearchClick={() => setSearchOpen(true)}
        />
      ))}
      {selectedWord && (
        <WordSentencesDialog
          word={selectedWord.word}
          displayWord={selectedWord.displayWord}
          language={selectedWord.language}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedWord(null);
          }}
        />
      )}
      <WordSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
