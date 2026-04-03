'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
  collectionName: string;
  cardsAdded: number;
  totalTexts: number;
}

/** Generate a human-readable CEFR description using i18n, with fallback. */
export function getCollectionDescription(
  name: string,
  t: (key: string) => string,
): string {
  return t(name);
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
                  {collection.collectionName}
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
        />
      )}
    </div>
  );
}

// ============================================================================
// INLINE DETAIL CARD (Split style)
// ============================================================================

function InlineCollectionDetail({
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
}) {
  const progress =
    collection.totalTexts > 0
      ? (collection.cardsAdded / collection.totalTexts) * 100
      : 0;
  const isComplete =
    collection.cardsAdded >= collection.totalTexts && collection.totalTexts > 0;
  const remaining = collection.totalTexts - collection.cardsAdded;
  const addCount =
    sentencesRemaining != null
      ? Math.min(5, sentencesRemaining)
      : 5;

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
            {collection.collectionName}
          </h3>
          <span className="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full tabular-nums">
            {Math.round(progress)}%
          </span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {getCollectionDescription(collection.collectionName, (key) =>
            t(`descriptions.${key}`),
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
          isComplete && !showToggleWhenComplete ? 'grid-cols-2' : 'grid-cols-3',
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
        {!isComplete && !hideAddCards && (
          sentencesRemaining === 0 ? (
            <Button
              size="sm"
              onClick={onUpgrade}
              className="text-xs"
            >
              <Lock className="h-3.5 w-3.5 mr-1" />
              Upgrade
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={isAdding}
              onClick={onAddCards}
              className="text-xs"
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
        )}
      </div>
    </div>
  );
}
