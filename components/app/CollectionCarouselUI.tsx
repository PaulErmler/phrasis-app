'use client';

import { ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Check,
  Eye,
  CheckCircle2,
  Layers,
  BookOpen,
  Plus,
  Loader2,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export interface CollectionProgressItem {
  collectionId: string;
  /**
   * Stable identifier used for description-i18n lookup (e.g. "Custom", "A1.1").
   * Always the raw collection name — never localized — so callers can rely on
   * it as a key into `descriptions.*` and other lookup maps.
   */
  collectionName: string;
  /**
   * Optional localized display title. Falls back to `collectionName` when
   * absent. Used for rendering only; never for lookups.
   */
  displayName?: string;
  cardsAdded: number;
  totalTexts: number;
}

export interface CollectionAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  isLoading?: boolean;
}

/** Generate a human-readable CEFR description using i18n.
 *
 * Each sublevel ("A1.1", "C2.4", ...) has its own translation entry, so the
 * primary path is an exact lookup. The display name has a dot ("A1.1") but
 * next-intl treats dots as namespace separators in keys — so we normalize
 * dots to underscores at lookup time ("A1.1" → "A1_1"). The sublevel-to-tier
 * fallback exists only as a defensive net — if a new dataset display name is
 * added without a matching i18n key, we fall back to the parent CEFR band's
 * description rather than throwing MISSING_MESSAGE in the UI.
 */
export function getCollectionDescription(
  name: string,
  t: (key: string) => string,
  has?: (key: string) => boolean,
): string {
  const key = name.replace(/\./g, '_');
  if (!has || has(key)) return t(key);
  const sublevel = /^([A-C][12])\.\d+$/.exec(name);
  if (sublevel && has(sublevel[1])) return t(sublevel[1]);
  return name;
}

interface CollectionCarouselUIProps {
  collections: CollectionProgressItem[];
  activeCollectionIds: string[];
  onSelectCollection: (collectionId: string) => void;
  onOpenCollection: (collectionId: string) => void;
  onAddCards: (collectionId: string) => void;
  isAdding?: boolean;
  isLoading?: boolean;
  /** Index to scroll to whenever it changes (e.g. active collection index after a course switch) */
  initialScrollIndex?: number;
  /** Called once the carousel is fully initialized and safe to display */
  onReady?: () => void;
  /** When true, show toggle button even when collection is complete (for custom collections) */
  showToggleWhenComplete?: boolean;
  /** Remaining sentences quota. null means unlimited. */
  sentencesRemaining?: number | null;
  /** Called when the user clicks upgrade (limit reached). */
  onUpgrade?: () => void;
  /** When true, hides the "Add N Cards" button */
  hideAddCards?: boolean;
  /** Per-collection action overrides (keyed by collection name). When a collection has an override,
   *  the override button replaces the "Add N Cards" button in the bottom-right slot. */
  collectionActions?: Record<string, CollectionAction>;
}

export function CollectionCarouselUI({
  collections,
  activeCollectionIds,
  onSelectCollection,
  onOpenCollection,
  onAddCards,
  isAdding = false,
  isLoading = false,
  onReady,
  showToggleWhenComplete = false,
  sentencesRemaining,
  onUpgrade,
  hideAddCards = false,
  collectionActions,
}: CollectionCarouselUIProps) {
  const [focusedId, setFocusedId] = useState<string | null>(
    activeCollectionIds[0] ?? collections[0]?.collectionId ?? null,
  );
  const t = useTranslations('AppPage.collections.carousel');

  // Keep focused in sync when active collections change (e.g. course switch)
  const firstActiveId = activeCollectionIds[0] ?? null;
  useEffect(() => {
    if (firstActiveId) setFocusedId(firstActiveId);
  }, [firstActiveId]);

  // Signal ready immediately since there's no carousel to initialize
  const isReady = !isLoading && collections.length > 0;
  useEffect(() => {
    if (isReady) onReady?.();
  }, [isReady, onReady]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-14 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (collections.length === 0) return null;

  const focusedCollection = focusedId
    ? collections.find((c) => c.collectionId === focusedId)
    : null;

  return (
    <div className="space-y-3">
      {/* Segmented control */}
      <div className="flex h-14 rounded-lg overflow-hidden bg-card border">
        {collections.map((collection, i) => {
          const progress =
            collection.totalTexts > 0
              ? (collection.cardsAdded / collection.totalTexts) * 100
              : 0;
          const isComplete =
            collection.cardsAdded >= collection.totalTexts &&
            collection.totalTexts > 0;
          const isActive = activeCollectionIds.includes(collection.collectionId);
          const isFocused = focusedId === collection.collectionId;

          return (
            <button
              key={collection.collectionId}
              onClick={() => setFocusedId(collection.collectionId)}
              className={cn(
                'flex-1 relative flex items-center justify-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10',
                i < collections.length - 1 && 'border-r border-border/50',
                isFocused && 'bg-primary/10 ring-2 ring-primary ring-inset z-10',
                isFocused && i === 0 && 'rounded-l-lg',
                isFocused && i === collections.length - 1 && 'rounded-r-lg',
                !isFocused && 'hover:bg-accent/50',
              )}
            >
              {/* Progress fill from bottom */}
              <div
                className={cn(
                  'absolute bottom-0 left-0 right-0 transition-all',
                  isComplete ? 'bg-green-500/20' : 'bg-primary/15',
                )}
                style={{ height: `${progress}%` }}
              />

              {/* Content — fixed layout so text stays at same height */}
              <div className="relative z-10 flex flex-col items-center gap-0.5">
                <span
                  className={cn(
                    'text-xs font-semibold leading-none',
                    isFocused && 'text-foreground',
                    !isFocused && 'text-muted-foreground',
                  )}
                >
                  {collection.displayName ?? collection.collectionName}
                </span>
                {/* Fixed-height indicator area */}
                <div className="h-3 flex items-center justify-center">
                  {isActive && (!isComplete || showToggleWhenComplete) && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                  {isComplete && !showToggleWhenComplete && (
                    <Check className="h-3 w-3 text-green-600" />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Inline detail card for focused collection */}
      {focusedCollection && (
        <InlineCollectionDetail
          collection={focusedCollection}
          isActive={activeCollectionIds.includes(focusedCollection.collectionId)}
          onSelect={() => onSelectCollection(focusedCollection.collectionId)}
          onOpenDetail={() => onOpenCollection(focusedCollection.collectionId)}
          onAddCards={() => onAddCards(focusedCollection.collectionId)}
          isAdding={isAdding}
          t={t}
          showToggleWhenComplete={showToggleWhenComplete}
          sentencesRemaining={sentencesRemaining}
          onUpgrade={onUpgrade}
          hideAddCards={hideAddCards}
          actionOverride={collectionActions?.[focusedCollection.collectionName]}
        />
      )}
    </div>
  );
}

// ============================================================================
// INLINE DETAIL CARD (Split style)
// ============================================================================

export function InlineCollectionDetail({
  collection,
  isActive,
  onSelect,
  onOpenDetail,
  onAddCards,
  isAdding = false,
  t,
  showToggleWhenComplete = false,
  sentencesRemaining,
  onUpgrade,
  hideAddCards = false,
  actionOverride,
}: {
  collection: CollectionProgressItem;
  isActive: boolean;
  onSelect: () => void;
  onOpenDetail: () => void;
  onAddCards: () => void;
  isAdding?: boolean;
  t: ReturnType<typeof useTranslations>;
  showToggleWhenComplete?: boolean;
  sentencesRemaining?: number | null;
  onUpgrade?: () => void;
  hideAddCards?: boolean;
  actionOverride?: CollectionAction;
}) {
  const progress =
    collection.totalTexts > 0
      ? (collection.cardsAdded / collection.totalTexts) * 100
      : 0;
  const isComplete =
    collection.cardsAdded >= collection.totalTexts && collection.totalTexts > 0;
  const remaining = collection.totalTexts - collection.cardsAdded;
  const addCount = Math.min(
    5,
    remaining,
    ...(sentencesRemaining != null ? [sentencesRemaining] : []),
  );

  return (
    <div className="rounded-xl border-2 bg-card overflow-hidden">
      {/* Progress accent bar */}
      <div className="h-1.5 bg-muted">
        <div
          className={cn(
            'h-full transition-all',
            isComplete ? 'bg-green-500' : 'bg-primary',
          )}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">
            {collection.displayName ?? collection.collectionName}
          </h3>
          <div className="flex items-center gap-1.5">
            {isActive ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-primary/15 text-primary ring-1 ring-primary/30 cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t('inline.active')}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {t('inline.activeTooltip')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {t('inline.inactive')}
              </span>
            )}
            <span className="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {getCollectionDescription(
            collection.collectionName,
            (key) => t(`descriptions.${key}`),
            (key) => t.has(`descriptions.${key}`),
          )}
        </p>

        {/* Stats row */}
        <div className="flex gap-3 text-xs">
          <div className="flex items-center gap-1">
            <Layers className="h-3 w-3 text-muted-foreground" />
            <span>
              {collection.cardsAdded} {t('inline.added')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <BookOpen className="h-3 w-3 text-muted-foreground" />
            <span>
              {remaining} {t('inline.remaining')}
            </span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div
        className={cn(
          'grid gap-2 px-3 pb-3',
          isComplete && !showToggleWhenComplete && !actionOverride
            ? 'grid-cols-2'
            : 'grid-cols-3',
        )}
      >
        {!isComplete || showToggleWhenComplete ? (
          <Button
            size="sm"
            variant={isActive ? 'secondary' : 'outline'}
            className="text-xs"
            onClick={onSelect}
          >
            {isActive && <Check className="h-3.5 w-3.5 mr-1" />}
            {isActive ? t('selected') : t('select')}
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('done')}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={onOpenDetail}
        >
          <Eye className="h-3.5 w-3.5 mr-1.5" />
          {t('inline.preview')}
        </Button>
        {actionOverride ? (
          <Button
            size="sm"
            disabled={actionOverride.isLoading}
            onClick={actionOverride.onClick}
            className="text-xs"
          >
            {actionOverride.isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <span className="mr-1 inline-flex">{actionOverride.icon}</span>
                {actionOverride.label}
              </>
            )}
          </Button>
        ) : (
          !isComplete && !hideAddCards && (
            sentencesRemaining === 0 ? (
              <Button
                size="sm"
                onClick={onUpgrade}
                className="text-xs"
              >
                <Lock className="h-3.5 w-3.5 mr-1" />
                {t('detail.upgrade')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isAdding}
                onClick={onAddCards}
                className="text-xs"
                data-testid="collection-add-cards"
              >
                {isAdding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t('detail.addN', { count: addCount })}
                  </>
                )}
              </Button>
            )
          )
        )}
      </div>
    </div>
  );
}
