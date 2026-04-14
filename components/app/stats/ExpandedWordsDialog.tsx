'use client';

import { useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { getLangName, COLORS } from './WordCloudCard';

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
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Accumulated list we actually render. We keep old chips mounted when a
  // larger page is being fetched so the UI doesn't flicker and only the new
  // words animate in at the bottom.
  const [displayed, setDisplayed] = useState<string[]>([]);
  const prevLengthRef = useRef(0);

  // Reset everything whenever the dialog is opened or the language changes.
  useEffect(() => {
    if (open) {
      setLimit(PAGE_SIZE);
      setDisplayed([]);
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
    setDisplayed((prev) => {
      if (words.length >= prev.length) {
        prevLengthRef.current = prev.length;
        return words;
      }
      // Shouldn't happen normally (limit only grows), but be safe.
      prevLengthRef.current = words.length;
      return words;
    });
  }, [words]);

  const isInitialLoading = words === undefined && displayed.length === 0;
  // If we asked for `limit` but got fewer, we've exhausted the user's words.
  const exhausted = words !== undefined && words.length < limit;
  const isFetchingMore = words === undefined && displayed.length > 0;
  const canLoadMore = !isFetchingMore && !exhausted && limit < MAX_WORDS;
  const newFromIndex = prevLengthRef.current;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 text-left">
          <DialogTitle className="text-base">
            {language ? t('recentWordsTitle', { language: getLangName(language) }) : ''}
          </DialogTitle>
        </DialogHeader>
        <Separator />
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {isInitialLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {t('noWordsYet')}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {displayed.map((w, i) => (
                  <button
                    key={`${i}-${w}`}
                    type="button"
                    onClick={() => onWordClick(w, language)}
                    style={{ color: COLORS[i % COLORS.length] }}
                    className={
                      'rounded-full px-2.5 py-1 text-sm font-bold transition-colors hover:bg-muted active:scale-[0.97] ' +
                      (i >= newFromIndex
                        ? 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300'
                        : '')
                    }
                  >
                    {w}
                  </button>
                ))}
              </div>
              {(canLoadMore || isFetchingMore) && (
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
