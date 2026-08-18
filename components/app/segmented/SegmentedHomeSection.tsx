'use client';

import * as React from 'react';
import { Check, MessageSquare, PenLine } from 'lucide-react';
import { useMutation, usePreloadedQuery, useQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';
import { useScrollFocusedIntoView } from '@/hooks/use-scroll-focused-into-view';
import { useUpdateCourseSettings } from '@/hooks/use-update-course-settings';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { cn, convexErrorMessage } from '@/lib/utils';
import { CollectionDetailDialog } from '@/components/app/CollectionDetailDialog';
import {
  InlineCollectionDetail,
  type CollectionAction,
  type CollectionProgressItem,
} from '@/components/app/CollectionCarouselUI';
import { useCollectionDetail } from '@/components/app/useCollectionDetail';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { CEFR_COLORS, CEFR_ORDER, isCefr, type Cefr } from './cefr';

type HomeSummary = NonNullable<
  ReturnType<typeof useQuery<typeof api.features.home.getHomeSummary>>
>;
type Level = HomeSummary['levels'][number];
type CustomCollectionSummary = HomeSummary['customCollections'][number];

interface SegmentedHomeSectionProps {
  onNavigateToContent: () => void;
  onNavigateToChat: () => void;
}

export function SegmentedHomeSection({
  onNavigateToContent,
  onNavigateToChat,
}: SegmentedHomeSectionProps) {
  // Preloaded server-side in app/app/layout.tsx so the section renders with
  // real data on the first paint; usePreloadedQuery still subscribes to live
  // updates after hydration. Using the preloaded course settings (instead of
  // a fresh useQuery) avoids a flash where the "Off" pill on the excluded
  // source tab only appears after a brief delay.
  const { preloadedHomeSummary, preloadedCourseSettings } = useAppData();
  const summary = usePreloadedQuery(preloadedHomeSummary);
  const settings = usePreloadedQuery(preloadedCourseSettings);
  const updateSettings = useUpdateCourseSettings();
  const t = useTranslations('AppPage.collections.carousel');
  const [currentTab, setCurrentTab] = React.useState<'premade' | 'custom'>('premade');

  if (summary === undefined) {
    return <SegmentedSkeleton />;
  }
  if (summary === null) {
    return null;
  }

  // Filter-driven badges: only the *excluded* source gets an "Off" pill.
  // The badge is purely informational — the user is still free to browse
  // either tab regardless of filter.
  const filter = settings?.studyContentFilter ?? 'both';
  const courseOff = filter === 'custom'; // course tab is off when filter='custom'
  const customOff = filter === 'course'; // custom tab is off when filter='course'

  const reenable = async (target: 'premade' | 'custom') => {
    if (!settings) return;
    // Re-enabling either side means we no longer filter to only one source.
    await updateSettings({
      courseId: settings.courseId,
      studyContentFilter: 'both',
    });
    setCurrentTab(target);
  };

  return (
    <Tabs
      value={currentTab}
      onValueChange={(v) => setCurrentTab(v as 'premade' | 'custom')}
      className="flex flex-col gap-3"
    >
      {/* Header row: section title on the left, compact source switcher on
          the right — the switcher no longer spans the full card width. */}
      <div className="flex items-center justify-between gap-2 px-1">
        {/* min-w-0 + truncate: the title yields to the switcher when both
            don't fit (long locales like German on narrow phones). */}
        <h2 className="heading-section min-w-0 truncate">{t('sectionTitle')}</h2>
        <TabsList className="shrink-0">
          <TabsTrigger value="premade">
            {t('tabPremade')}
            {courseOff && (
              <OffBadge
                isCurrent={currentTab === 'premade'}
                onReenable={() => reenable('premade')}
                sourceLabel={t('tabPremade')}
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="custom">
            {t('tabCustom')}
            {customOff && (
              <OffBadge
                isCurrent={currentTab === 'custom'}
                onReenable={() => reenable('custom')}
                sourceLabel={t('tabCustom')}
              />
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="premade" className="flex flex-col gap-3">
        <PremadeTab summary={summary} />
      </TabsContent>

      <TabsContent value="custom" className="flex flex-col gap-3">
        <CustomTab
          customCollections={summary.customCollections}
          onNavigateToContent={onNavigateToContent}
          onNavigateToChat={onNavigateToChat}
        />
      </TabsContent>
    </Tabs>
  );
}

// ============================================================================
// Premade tab — CEFR-grouped rail + inline detail card (original preview)
// ============================================================================

function PremadeTab({ summary }: { summary: HomeSummary }) {
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
        ignoredCount: l.ignoredCount,
        prioritizedCount: l.prioritizedCount,
        browseAnchor: l.browseAnchor,
        totalTexts: l.totalTexts,
      })),
    [summary.levels],
  );

  const {
    openCollectionId,
    setOpenCollectionId,
    openedCollection,
    isOpenedComplete,
    browse,
    isAdding,
    handleAddCards,
    sentencesRemaining,
    usageLimitHit,
  } = useCollectionDetail({ collections: items });

  // An add-cards attempt ran into the sentences quota — surface the paywall
  // instead of failing silently. `handleAddCards` resets the flag on every
  // new attempt, so re-tries after dismissing re-open it.
  React.useEffect(() => {
    if (usageLimitHit) setPaywallOpen(true);
  }, [usageLimitHit]);

  const handleSelect = React.useCallback(
    async (collectionId: Id<'collections'>) => {
      if (collectionId === activeCollectionId) return;
      setOptimisticActiveId(collectionId);
      try {
        await setActiveCollection({ collectionId });
      } catch (error) {
        console.error('Error setting active collection:', error);
        toast.error(convexErrorMessage(error) ?? t('failedToSelect'));
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
        ignoredCount={openedCollection?.ignoredCount ?? 0}
        prioritizedCount={openedCollection?.prioritizedCount ?? 0}
        isActive={activeCollectionId === openCollectionId}
        isComplete={isOpenedComplete}
        browse={browse}
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
  const railRef = useScrollFocusedIntoView(focusedId);

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

/**
 * Shared chip shell used by both rails: progress-fill button with a label and
 * an active-dot / complete-check indicator. The variant bits (button shell
 * classes, label typography, incomplete fill color, whether the fill div is
 * `aria-hidden`) are explicit props so `LevelChip` and `CustomChip` render
 * exactly the DOM they always did.
 */
function ProgressChip({
  displayName,
  cardsAdded,
  totalTexts,
  isActive,
  isFocused,
  onClick,
  buttonClassName,
  labelClassName,
  incompleteFillColor,
  fillAriaHidden,
}: {
  displayName: string | undefined;
  cardsAdded: number;
  totalTexts: number;
  isActive: boolean;
  isFocused: boolean;
  onClick: () => void;
  /** Static class string for the button shell (width/padding variant). */
  buttonClassName: string;
  /** Static class string for the label (typography variant). */
  labelClassName: string;
  /** Progress-fill color while the collection is not yet complete. */
  incompleteFillColor: string;
  /** Whether the progress-fill div carries `aria-hidden`. */
  fillAriaHidden: boolean;
}) {
  const pct = totalTexts > 0 ? Math.min(1, cardsAdded / totalTexts) : 0;
  const isComplete = pct >= 1;
  return (
    <button
      type="button"
      data-focused={isFocused}
      onClick={onClick}
      className={cn(
        buttonClassName,
        isFocused
          ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary'
          : 'border-border bg-card hover:bg-muted',
      )}
      aria-pressed={isFocused}
      title={displayName}
    >
      <div
        className="absolute bottom-0 left-0 right-0 transition-all"
        style={{
          height: `${pct * 100}%`,
          backgroundColor: isComplete
            ? 'color-mix(in oklch, var(--success) 22%, transparent)'
            : incompleteFillColor,
        }}
        aria-hidden={fillAriaHidden ? true : undefined}
      />
      <span
        className={cn(
          labelClassName,
          isFocused ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {displayName}
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
  return (
    <ProgressChip
      displayName={level.displayName}
      cardsAdded={level.cardsAdded}
      totalTexts={level.totalTexts}
      isActive={isActive}
      isFocused={isFocused}
      onClick={onClick}
      buttonClassName="relative flex h-14 w-14 flex-col items-center justify-center overflow-hidden rounded-lg border transition-all"
      labelClassName="relative z-10 font-mono text-[10px] font-bold tabular-nums tracking-tight"
      incompleteFillColor={`color-mix(in oklch, ${themeColor} 22%, transparent)`}
      fillAriaHidden={false}
    />
  );
}

// ============================================================================
// Custom tab — 2-chip scrollable rail (Manually Added + Chat), no tiering.
// Same chip + inline-detail pattern as the premade tab.
// ============================================================================

function CustomTab({
  customCollections,
  onNavigateToContent,
  onNavigateToChat,
}: {
  customCollections: CustomCollectionSummary[];
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
    ignoredCount: c.ignoredCount,
    prioritizedCount: c.prioritizedCount,
    browseAnchor: c.browseAnchor,
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
    browse,
    isAdding,
    handleAddCards,
    usageLimitHit,
  } = useCollectionDetail({ collections: items });

  // Same silent-quota fix as the premade tab: adding from a custom/chat
  // collection consumes the sentences quota too, and previously a free user
  // at the limit got no feedback at all here.
  const [paywallOpen, setPaywallOpen] = React.useState(false);
  React.useEffect(() => {
    if (usageLimitHit) setPaywallOpen(true);
  }, [usageLimitHit]);

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
  // `collectionActions[focusedItem.collectionName]` lookup below.
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
        ignoredCount={openedCollection?.ignoredCount ?? 0}
        prioritizedCount={openedCollection?.prioritizedCount ?? 0}
        isActive={
          openCollectionId !== null && selectedIds.has(openCollectionId)
        }
        isComplete={isOpenedComplete}
        browse={browse}
        isAdding={isAdding}
        onSelect={() => {
          if (openCollectionId) handleToggleCollection(openCollectionId);
        }}
        onAddCards={() => handleAddCards()}
        showToggleWhenComplete
      />

      {paywallOpen && (
        <PaywallDialog open={paywallOpen} setOpen={setPaywallOpen} featureId={FEATURE_IDS.SENTENCES} />
      )}
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
  const railRef = useScrollFocusedIntoView(focusedId);

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
  return (
    <ProgressChip
      displayName={item.displayName}
      cardsAdded={item.cardsAdded}
      totalTexts={item.totalTexts}
      isActive={item.isActive}
      isFocused={isFocused}
      onClick={onClick}
      // Double the width of a level chip (28 vs 14 in tailwind units = 112px
      // vs 56px) so collection names like "Manually Added" fit comfortably.
      buttonClassName="relative flex h-14 w-28 flex-col items-center justify-center overflow-hidden rounded-lg border px-2 transition-all"
      labelClassName="relative z-10 truncate text-center text-[11px] font-semibold tabular-nums"
      incompleteFillColor="color-mix(in oklch, var(--primary) 18%, transparent)"
      fillAriaHidden
    />
  );
}

// ============================================================================
// Skeleton
// ============================================================================

/**
 * "Off" pill rendered inside a switcher tab whose source is currently
 * excluded by the content-source filter. Clicking behavior is gated by
 * whether the parent tab is selected:
 *
 *   - Tab NOT selected: pill click bubbles → Tabs swaps to this tab.
 *     We do nothing in the handler so the click bubbles naturally to
 *     TabsTrigger.
 *   - Tab IS selected: pill click opens a popover with a one-tap
 *     re-enable CTA. We stopPropagation so Tabs doesn't see the click.
 *
 * The popover is anchored (not triggered) by the badge — using
 * PopoverTrigger here would intercept every click and either fight with
 * the tab-switch (preventDefault skips Radix's TabsTrigger composeHandler)
 * or open the popover when the user just meant to switch tabs.
 */
function OffBadge({
  isCurrent,
  onReenable,
  sourceLabel,
}: {
  isCurrent: boolean;
  onReenable: () => void;
  sourceLabel: string;
}) {
  const t = useTranslations('AppPage.collections.carousel');
  const [open, setOpen] = React.useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (!isCurrent) {
      // Let the click bubble untouched so TabsTrigger switches tabs.
      return;
    }
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Badge
          variant="outline"
          // role+tabIndex make the badge keyboard-focusable so screen
          // readers can announce the reactivate affordance.
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!isCurrent) return;
              e.stopPropagation();
              setOpen(true);
            }
          }}
          className="h-4 cursor-pointer px-1.5 text-[10px] font-medium text-muted-foreground"
          data-testid="source-badge-off"
        >
          {t('sourceBadgeOff')}
        </Badge>
      </PopoverAnchor>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t('reenablePopover.title', { source: sourceLabel })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('reenablePopover.description')}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            {t('reenablePopover.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false);
              onReenable();
            }}
            data-testid="source-badge-reenable"
          >
            {t('reenablePopover.confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SegmentedSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {/* Mirrors the header row: title placeholder left, compact switcher right. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pt-2 pb-5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex shrink-0 flex-col gap-1.5">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="flex gap-1">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="h-14 w-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
