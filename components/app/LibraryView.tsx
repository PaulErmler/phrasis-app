'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useEnsureContent } from '@/hooks/use-ensure-content';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Search, Star, EyeOff, CircleCheck, X, Loader2 } from 'lucide-react';
import { LearningCardContent } from '@/components/app/learning/LearningCardContent';
import { NoCourseEmptyState } from '@/components/app/NoCourseEmptyState';

type ActiveFilter = 'mastered' | 'hidden' | 'favorites' | null;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function LibraryView({
  hasActiveCourse,
  onOpenCourseMenu,
}: {
  hasActiveCourse: boolean;
  onOpenCourseMenu: () => void;
}) {
  const t = useTranslations('AppPage.library');

  const [searchInput, setSearchInput] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null);

  const debouncedSearch = useDebounce(searchInput, 300);

  const result = useQuery(api.features.library.getLibraryCards, {
    searchQuery: debouncedSearch || undefined,
    activeFilter: activeFilter ?? undefined,
  });

  const masterCard = useMutation(api.features.scheduling.masterCard);
  const hideCard = useMutation(api.features.scheduling.hideCard);
  const toggleFavorite = useMutation(api.features.scheduling.toggleFavoriteCard);

  useEnsureContent(result);

  const [pendingMaster, setPendingMaster] = useState<Set<string>>(new Set());
  const [pendingHide, setPendingHide] = useState<Set<string>>(new Set());

  const handleMaster = useCallback(
    async (cardId: Id<'cards'>) => {
      setPendingMaster((prev) => new Set(prev).add(cardId));
      try {
        await masterCard({ cardId });
      } finally {
        setPendingMaster((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }
    },
    [masterCard],
  );

  const handleHide = useCallback(
    async (cardId: Id<'cards'>) => {
      setPendingHide((prev) => new Set(prev).add(cardId));
      try {
        await hideCard({ cardId });
      } finally {
        setPendingHide((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }
    },
    [hideCard],
  );

  const handleFavorite = useCallback(
    async (cardId: Id<'cards'>) => {
      await toggleFavorite({ cardId });
    },
    [toggleFavorite],
  );

  const toggleFilter = (f: Exclude<ActiveFilter, null>) => {
    setActiveFilter((prev) => (prev === f ? null : f));
  };

  const isLoading = result === undefined;
  const cards = result ?? [];
  const hasResults = cards.length > 0;
  const hasActiveFilters = debouncedSearch.length > 0 || activeFilter !== null;

  if (!hasActiveCourse) {
    return (
      <div
        className="scroll-view min-h-0"
        style={{ scrollbarGutter: 'stable' }}
      >
        <NoCourseEmptyState onOpenCourseMenu={onOpenCourseMenu} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-20" style={{ scrollbarGutter: 'stable' }}>
      {/* Sticky search + filters card */}
      <div className="sticky top-0 z-10 bg-background">
        <div className="max-w-xl mx-auto w-full pt-6">
          <div className="card-surface p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9 pr-9"
                placeholder={t('searchPlaceholder')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                data-testid="library-search"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground shrink-0">
                {t('filtersLabel')}
              </span>
              <div className="flex flex-wrap gap-2 justify-end">
                <Toggle
                  pressed={activeFilter === 'mastered'}
                  onPressedChange={() => toggleFilter('mastered')}
                  variant="outline"
                  size="sm"
                  aria-label={t('filterMastered')}
                  data-testid="library-filter-mastered"
                >
                  <CircleCheck className="h-3.5 w-3.5" />
                  {t('filterMastered')}
                </Toggle>
                <Toggle
                  pressed={activeFilter === 'hidden'}
                  onPressedChange={() => toggleFilter('hidden')}
                  variant="outline"
                  size="sm"
                  aria-label={t('filterHidden')}
                  data-testid="library-filter-hidden"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  {t('filterHidden')}
                </Toggle>
                <Toggle
                  pressed={activeFilter === 'favorites'}
                  onPressedChange={() => toggleFilter('favorites')}
                  variant="outline"
                  size="sm"
                  aria-label={t('filterFavorites')}
                  data-testid="library-filter-favorites"
                >
                  <Star className="h-3.5 w-3.5" />
                  {t('filterFavorites')}
                </Toggle>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card list */}
      <div className="max-w-xl mx-auto w-full pt-2.5 pb-4 space-y-4">
        {isLoading && (
          <div className="card-surface p-4 flex items-center justify-center h-[180px]">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs font-medium">
                {t('loadingCards')}
              </span>
            </div>
          </div>
        )}

        {!isLoading && !hasResults && (
          <div className="card-surface p-12 text-center space-y-2">
            {hasActiveFilters ? (
              <>
                <p className="font-medium">{t('emptySearchTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('emptySearchDescription')}</p>
              </>
            ) : (
              <>
                <p className="font-medium">{t('emptyTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('emptyDescription')}</p>
              </>
            )}
          </div>
        )}

        {!isLoading && hasResults && (
          <>
            {cards.map((card) => (
              <div key={card._id} data-testid="library-card">
                <LearningCardContent
                  bare
                  preReviewCount={card.preReviewCount}
                  schedulingPhase={card.schedulingPhase}
                  fsrsState={card.fsrsState}
                  sourceText={card.sourceText}
                  translations={card.translations}
                  audioRecordings={card.audioRecordings}
                  isFavorite={card.isFavorite ?? false}
                  isPendingMaster={pendingMaster.has(card._id) || card.isMastered}
                  isPendingHide={pendingHide.has(card._id) || card.isHidden}
                  onMaster={() => handleMaster(card._id)}
                  onHide={() => handleHide(card._id)}
                  onFavorite={() => handleFavorite(card._id)}
                  hideTargetLanguages={false}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
