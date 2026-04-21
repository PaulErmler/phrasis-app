'use client';

import { Fragment, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Search, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WordSentencesDialog } from './WordSentencesDialog';
import { WordSearchDialog } from './WordSearchDialog';
import { ExpandedWordsDialog } from './ExpandedWordsDialog';
import { WORD_CLOUD_COLORS as COLORS } from '@/lib/wordCloud';

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
  onExpandClick,
}: {
  language: string;
  t: ReturnType<typeof useTranslations<'StatsPage'>>;
  words: string[];
  isFirst: boolean;
  onWordClick: (word: string, language: string) => void;
  onSearchClick: () => void;
  onExpandClick: () => void;
}) {
  return (
    <div className="card-surface p-3" data-testid="stats-wordcloud">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {isFirst ? t('recentlyLearnedWords', { language: getLangName(language) }) : getLangName(language)}
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
        className="relative w-full aspect-[20/8] overflow-hidden rounded-lg px-1 py-1 leading-7 text-sm"
        style={{ textAlign: 'justify', textAlignLast: 'left' }}
      >
        {words.map((w, i) => (
          <Fragment key={`${i}-${w}`}>
            <button
              type="button"
              onClick={() => onWordClick(w, language)}
              aria-label={t('viewSentencesForWord', { word: w })}
              style={{ color: COLORS[i % COLORS.length] }}
              className="inline-block rounded-md px-1 font-bold transition-colors hover:bg-muted active:scale-[0.97]"
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
