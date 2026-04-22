'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, usePreloadedQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useEnsureContent } from '@/hooks/use-ensure-content';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Search, Star, EyeOff, CircleCheck, X, Loader2 } from 'lucide-react';
import { LearningCardContent } from '@/components/app/learning/LearningCardContent';
import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
import { NoCourseEmptyState } from '@/components/app/NoCourseEmptyState';
import { useAppData } from '@/components/app/AppDataProvider';
import type { CardTranslation } from '@/components/app/learning/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

type ActiveFilter = 'mastered' | 'hidden' | 'favorites' | null;

type LibraryCard = FunctionReturnType<typeof api.features.library.getLibraryCards>[number];

type StickyEntry = {
  card: LibraryCard;
  isMastered: boolean;
  isHidden: boolean;
};

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
  const tLearn = useTranslations('LearningMode');

  const { preloadedCourseSettings } = useAppData();
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const highlightEnabled = courseSettings?.highlightWords !== false;

  const [searchInput, setSearchInput] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null);

  const debouncedSearch = useDebounce(searchInput, 300);

  const result = useQuery(api.features.library.getLibraryCards, {
    searchQuery: debouncedSearch || undefined,
    activeFilter: activeFilter ?? undefined,
  });

  const masterCard = useMutation(api.features.scheduling.masterCard);
  const unmasterCard = useMutation(api.features.scheduling.unmasterCard);
  const hideCard = useMutation(api.features.scheduling.hideCard);
  const unhideCard = useMutation(api.features.scheduling.unhideCard);
  const toggleFavorite = useMutation(api.features.scheduling.toggleFavoriteCard);
  const deleteCard = useMutation(api.features.scheduling.deleteCardPermanently);

  const [editingCard, setEditingCard] = useState<{
    cardId: Id<'cards'>;
    translations: CardTranslation[];
  } | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<Id<'cards'> | null>(null);

  // Ephemeral per-card per-language speed overrides — live only for as long
  // as this view is mounted. The library is a preview surface: the user
  // should be able to slow a clip down to check pronunciation without
  // persisting that choice onto the card (which LearningMode would then
  // inherit). Keyed by cardId with a nested language→speed map so we can
  // pass the inner map straight to LearningCardContent's per-card props.
  const [ephemeralOverrides, setEphemeralOverrides] = useState<
    Record<string, Record<string, number>>
  >({});

  const handleSpeedCycle = useCallback(
    (cardId: Id<'cards'>, language: string, next: number | null) => {
      setEphemeralOverrides((prev) => {
        const cardMap = { ...(prev[cardId] ?? {}) };
        if (next === null) delete cardMap[language];
        else cardMap[language] = next;
        return { ...prev, [cardId]: cardMap };
      });
    },
    [],
  );

  useEnsureContent(result);

  // Cards the user toggled (master/hide) while in the current view. Kept
  // visible even after the live query stops returning them, so the user sees
  // their action took effect without the card vanishing. Cleared whenever the
  // filter or search changes.
  const [stickyCards, setStickyCards] = useState<Map<Id<'cards'>, StickyEntry>>(
    () => new Map(),
  );

  // Captures the displayed order across renders so cards keep their position
  // when a toggle removes them from (or returns them to) the live query.
  const orderRef = useRef<Id<'cards'>[]>([]);

  useEffect(() => {
    setStickyCards(new Map());
    orderRef.current = [];
  }, [activeFilter, debouncedSearch]);

  const handleMaster = useCallback(
    async (card: LibraryCard, currentlyMastered: boolean) => {
      const nextMastered = !currentlyMastered;
      setStickyCards((prev) => {
        const next = new Map(prev);
        const existing = next.get(card._id);
        next.set(card._id, {
          card,
          isMastered: nextMastered,
          isHidden: existing?.isHidden ?? card.isHidden,
        });
        return next;
      });
      if (nextMastered) {
        await masterCard({ cardId: card._id });
      } else {
        await unmasterCard({ cardId: card._id });
      }
    },
    [masterCard, unmasterCard],
  );

  const handleHide = useCallback(
    async (card: LibraryCard, currentlyHidden: boolean) => {
      const nextHidden = !currentlyHidden;
      setStickyCards((prev) => {
        const next = new Map(prev);
        const existing = next.get(card._id);
        next.set(card._id, {
          card,
          isMastered: existing?.isMastered ?? card.isMastered,
          isHidden: nextHidden,
        });
        return next;
      });
      if (nextHidden) {
        await hideCard({ cardId: card._id });
      } else {
        await unhideCard({ cardId: card._id });
      }
    },
    [hideCard, unhideCard],
  );

  const handleFavorite = useCallback(
    async (cardId: Id<'cards'>) => {
      await toggleFavorite({ cardId });
    },
    [toggleFavorite],
  );

  const handleConfirmDelete = useCallback(async () => {
    const cardId = deletingCardId;
    if (!cardId) return;
    setDeletingCardId(null);
    setStickyCards((prev) => {
      if (!prev.has(cardId)) return prev;
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });
    orderRef.current = orderRef.current.filter((id) => id !== cardId);
    try {
      await deleteCard({ cardId });
    } catch (error) {
      console.error('Failed to delete card:', error);
    }
  }, [deletingCardId, deleteCard]);

  const toggleFilter = (f: Exclude<ActiveFilter, null>) => {
    setActiveFilter((prev) => (prev === f ? null : f));
  };

  const isLoading = result === undefined;
  const liveCards = useMemo(() => result ?? [], [result]);

  // Merge live results with sticky entries while preserving the prior visual
  // order. Cards retained from the previous render keep their position so a
  // user-toggled card doesn't jump to the bottom when the live query drops it.
  // New live cards (not yet in the order) are appended at the end.
  const displayCards = useMemo(() => {
    const liveById = new Map(liveCards.map((c) => [c._id, c]));
    const newOrder: Id<'cards'>[] = [];
    const seen = new Set<Id<'cards'>>();
    for (const id of orderRef.current) {
      if ((liveById.has(id) || stickyCards.has(id)) && !seen.has(id)) {
        newOrder.push(id);
        seen.add(id);
      }
    }
    for (const card of liveCards) {
      if (!seen.has(card._id)) {
        newOrder.push(card._id);
        seen.add(card._id);
      }
    }
    orderRef.current = newOrder;

    return newOrder.map((id) => {
      const sticky = stickyCards.get(id);
      const live = liveById.get(id);
      const card = live ?? sticky!.card;
      return {
        card,
        isMastered: sticky?.isMastered ?? card.isMastered,
        isHidden: sticky?.isHidden ?? card.isHidden,
      };
    });
  }, [liveCards, stickyCards]);

  const hasResults = displayCards.length > 0;
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
            {displayCards.map(({ card, isMastered, isHidden }) => (
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
                  isMastered={isMastered}
                  isHidden={isHidden}
                  isPendingMaster={false}
                  isPendingHide={false}
                  onMaster={() => handleMaster(card, isMastered)}
                  onHide={() => handleHide(card, isHidden)}
                  onFavorite={() => handleFavorite(card._id)}
                  onEdit={() =>
                    setEditingCard({
                      cardId: card._id,
                      translations: card.translations,
                    })
                  }
                  onDelete={() => setDeletingCardId(card._id)}
                  hideTargetLanguages={false}
                  highlightEnabled={highlightEnabled}
                  audioSpeedOverrides={ephemeralOverrides[card._id]}
                  onSpeedCycle={(language, next) =>
                    handleSpeedCycle(card._id, language, next)
                  }
                  speedBadgeVariant="ephemeral"
                />
              </div>
            ))}
          </>
        )}
      </div>

      {editingCard && (
        <EditCardDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditingCard(null);
          }}
          cardId={editingCard.cardId}
          translations={editingCard.translations}
        />
      )}

      <AlertDialog
        open={deletingCardId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingCardId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tLearn('actions.deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tLearn('actions.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {tLearn('actions.deleteConfirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={handleConfirmDelete}
            >
              {tLearn('actions.deleteConfirmConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
