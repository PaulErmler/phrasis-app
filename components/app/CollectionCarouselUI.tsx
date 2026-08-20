'use client';

import { ReactNode } from 'react';
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
import { collectionRemaining, settledCount } from '@/convex/lib/collections';

export interface CollectionProgressItem {
  collectionId: string;
  /**
   * Stable identifier used for description-i18n lookup (e.g. "Custom", "A1.1").
   * Always the raw collection name, never localized, so callers can rely on
   * it as a key into `descriptions.*` and other lookup maps.
   */
  collectionName: string;
  /**
   * Optional localized display title. Falls back to `collectionName` when
   * absent. Used for rendering only; never for lookups.
   */
  displayName?: string;
  cardsAdded: number;
  /**
   * Texts the user marked as ignored in the collection preview. Excluded
   * from auto-add, so `remaining = totalTexts - cardsAdded - ignoredCount`
   * and completion counts them as settled.
   */
  ignoredCount: number;
  prioritizedCount: number;
  /**
   * Sequential-add frontier (`collectionProgress.lastRankProcessed`) at query
   * time. The preview dialog snapshots it once when it opens and anchors its
   * paginated browse range to it for the whole session.
   */
  browseAnchor: number;
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
 * next-intl treats dots as namespace separators in keys, so we normalize
 * dots to underscores at lookup time ("A1.1" → "A1_1"). The sublevel-to-tier
 * fallback exists only as a defensive net, if a new dataset display name is
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
  actionOverride?: CollectionAction;
}) {
  const progress =
    collection.totalTexts > 0
      ? (collection.cardsAdded / collection.totalTexts) * 100
      : 0;
  // Complete = every text either added or deliberately ignored.
  const isComplete =
    settledCount(collection) >= collection.totalTexts &&
    collection.totalTexts > 0;
  const remaining = collectionRemaining(collection.totalTexts, collection);
  const addCount = Math.min(
    5,
    remaining,
    ...(sentencesRemaining != null ? [sentencesRemaining] : []),
  );

  return (
    <div
      className="rounded-xl border-2 bg-card overflow-hidden"
      // Raw (unlocalized) collection name so e2e specs can target a specific
      // tile, e.g. `collection-tile-Custom`. Regardless of display locale.
      data-testid={`collection-tile-${collection.collectionName}`}
    >
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
          !isComplete && (
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
