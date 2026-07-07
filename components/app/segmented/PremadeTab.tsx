'use client';

import * as React from 'react';
import { memo } from 'react';
import { Check } from 'lucide-react';
import { useMutation } from 'convex/react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CollectionDetailDialog } from '@/components/app/CollectionDetailDialog';
import {
  InlineCollectionDetail,
  type CollectionProgressItem,
} from '@/components/app/CollectionCarouselUI';
import { useCollectionDetail } from '@/components/app/useCollectionDetail';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { CEFR_COLORS, CEFR_ORDER, isCefr, type Cefr } from './cefr';
import type { HomeSummary, Level } from './homeTypes';

function PremadeTabInner({
  summary,
  activeCourseId,
}: {
  summary: HomeSummary;
  activeCourseId: Id<'courses'> | null;
}) {
  const t = useTranslations('AppPage.collections.carousel');
  const setActiveCollection = useMutation(api.features.decks.setActiveCollection);
  const [optimisticActiveId, setOptimisticActiveId] = React.useState<Id<'collections'> | null>(null);
  const [paywallOpen, setPaywallOpen] = React.useState(false);

  const activeCollectionId = optimisticActiveId ?? summary.activeCollectionId;

  // Focus = active collection if it's in this dataset; else the first level.
  const initialFocusId =
    summary.levels.find((l) => l.collectionId === activeCollectionId)?.collectionId ??
    summary.levels[0]?.collectionId ??
    null;
  const [focusedId, setFocusedId] = React.useState<Id<'collections'> | null>(initialFocusId);

  React.useEffect(() => {
    if (focusedId && summary.levels.some((l) => l.collectionId === focusedId)) return;
    setFocusedId(initialFocusId);
  }, [initialFocusId, summary.levels, focusedId]);

  const groups = React.useMemo(() => groupLevelsByCefr(summary.levels), [summary.levels]);

  // Items shape consumed by useCollectionDetail and InlineCollectionDetail.
  const items: CollectionProgressItem[] = React.useMemo(
    () =>
      summary.levels.map((l) => ({
        collectionId: l.collectionId,
        collectionName: l.displayName ?? l.code,
        cardsAdded: l.cardsAdded,
        totalTexts: l.totalTexts,
      })),
    [summary.levels],
  );

  const {
    openCollectionId,
    setOpenCollectionId,
    openedCollection,
    isOpenedComplete,
    contentData,
    isAdding,
    handleAddCards,
    sentencesRemaining,
  } = useCollectionDetail({ collections: items, activeCourseId });

  const handleSelect = React.useCallback(
    async (collectionId: Id<'collections'>) => {
      if (collectionId === activeCollectionId) return;
      setOptimisticActiveId(collectionId);
      try {
        await setActiveCollection({ collectionId });
      } catch (error) {
        console.error('Error setting active collection:', error);
        toast.error(error instanceof Error ? error.message : t('failedToSelect'));
      } finally {
        setOptimisticActiveId(null);
      }
    },
    [activeCollectionId, setActiveCollection, t],
  );

  if (summary.levels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">{t('noLevels')}</p>
    );
  }

  const focusedLevel = summary.levels.find((l) => l.collectionId === focusedId) ?? null;
  const focusedItem = focusedLevel
    ? items.find((c) => c.collectionId === focusedLevel.collectionId) ?? null
    : null;

  return (
    <div className="flex flex-col gap-3" data-tutorial="collection-carousel">
      <GroupedLevelRail
        groups={groups}
        activeCollectionId={activeCollectionId}
        focusedId={focusedId}
        onFocus={setFocusedId}
      />

      {focusedItem && (
        <InlineCollectionDetail
          collection={focusedItem}
          isActive={focusedItem.collectionId === activeCollectionId}
          onSelect={() => handleSelect(focusedItem.collectionId as Id<'collections'>)}
          onOpenDetail={() => setOpenCollectionId(focusedItem.collectionId)}
          onAddCards={() => handleAddCards(focusedItem.collectionId)}
          isAdding={isAdding}
          t={t}
          sentencesRemaining={sentencesRemaining}
          onUpgrade={() => setPaywallOpen(true)}
        />
      )}

      <CollectionDetailDialog
        open={openCollectionId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCollectionId(null);
        }}
        collectionName={openedCollection?.collectionName ?? null}
        totalTexts={openedCollection?.totalTexts ?? 0}
        cardsAdded={openedCollection?.cardsAdded ?? 0}
        isActive={activeCollectionId === openCollectionId}
        isComplete={isOpenedComplete}
        texts={contentData?.texts ?? []}
        isLoadingTexts={contentData === undefined && !isOpenedComplete}
        isAdding={isAdding}
        onSelect={() => {
          if (openCollectionId) handleSelect(openCollectionId as Id<'collections'>);
        }}
        onAddCards={() => handleAddCards()}
        sentencesRemaining={sentencesRemaining}
        onUpgrade={() => setPaywallOpen(true)}
      />

      {paywallOpen && (
        <PaywallDialog open={paywallOpen} setOpen={setPaywallOpen} featureId={FEATURE_IDS.SENTENCES} />
      )}
    </div>
  );
}

function groupLevelsByCefr(levels: Level[]): { cefr: Cefr; levels: Level[] }[] {
  const byCefr = new Map<Cefr, Level[]>();
  for (const cefr of CEFR_ORDER) byCefr.set(cefr, []);
  for (const lvl of levels) {
    const tier: Cefr = isCefr(lvl.cefrTier) ? lvl.cefrTier : 'A1';
    byCefr.get(tier)?.push(lvl);
  }
  return CEFR_ORDER.map((cefr) => ({
    cefr,
    levels: (byCefr.get(cefr) ?? []).sort((a, b) => a.order - b.order),
  })).filter((g) => g.levels.length > 0);
}

function GroupedLevelRail({
  groups,
  activeCollectionId,
  focusedId,
  onFocus,
}: {
  groups: { cefr: Cefr; levels: Level[] }[];
  activeCollectionId: Id<'collections'> | null;
  focusedId: Id<'collections'> | null;
  onFocus: (id: Id<'collections'>) => void;
}) {
  const railRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Horizontal-only "scroll into view if needed" — equivalent to
    // `scrollIntoView({ block: 'nearest', inline: 'nearest' })` but
    // operating only on the rail's scrollLeft, so the page is never
    // nudged vertically (the mobile OS-chrome jog bug). If the focused
    // chip is already fully visible we leave the rail where it is —
    // the previous "always center" behavior shifted the rail on every
    // selection, which surprised users who'd manually scrolled it.
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
      // pt-2 keeps the focused chip's outset ring from getting cropped at
      // the top (overflow-x-auto clips vertically too). pb-5 gives breathing
      // room between the chips and the horizontal scrollbar on platforms
      // where the scrollbar is rendered despite our hide hints (Safari, some
      // touch surfaces). -mx-3 + px-3 lets the rail bleed to the edges of the
      // wrapping collections card (which has p-3).
      className="-mx-3 flex gap-3 overflow-x-auto px-3 pt-2 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {groups.map((g) => {
        const total = g.levels.reduce((acc, l) => acc + l.totalTexts, 0);
        const added = g.levels.reduce((acc, l) => acc + l.cardsAdded, 0);
        // Match the per-chip progress fill (`cardsAdded / totalTexts`). Clamp
        // to 100% because cutover roll-forward credits can briefly push a
        // tier's added-count above its texts-count (legacy A1's 295 cards land
        // entirely on L02 even though L02 has only ~1k texts of its own — but
        // the user could still hold credit above 100% if they over-progressed
        // on legacy before cutover).
        const groupPct = total > 0 ? Math.min(1, added / total) : 0;
        const color = CEFR_COLORS[g.cefr];
        return (
          <div key={g.cefr} className="flex shrink-0 flex-col gap-1.5">
            <div className="flex items-center gap-1.5 px-0.5">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="font-mono text-[10px] font-bold tracking-widest text-foreground">
                {g.cefr}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {Math.round(groupPct * 100)}%
              </span>
            </div>
            <div className="flex gap-1">
              {g.levels.map((lvl) => (
                <LevelChip
                  key={lvl.collectionId}
                  level={lvl}
                  isActive={lvl.collectionId === activeCollectionId}
                  isFocused={lvl.collectionId === focusedId}
                  themeColor={color}
                  onClick={() => onFocus(lvl.collectionId)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LevelChip({
  level,
  isActive,
  isFocused,
  themeColor,
  onClick,
}: {
  level: Level;
  isActive: boolean;
  isFocused: boolean;
  themeColor: string;
  onClick: () => void;
}) {
  const pct = level.totalTexts > 0 ? Math.min(1, level.cardsAdded / level.totalTexts) : 0;
  const isComplete = pct >= 1;
  return (
    <button
      type="button"
      data-focused={isFocused}
      onClick={onClick}
      className={cn(
        'relative flex h-14 w-14 flex-col items-center justify-center overflow-hidden rounded-lg border transition-all',
        isFocused
          ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary'
          : 'border-border bg-card hover:bg-muted',
      )}
      aria-pressed={isFocused}
      title={level.displayName}
    >
      <div
        className="absolute bottom-0 left-0 right-0 transition-all"
        style={{
          height: `${pct * 100}%`,
          backgroundColor: isComplete
            ? 'color-mix(in oklch, var(--success) 22%, transparent)'
            : `color-mix(in oklch, ${themeColor} 22%, transparent)`,
        }}
      />
      <span
        className={cn(
          'relative z-10 font-mono text-[10px] font-bold tabular-nums tracking-tight',
          isFocused ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {level.displayName}
      </span>
      <div className="relative z-10 flex h-3 items-center">
        {isActive ? (
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
// Custom tab — 2-chip scrollable rail (Manually Added + Chat), no tiering.
// Same chip + inline-detail pattern as the premade tab.
// ============================================================================


/**
 * Memoized: the parent re-renders on every home-summary push; the tab only
 * re-renders when the summary or course actually changes.
 */
export const PremadeTab = memo(PremadeTabInner);
