'use client';

import { Fragment, useEffect, useMemo, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { Loader2, Search, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLangName } from './WordCloudCard';
import { WORD_CLOUD_COLORS as COLORS } from '@/lib/wordCloud';
import { getTextDirection } from '@/lib/languages';

const PAGE_SIZE = 500;
const MAX_WORDS = 10000;

export function ExpandedWordsDialog({
  open,
  onOpenChange,
  language,
  onWordClick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: string;
  onWordClick: (word: string, language: string) => void;
}) {
  const t = useTranslations('StatsPage');
  const langName = useLangName();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  // Accumulated list we actually render. We keep old chips mounted when a
  // larger page is being fetched so the UI doesn't flicker and only the new
  // words animate in at the bottom.
  const [displayed, setDisplayed] = useState<string[]>([]);
  // Index of the first item in the newest batch. Used to animate only the
  // tail that just arrived. Updated in the same effect that commits `words`.
  const [newFromIndex, setNewFromIndex] = useState(0);
  const prevLengthRef = useRef(0);

  // Reset everything whenever the dialog is opened or the language changes.
  useEffect(() => {
    if (open) {
      setLimit(PAGE_SIZE);
      setDisplayed([]);
      setSearch('');
      setNewFromIndex(0);
      prevLengthRef.current = 0;
    }
  }, [open, language]);

  const words = useQuery(
    api.features.stats.getRecentWordsForLanguage,
    open && language ? { language, limit } : 'skip',
  );

  // When a new (extended) result arrives, append just the new tail so the
  // existing chips stay mounted and keep their DOM identity.
  useEffect(() => {
    if (!words) return;
    const prev = prevLengthRef.current;
    setNewFromIndex(words.length >= prev ? prev : words.length);
    prevLengthRef.current = words.length;
    setDisplayed(words);
  }, [words]);

  const isInitialLoading = words === undefined && displayed.length === 0;
  // If we asked for `limit` but got fewer, we've exhausted the user's words.
  const exhausted = words !== undefined && words.length < limit;
  const isFetchingMore = words === undefined && displayed.length > 0;
  const canLoadMore = !isFetchingMore && !exhausted && limit < MAX_WORDS;

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;

  // Debounce the server-side search so we don't fire a query on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(trimmedSearch), 200);
    return () => clearTimeout(id);
  }, [trimmedSearch]);

  const searchResults = useQuery(
    api.features.stats.searchWordsForLanguage,
    open && language && debouncedSearch.length > 0
      ? { language, searchQuery: debouncedSearch }
      : 'skip',
  );

  // While the debounce is catching up, keep showing the prior results so the
  // UI doesn't flash empty between keystrokes.
  const isSearchLoading =
    isSearching && (debouncedSearch !== trimmedSearch || searchResults === undefined);
  const filtered = useMemo(
    () => (isSearching ? (searchResults ?? []) : displayed),
    [isSearching, searchResults, displayed],
  );
  // Map a searched word back to its index in `displayed` (if loaded) so its
  // chip color stays stable with the recent view.
  const indexInDisplayed = useMemo(() => {
    if (!isSearching) return null;
    const map = new Map<string, number>();
    displayed.forEach((w, i) => map.set(w, i));
    return map;
  }, [isSearching, displayed]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[85vh] flex flex-col sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 text-left">
          <DialogTitle className="text-base">
            {language ? t('recentWordsTitle', { language: langName(language) }) : ''}
          </DialogTitle>
        </DialogHeader>
        <Separator />
        {displayed.length > 0 && (
          <div className="px-4 pt-3 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchWordsPlaceholder')}
                className="h-9 pl-8 pr-8"
                aria-label={t('searchWords')}
              />
              {isSearchLoading && (
                <Loader2 className="pointer-events-none absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {isSearching && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label={t('clearSearch')}
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {isInitialLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {t('noWordsYet')}
            </div>
          ) : isSearching && !isSearchLoading && filtered.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {t('searchWordsNoResults')}
            </div>
          ) : (
            <>
              <div
                dir={getTextDirection(language)}
                className="leading-8 text-sm"
                style={{ textAlign: 'justify', textAlignLast: 'left' }}
              >
                {filtered.map((w, i) => {
                  // Keep chip color stable with the recent view when possible.
                  const fromMap = indexInDisplayed?.get(w);
                  const originalIndex =
                    fromMap !== undefined ? fromMap : i;
                  const isNew = !isSearching && i >= newFromIndex;
                  const key = `${isSearching ? 's' : 'r'}-${originalIndex}-${w}`;
                  return (
                    <Fragment key={key}>
                      <button
                        type="button"
                        onClick={() => onWordClick(w, language)}
                        aria-label={t('viewSentencesForWord', { word: w })}
                        style={{ color: COLORS[originalIndex % COLORS.length] }}
                        className={
                          'inline-block rounded-md px-1 font-bold transition-colors hover:bg-muted active:scale-[0.97] ' +
                          (isNew
                            ? 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300'
                            : '')
                        }
                      >
                        {w}
                      </button>
                      {' '}
                    </Fragment>
                  );
                })}
              </div>
              {!isSearching && (canLoadMore || isFetchingMore) && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_WORDS))}
                    disabled={isFetchingMore}
                    className="min-w-28"
                  >
                    {isFetchingMore ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('loadMore')
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
