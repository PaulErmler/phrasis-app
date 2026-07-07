'use client';

import * as React from 'react';
import { memo } from 'react';
import { Check, MessageSquare, PenLine } from 'lucide-react';
import { useMutation, usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  InlineCollectionDetail,
  type CollectionAction,
  type CollectionProgressItem,
} from '@/components/app/CollectionCarouselUI';
import { CollectionDetailDialog } from '@/components/app/CollectionDetailDialog';
import { useCollectionDetail } from '@/components/app/useCollectionDetail';
import type { CustomCollectionSummary } from './homeTypes';

function CustomTabInner({
  customCollections,
  activeCourseId,
  onNavigateToContent,
  onNavigateToChat,
}: {
  customCollections: CustomCollectionSummary[];
  activeCourseId: Id<'courses'> | null;
  onNavigateToContent: () => void;
  onNavigateToChat: () => void;
}) {
  const t = useTranslations('AppPage.collections');
  const tCarousel = useTranslations('AppPage.collections.carousel');
  const tApp = useTranslations('AppPage');
  const toggleMutation = useMutation(api.features.decks.toggleCustomCollection);

  // The custom tab uses the user's `activeCustomCollectionIds` for the
  // active-set indicator (Select toggles inclusion in the auto-add pool).
  // Use the preloaded query so the selected-set dot is correct on the first
  // paint instead of flickering on after hydration.
  const { preloadedCourseSettings } = useAppData();
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  // Stored as Set<string> so the branded `Id<'collections'>` values match the
  // `string`-typed `CollectionProgressItem.collectionId` on lookup. Convex Ids
  // are strings at runtime so iterating works directly.
  const selectedIds = React.useMemo<Set<string>>(
    () => new Set(courseSettings?.activeCustomCollectionIds ?? []),
    [courseSettings?.activeCustomCollectionIds],
  );

  // Localized display name: legacy "Custom" → "Manually Added", "Chat" stays
  // "Chat" but goes through i18n for German etc.
  const localizedName = React.useCallback(
    (c: CustomCollectionSummary): string => {
      if (
        (c.isCustom || c.isChat) &&
        tCarousel.has(`collectionDisplayNames.${c.name}`)
      ) {
        return tCarousel(`collectionDisplayNames.${c.name}`);
      }
      return c.name;
    },
    [tCarousel],
  );

  // `collectionName` stays as the raw key (e.g. "Custom", "Chat") so it can
  // index into `descriptions.*` and the per-collection action map. The
  // localized label (e.g. "Manually Added") lives on `displayName` and is used
  // for rendering titles only.
  const items: CollectionProgressItem[] = customCollections.map((c) => ({
    collectionId: c.collectionId,
    collectionName: c.name,
    displayName: localizedName(c),
    cardsAdded: c.cardsAdded,
    totalTexts: c.totalTexts,
  }));

  const [focusedId, setFocusedId] = React.useState<Id<'collections'> | null>(
    customCollections[0]?.collectionId ?? null,
  );
  React.useEffect(() => {
    if (focusedId && customCollections.some((c) => c.collectionId === focusedId)) return;
    setFocusedId(customCollections[0]?.collectionId ?? null);
  }, [customCollections, focusedId]);

  const {
    openCollectionId,
    setOpenCollectionId,
    openedCollection,
    isOpenedComplete,
    contentData,
    isAdding,
    handleAddCards,
  } = useCollectionDetail({ collections: items, activeCourseId });

  const handleToggleCollection = React.useCallback(
    async (collectionId: string) => {
      try {
        await toggleMutation({ collectionId: collectionId as Id<'collections'> });
      } catch {
        toast.error(t('carousel.failedToSelect'));
      }
    },
    [toggleMutation, t],
  );

  // Keyed by the raw `collectionName` (e.g. "Custom"/"Chat") to match the
  // lookup in CollectionCarouselUI (`collectionActions?.[collection.collectionName]`).
  const collectionActions = React.useMemo<Record<string, CollectionAction>>(() => {
    const actions: Record<string, CollectionAction> = {};
    for (const c of customCollections) {
      if (c.isCustom) {
        actions[c.name] = {
          label: tApp('customContent'),
          icon: <PenLine className="h-3.5 w-3.5" />,
          onClick: onNavigateToContent,
        };
      } else if (c.isChat) {
        actions[c.name] = {
          label: tApp('views.chat'),
          icon: <MessageSquare className="h-3.5 w-3.5" />,
          onClick: onNavigateToChat,
        };
      }
    }
    return actions;
  }, [customCollections, tApp, onNavigateToContent, onNavigateToChat]);

  // Empty state — keep the original 2-button card so users can navigate to
  // chat or the custom-content page to seed the collections.
  if (customCollections.length === 0) {
    const emptyStateDescription = t('customCarousel.emptyState', {
      content: tApp('views.content'),
      chat: tApp('views.chat'),
    });
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-4 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-stretch gap-4 md:gap-0">
          <div className="flex-[2] min-w-0 md:pr-6 flex items-center">
            <p className="text-muted-sm text-left">{emptyStateDescription}</p>
          </div>
          <div className="md:hidden h-px w-full shrink-0 bg-border" aria-hidden />
          <div
            className="hidden md:block w-px shrink-0 bg-border self-stretch min-h-[4.5rem]"
            aria-hidden
          />
          <div className="flex-1 min-w-0 md:pl-6 flex flex-col gap-2 justify-center">
            <Button type="button" variant="secondary" className="w-full" onClick={onNavigateToContent}>
              {t('customCarousel.customContentButton')}
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={onNavigateToChat}>
              {tApp('views.chat')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const focusedItem = focusedId
    ? items.find((c) => c.collectionId === focusedId) ?? null
    : null;
  const focusedCustom = focusedId
    ? customCollections.find((c) => c.collectionId === focusedId) ?? null
    : null;
  const focusedActionOverride = focusedItem
    ? collectionActions[focusedItem.collectionName]
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      <CustomChipRail
        items={customCollections.map((c) => ({
          collectionId: c.collectionId,
          displayName: localizedName(c),
          cardsAdded: c.cardsAdded,
          totalTexts: c.totalTexts,
          isActive: selectedIds.has(c.collectionId),
        }))}
        focusedId={focusedId}
        onFocus={setFocusedId}
      />

      {focusedItem && focusedCustom && (
        <InlineCollectionDetail
          collection={focusedItem}
          isActive={selectedIds.has(focusedItem.collectionId)}
          onSelect={() => handleToggleCollection(focusedItem.collectionId)}
          onOpenDetail={() => setOpenCollectionId(focusedItem.collectionId)}
          onAddCards={() => handleAddCards(focusedItem.collectionId)}
          isAdding={isAdding}
          t={tCarousel}
          showToggleWhenComplete
          actionOverride={focusedActionOverride}
        />
      )}

      <CollectionDetailDialog
        open={openCollectionId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCollectionId(null);
        }}
        collectionName={openedCollection?.collectionName ?? null}
        displayName={openedCollection?.displayName ?? null}
        totalTexts={openedCollection?.totalTexts ?? 0}
        cardsAdded={openedCollection?.cardsAdded ?? 0}
        isActive={
          openCollectionId !== null && selectedIds.has(openCollectionId)
        }
        isComplete={isOpenedComplete}
        texts={contentData?.texts ?? []}
        isLoadingTexts={contentData === undefined && !isOpenedComplete}
        isAdding={isAdding}
        onSelect={() => {
          if (openCollectionId) handleToggleCollection(openCollectionId);
        }}
        onAddCards={() => handleAddCards()}
        showToggleWhenComplete
      />
    </div>
  );
}

interface CustomChipItem {
  collectionId: Id<'collections'>;
  displayName: string;
  cardsAdded: number;
  totalTexts: number;
  isActive: boolean;
}

function CustomChipRail({
  items,
  focusedId,
  onFocus,
}: {
  items: CustomChipItem[];
  focusedId: Id<'collections'> | null;
  onFocus: (id: Id<'collections'>) => void;
}) {
  const railRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    // Horizontal-only "scroll into view if needed". See the matching
    // comment on `GroupedLevelRail` for the mobile OS-chrome rationale.
    const rail = railRef.current;
    const el = rail?.querySelector(
      `[data-focused="true"]`,
    ) as HTMLElement | null;
    if (!rail || !el) return;
    const railRect = rail.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.left < railRect.left) {
      rail.scrollTo({
        left: rail.scrollLeft + (elRect.left - railRect.left),
        behavior: 'smooth',
      });
    } else if (elRect.right > railRect.right) {
      rail.scrollTo({
        left: rail.scrollLeft + (elRect.right - railRect.right),
        behavior: 'smooth',
      });
    }
  }, [focusedId]);

  return (
    <div
      ref={railRef}
      // Same headroom math as GroupedLevelRail so the focused ring isn't
      // clipped by overflow-x-auto. -mx-3 + px-3 bleeds to the wrapping
      // collections-card edges (p-3 in HomeView).
      className="-mx-3 flex gap-3 overflow-x-auto px-3 pt-2 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex shrink-0 flex-col gap-1.5">
        {/* Invisible spacer — mirrors the band-header row in
            GroupedLevelRail so the Course and Custom Content tabs render at
            the same height and switching between them doesn't shift layout. */}
        <div
          className="invisible flex items-center gap-1.5 px-0.5"
          aria-hidden
        >
          <span className="size-2 rounded-full" />
          <span className="font-mono text-[10px] font-bold tracking-widest">
            A1
          </span>
          <span className="font-mono text-[10px] tabular-nums">0%</span>
        </div>
        <div className="flex gap-3">
          {items.map((c) => (
            <CustomChip
              key={c.collectionId}
              item={c}
              isFocused={c.collectionId === focusedId}
              onClick={() => onFocus(c.collectionId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CustomChip({
  item,
  isFocused,
  onClick,
}: {
  item: CustomChipItem;
  isFocused: boolean;
  onClick: () => void;
}) {
  const pct = item.totalTexts > 0 ? Math.min(1, item.cardsAdded / item.totalTexts) : 0;
  const isComplete = pct >= 1;
  return (
    <button
      type="button"
      data-focused={isFocused}
      onClick={onClick}
      // Double the width of a level chip (28 vs 14 in tailwind units = 112px
      // vs 56px) so collection names like "Manually Added" fit comfortably.
      className={cn(
        'relative flex h-14 w-28 flex-col items-center justify-center overflow-hidden rounded-lg border px-2 transition-all',
        isFocused
          ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary'
          : 'border-border bg-card hover:bg-muted',
      )}
      aria-pressed={isFocused}
      title={item.displayName}
    >
      <div
        className="absolute bottom-0 left-0 right-0 transition-all"
        style={{
          height: `${pct * 100}%`,
          backgroundColor: isComplete
            ? 'color-mix(in oklch, var(--success) 22%, transparent)'
            : 'color-mix(in oklch, var(--primary) 18%, transparent)',
        }}
        aria-hidden
      />
      <span
        className={cn(
          'relative z-10 truncate text-center text-[11px] font-semibold tabular-nums',
          isFocused ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {item.displayName}
      </span>
      <div className="relative z-10 flex h-3 items-center">
        {item.isActive ? (
          <span
            style={{
              display: 'block',
              width: '6px',
              height: '6px',
              borderRadius: '9999px',
              backgroundColor: 'var(--primary)',
              boxShadow:
                '0 0 0 1.5px color-mix(in oklch, var(--primary) 25%, transparent)',
            }}
            aria-hidden
          />
        ) : isComplete ? (
          <Check className="size-3 text-[color:var(--success)]" strokeWidth={3} />
        ) : null}
      </div>
    </button>
  );
}

// ============================================================================
// Skeleton
// ============================================================================

/**
 * Invisible duplicate of the OffBadge used purely as a layout spacer on
 * the left side of the trigger so that the centered text label doesn't
 * shift when the real badge appears on the right. `aria-hidden` keeps it
 * out of the accessibility tree, `invisible` keeps it out of the paint.
 * Class list mirrors the real badge so widths match exactly.
 */

/**
 * Memoized: the parent re-renders on every home-summary push; the tab only
 * re-renders when its slice of the summary or the callbacks change.
 */
export const CustomTab = memo(CustomTabInner);
