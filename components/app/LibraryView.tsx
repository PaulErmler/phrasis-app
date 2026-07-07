'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, usePreloadedQuery } from 'convex/react';
import { useScrollMemory } from '@/hooks/use-scroll-memory';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useEnsureContent } from '@/hooks/use-ensure-content';
import { useDebounce } from '@/hooks/use-debounce';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Search, Star, EyeOff, CircleCheck, X, Loader2, PenLine, BookOpen } from 'lucide-react';
import { LearningCardContent } from '@/components/app/learning/LearningCardContent';
import { EditCardDialog } from '@/components/app/learning/EditCardDialog';
import { NoCourseEmptyState } from '@/components/app/NoCourseEmptyState';
import { useAppData } from '@/components/app/AppDataProvider';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { getUserTimezone } from '@/lib/timezone';
import type { PinnableCardAction } from '@/lib/cardActions';
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
type SourceFilter = 'custom' | 'premade' | null;

function parseActiveFilter(value: string | null | undefined): ActiveFilter {
  return value === 'mastered' || value === 'hidden' || value === 'favorites'
    ? value
    : null;
}

function parseSourceFilter(value: string | null | undefined): SourceFilter {
  return value === 'custom' || value === 'premade' ? value : null;
}

// Filters survive tab switches (which unmount this route) via sessionStorage
// and are deep-linkable via ?q=&filter=&source= search params.
const FILTERS_STORAGE_KEY = 'phrasis:library-filters';

type StoredFilters = { q: string; filter: ActiveFilter; source: SourceFilter };

function readStoredFilters(): StoredFilters | null {
  try {
    const stored = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<StoredFilters>;
    return {
      q: typeof parsed.q === 'string' ? parsed.q : '',
      filter: parseActiveFilter(parsed.filter),
      source: parseSourceFilter(parsed.source),
    };
  } catch {
    return null;
  }
}

type LibraryCard = FunctionReturnType<typeof api.features.library.getLibraryCards>[number];

type StickyEntry = {
  card: LibraryCard;
  isMastered: boolean;
  isHidden: boolean;
};

export function LibraryView({
  hasActiveCourse,
  onOpenCourseMenu,
}: {
  hasActiveCourse: boolean;
  onOpenCourseMenu: () => void;
}) {
  const t = useTranslations('AppPage.library');
  const tLearn = useTranslations('LearningMode');
  const scrollRef = useScrollMemory('library');

  const { preloadedCourseSettings, preloadedSettings } = useAppData();
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const userSettings = usePreloadedQuery(preloadedSettings);
  const highlightEnabled = courseSettings?.highlightWords === true;
  const pinnedCardActions = userSettings?.pinnedCardActions ?? [];

  const cardEditsQuota = useFeatureQuota(FEATURE_IDS.CARD_EDITS);
  const audioRegenerationsQuota = useFeatureQuota(
    FEATURE_IDS.AUDIO_REGENERATIONS,
  );
  const translationFlagsQuota = useFeatureQuota(FEATURE_IDS.TRANSLATION_FLAGS);
  const cardActionQuotas = useMemo(
    () => ({
      edit: {
        balance: cardEditsQuota.balance,
        unlimited: cardEditsQuota.unlimited,
      },
      regenerateAudio: {
        balance: audioRegenerationsQuota.balance,
        unlimited: audioRegenerationsQuota.unlimited,
      },
      flag: {
        balance: translationFlagsQuota.balance,
        unlimited: translationFlagsQuota.unlimited,
      },
    }),
    [
      cardEditsQuota.balance,
      cardEditsQuota.unlimited,
      audioRegenerationsQuota.balance,
      audioRegenerationsQuota.unlimited,
      translationFlagsQuota.balance,
      translationFlagsQuota.unlimited,
    ],
  );

  const searchParams = useSearchParams();
  // URL params seed the initial state (hydration-safe — the server sees the
  // same params on dynamic renders). Captured once; afterwards the state is
  // the source of truth and is mirrored back to the URL below.
  const [initial] = useState(() => ({
    q: searchParams.get('q') ?? '',
    filter: parseActiveFilter(searchParams.get('filter')),
    source: parseSourceFilter(searchParams.get('source')),
    fromUrl:
      searchParams.get('q') !== null ||
      searchParams.get('filter') !== null ||
      searchParams.get('source') !== null,
  }));
  const [searchInput, setSearchInput] = useState(initial.q);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(initial.filter);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initial.source);

  // Without URL params, restore the session's last filters (post-mount:
  // sessionStorage is client-only, reading it during render would break
  // hydration).
  useEffect(() => {
    if (initial.fromUrl) return;
    const stored = readStoredFilters();
    if (!stored) return;
    setSearchInput(stored.q);
    setActiveFilter(stored.filter);
    setSourceFilter(stored.source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debouncedSearch = useDebounce(searchInput, 300);

  // Mirror filters to the URL (deep-linkable, no server round-trip, no
  // history entries — Next syncs useSearchParams with replaceState) and to
  // sessionStorage for the next mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const apply = (key: string, value: string | null) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    apply('q', debouncedSearch || null);
    apply('filter', activeFilter);
    apply('source', sourceFilter);
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
    try {
      sessionStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({
          q: debouncedSearch,
          filter: activeFilter,
          source: sourceFilter,
        } satisfies StoredFilters),
      );
    } catch {
      // Storage unavailable — filters just don't survive the next remount.
    }
  }, [debouncedSearch, activeFilter, sourceFilter]);

  const result = useQuery(api.features.library.getLibraryCards, {
    searchQuery: debouncedSearch || undefined,
    activeFilter: activeFilter ?? undefined,
    sourceFilter: sourceFilter ?? undefined,
  });

  const masterCard = useMutation(api.features.scheduling.masterCard);
  const unmasterCard = useMutation(api.features.scheduling.unmasterCard);
  const hideCard = useMutation(api.features.scheduling.hideCard);
  const unhideCard = useMutation(api.features.scheduling.unhideCard);
  const toggleFavorite = useMutation(
    api.features.scheduling.toggleFavoriteCard,
  ).withOptimisticUpdate((localStore, args) => {
    // Flip isFavorite locally on every active getLibraryCards query instance
    // (search + filter variants) so the star indicator updates without a
    // server round-trip.
    for (const q of localStore.getAllQueries(
      api.features.library.getLibraryCards,
    )) {
      if (!q.value) continue;
      localStore.setQuery(
        api.features.library.getLibraryCards,
        q.args,
        q.value.map((card) =>
          card._id === args.cardId
            ? { ...card, isFavorite: !(card.isFavorite ?? false) }
            : card,
        ),
      );
    }
  });
  const deleteCard = useMutation(api.features.scheduling.deleteCardPermanently);
  const regenerateCardAudio = useMutation(
    api.features.scheduling.regenerateCardAudio,
  );
  const flagTranslation = useMutation(api.features.scheduling.flagTranslation);
  const updatePinnedCardActionsMutation = useMutation(
    api.features.courses.updatePinnedCardActions,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getUserSettings,
      {},
    );
    if (current != null) {
      localStore.setQuery(
        api.features.courses.getUserSettings,
        {},
        { ...current, pinnedCardActions: [...args.actions] },
      );
    }
  });

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
  const [orderIds, setOrderIds] = useState<Id<'cards'>[]>([]);

  useEffect(() => {
    setStickyCards(new Map());
    setOrderIds([]);
  }, [activeFilter, sourceFilter, debouncedSearch]);

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

  const handleUpdatePinnedActions = useCallback(
    async (actions: readonly string[]) => {
      try {
        await updatePinnedCardActionsMutation({ actions: [...actions] });
      } catch (error) {
        console.error('Failed to update pinned card actions:', error);
      }
    },
    [updatePinnedCardActionsMutation],
  );

  const handleRegenerateAudio = useCallback(
    async (cardId: Id<'cards'>) => {
      try {
        await regenerateCardAudio({ cardId, timezone: getUserTimezone() });
      } catch (error) {
        console.error('Failed to regenerate audio:', error);
      }
    },
    [regenerateCardAudio],
  );

  // Flag opens a confirm dialog identical to LearningMode's: on confirm we
  // fire the retranslation in the background for every non-source-language
  // translation on the card at once. The card stays in the library — the
  // new translations land in-place when the worker finishes.
  const [flagConfirmCardId, setFlagConfirmCardId] = useState<Id<'cards'> | null>(null);
  // Client-only session record of cards the viewer has flagged. Drives the
  // "Flagged" pill on each card row — purely local, never persisted, so it
  // doesn't leak to other users that someone flagged a row.
  const [flaggedCardIds, setFlaggedCardIds] = useState<Set<Id<'cards'>>>(
    () => new Set(),
  );
  const handleConfirmFlag = useCallback(async () => {
    const cardId = flagConfirmCardId;
    if (!cardId) return;
    setFlagConfirmCardId(null);
    // Only mark the card as session-flagged when the mutation reports no
    // retranslation was triggered (all non-source languages over-cap or
    // claim-contested). With a retranslation in flight, the server-driven
    // "Retranslating" pill is the right signal — and once it lands, no
    // pill (the flag has been acted on, nothing lingering).
    flagTranslation({ cardId })
      .then((result) => {
        if (result && result.retranslated === false) {
          setFlaggedCardIds((prev) => {
            if (prev.has(cardId)) return prev;
            const next = new Set(prev);
            next.add(cardId);
            return next;
          });
        }
      })
      .catch((error) =>
        console.error('Failed to flag translation:', error),
      );
  }, [flagConfirmCardId, flagTranslation]);

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
    setOrderIds((prev) => prev.filter((id) => id !== cardId));
    try {
      await deleteCard({ cardId });
    } catch (error) {
      console.error('Failed to delete card:', error);
    }
  }, [deletingCardId, deleteCard]);

  const toggleFilter = (f: Exclude<ActiveFilter, null>) => {
    setActiveFilter((prev) => (prev === f ? null : f));
  };

  const toggleSource = (s: Exclude<SourceFilter, null>) => {
    setSourceFilter((prev) => (prev === s ? null : s));
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
    for (const id of orderIds) {
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
  }, [liveCards, stickyCards, orderIds]);

  // Persist the displayed order so the next render can seed from it without
  // mutating a ref during render. No-op when the computed order matches what
  // we already stored, so this doesn't spiral into a re-render loop.
  useEffect(() => {
    const next = displayCards.map(({ card }) => card._id);
    setOrderIds((prev) => {
      if (
        prev.length === next.length &&
        prev.every((id, i) => id === next[i])
      ) {
        return prev;
      }
      return next;
    });
  }, [displayCards]);

  const hasResults = displayCards.length > 0;
  const hasActiveFilters =
    debouncedSearch.length > 0 || activeFilter !== null || sourceFilter !== null;

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
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-20" style={{ scrollbarGutter: 'stable' }}>
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

            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground shrink-0">
                {t('sourceLabel')}
              </span>
              <div className="flex flex-wrap gap-2 justify-end">
                <Toggle
                  pressed={sourceFilter === 'custom'}
                  onPressedChange={() => toggleSource('custom')}
                  variant="outline"
                  size="sm"
                  aria-label={t('filterCustom')}
                  data-testid="library-source-custom"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  {t('filterCustom')}
                </Toggle>
                <Toggle
                  pressed={sourceFilter === 'premade'}
                  onPressedChange={() => toggleSource('premade')}
                  variant="outline"
                  size="sm"
                  aria-label={t('filterPremade')}
                  data-testid="library-source-premade"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {t('filterPremade')}
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
                  onRegenerateAudio={() => handleRegenerateAudio(card._id)}
                  onFlag={(() => {
                    // Hide the flag affordance only when the card has no
                    // target translation to display; the mutation itself
                    // flags every non-source-language translation, so we
                    // don't pick a specific language here.
                    const hasTarget = card.translations.some(
                      (tr) => tr.isTargetLanguage,
                    );
                    if (!hasTarget) return undefined;
                    return () => setFlagConfirmCardId(card._id);
                  })()}
                  pinnedActions={pinnedCardActions}
                  onUpdatePinnedActions={
                    handleUpdatePinnedActions as (
                      actions: PinnableCardAction[],
                    ) => void
                  }
                  quotaState={cardActionQuotas}
                  hideTargetLanguages={false}
                  highlightEnabled={highlightEnabled}
                  flaggedInSession={flaggedCardIds.has(card._id)}
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

      <AlertDialog
        open={flagConfirmCardId !== null}
        onOpenChange={(open) => {
          if (!open) setFlagConfirmCardId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tLearn('actions.flagConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tLearn('actions.flagConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {tLearn('actions.flagConfirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmFlag}>
              {tLearn('actions.flagConfirmConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
