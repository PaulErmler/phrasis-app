'use client';

import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Search, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WordSentencesDialog } from './WordSentencesDialog';
import { WordSearchDialog } from './WordSearchDialog';
import { ExpandedWordsDialog } from './ExpandedWordsDialog';
import { WORD_CLOUD_COLORS as COLORS } from '@/lib/wordCloud';
import { getTextDirection } from '@/lib/languages';

export function useLangName(): (code: string) => string {
  const locale = useLocale();
  return useMemo(() => {
    const dn = new Intl.DisplayNames([locale], { type: 'language' });
    return (code: string) => {
      try {
        return dn.of(code) ?? code.toUpperCase();
      } catch {
        return code.toUpperCase();
      }
    };
  }, [locale]);
}

function SingleWordCloud({
  language,
  words,
  isFirst,
  t,
  langName,
  onWordClick,
  onSearchClick,
  onExpandClick,
}: {
  language: string;
  t: ReturnType<typeof useTranslations<'StatsPage'>>;
  langName: (code: string) => string;
  words: string[];
  isFirst: boolean;
  onWordClick: (word: string, language: string) => void;
  onSearchClick: () => void;
  onExpandClick: () => void;
}) {
  const candidateWords = words.slice(0, 200);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(candidateWords.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const h = container.clientHeight;
      const buttons = container.querySelectorAll<HTMLElement>('[data-cloud-word]');
      let firstOverflow = buttons.length;
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        if (btn.offsetTop + btn.offsetHeight > h) {
          firstOverflow = i;
          break;
        }
      }
      setVisibleCount(firstOverflow);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [words]);

  return (
    <div className="card-surface p-3" data-testid="stats-wordcloud">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {isFirst ? t('recentlyLearnedWords', { language: langName(language) }) : langName(language)}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={onExpandClick}
            aria-label={t('expandWords')}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={onSearchClick}
            aria-label={t('searchWords')}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        dir={getTextDirection(language)}
        className="relative w-full aspect-[5/4] sm:aspect-[20/8] overflow-hidden rounded-lg px-1 py-1 leading-5 text-sm"
        style={{ textAlign: 'justify', textAlignLast: 'left' }}
      >
        {candidateWords.map((w, i) => (
          <Fragment key={`${i}-${w}`}>
            <button
              data-cloud-word
              type="button"
              onClick={() => onWordClick(w, language)}
              aria-label={t('viewSentencesForWord', { word: w })}
              style={{
                color: COLORS[i % COLORS.length],
                visibility: i < visibleCount ? 'visible' : 'hidden',
              }}
              className="inline-block rounded-md px-0.5 font-bold transition-colors hover:bg-muted active:scale-[0.97]"
            >
              {w}
            </button>
            {' '}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function WordCloudSection() {
  const t = useTranslations('StatsPage');
  const langName = useLangName();
  const data = useQuery(api.features.stats.getRecentWords);
  const [selectedWord, setSelectedWord] = useState<{
    word: string;       // normalized (lowercase NFC) — used for the query
    displayWord: string; // original casing from the cloud — shown in dialog title
    language: string;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedLanguage, setExpandedLanguage] = useState<string | null>(null);

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
          langName={langName}
          onWordClick={handleWordClick}
          onSearchClick={() => setSearchOpen(true)}
          onExpandClick={() => setExpandedLanguage(entry.language)}
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
      <ExpandedWordsDialog
        open={expandedLanguage !== null}
        language={expandedLanguage ?? ''}
        onOpenChange={(open) => {
          if (!open) setExpandedLanguage(null);
        }}
        onWordClick={handleWordClick}
      />
    </>
  );
}
