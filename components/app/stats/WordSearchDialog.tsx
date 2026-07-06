'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useDebounce } from '@/hooks/use-debounce';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { WordSentencesDialog } from './WordSentencesDialog';
import { useLangName } from './WordCloudCard';

function groupByLanguage(
  items: Array<{ word: string; displayWord: string; language: string }>,
) {
  const map = new Map<
    string,
    Array<{ word: string; displayWord: string; language: string }>
  >();
  for (const item of items) {
    const list = map.get(item.language);
    if (list) list.push(item);
    else map.set(item.language, [item]);
  }
  return Array.from(map, ([language, items]) => ({ language, items }));
}

export function WordSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('StatsPage');
  const langName = useLangName();
  const [input, setInput] = useState('');
  const debouncedInput = useDebounce(input, 300);

  const results = useQuery(
    api.features.stats.searchWords,
    open && debouncedInput.length > 0
      ? { searchQuery: debouncedInput }
      : 'skip',
  );

  const [selectedWord, setSelectedWord] = useState<{
    word: string;
    displayWord: string;
    language: string;
  } | null>(null);

  const handleSelect = useCallback(
    (item: { word: string; displayWord: string; language: string }) => {
      setSelectedWord(item);
    },
    [],
  );

  const grouped = groupByLanguage(results ?? []);

  return (
    <>
      <CommandDialog
        open={open && !selectedWord}
        onOpenChange={(o) => {
          if (!o) {
            setInput('');
            onOpenChange(false);
          }
        }}
        title={t('searchWords')}
        description={t('searchWordsDescription')}
      >
        <CommandInput
          placeholder={t('searchWordsPlaceholder')}
          value={input}
          onValueChange={setInput}
        />
        <CommandList>
          <CommandEmpty>
            {debouncedInput.length === 0
              ? t('searchWordsHint')
              : t('searchWordsNoResults')}
          </CommandEmpty>
          {grouped.map(({ language, items }) => (
            <CommandGroup key={language} heading={langName(language)}>
              {items.map((item) => (
                <CommandItem
                  key={`${item.language}:${item.word}`}
                  onSelect={() => handleSelect(item)}
                >
                  {item.displayWord}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>

      {selectedWord && (
        <WordSentencesDialog
          word={selectedWord.word}
          displayWord={selectedWord.displayWord}
          language={selectedWord.language}
          open={true}
          onOpenChange={(o) => {
            if (!o) setSelectedWord(null);
          }}
        />
      )}
    </>
  );
}
