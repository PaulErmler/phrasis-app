'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowUpCircle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Lock,
  Plus,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTextDirection } from '@/lib/languages';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import { getCollectionDescription } from './CollectionCarouselUI';
import { AudioButton } from '@/components/app/learning/AudioButton';
import {
  PREVIEW_ACTION_ICON_CLASS,
  PREVIEW_ACTION_PANEL_CLASS,
} from '@/components/app/previewIconRail';
import { HighlightedText } from '@/components/app/learning/HighlightedText';
import { useTranslations } from 'next-intl';
import { usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';
import { AnnotationLines } from '@/components/app/learning/AnnotationLines';
import { useButtonPlayback } from '@/hooks/use-button-playback';
import { resolveShowFurigana } from '@/lib/furigana';
import {
  COLLECTION_PREVIEW_SIZE,
  collectionRemaining,
} from '@/convex/lib/collections';
import type {
  BrowseTextRow,
  CollectionBrowse,
} from './useCollectionDetail';

interface CollectionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Raw collection name. Used as the description-lookup key. */
  collectionName: string | null;
  /** Localized title to render. Defaults to `collectionName` when omitted. */
  displayName?: string | null;
  totalTexts: number;
  cardsAdded: number;
  /** Texts the user ignored. Excluded from remaining/auto-add. */
  ignoredCount: number;
  /** Texts the user marked as prioritized in the collection preview. */
  prioritizedCount: number;
  isActive: boolean;
  isComplete: boolean;
  /** Paginated browse state + row actions from useCollectionDetail. */
  browse: CollectionBrowse;
  isAdding: boolean;
  onSelect: () => void;
  onAddCards: () => void;
  /** When true, hides the "Add N Cards" button and next sentences header */
  hideAddCards?: boolean;
  /** Remaining sentences quota. null means unlimited. */
  sentencesRemaining?: number | null;
  /** Called when the user clicks the upgrade button (limit reached). */
  onUpgrade?: () => void;
  /** When true, show toggle button even when collection is complete (for custom collections) */
  showToggleWhenComplete?: boolean;
}

// Bounds the STORED fallback ids when a long run of rows is toggleable
// (e.g. the "Manually Added" collection, where hiding added rows empties the
// list anyway), one "Show more" page plus slack. The capture keeps scanning
// past the cap until it finds a survivor row, so the cap never costs the
// guarantee, only how many hidden-run ids we remember.
const MAX_ANCHOR_CANDIDATES = 30;

export function CollectionDetailDialog({
  open,
  onOpenChange,
  collectionName,
  displayName,
  totalTexts,
  cardsAdded,
  ignoredCount,
  prioritizedCount,
  isActive,
  isComplete,
  browse,
  isAdding,
  onSelect,
  onAddCards,
  hideAddCards = false,
  sentencesRemaining,
  onUpgrade,
  showToggleWhenComplete = false,
}: CollectionDetailDialogProps) {
  const t = useTranslations('AppPage.collections.carousel.detail');
  const tDesc = useTranslations('AppPage.collections.carousel.descriptions');

  const { preloadedCourseSettings } = useAppData();
  const courseSettings = usePreloadedQuery(preloadedCourseSettings);
  const highlightEnabled = courseSettings?.highlightWords === true;
  const showIpa = courseSettings?.showIpa === true;
  const showFurigana = resolveShowFurigana(courseSettings);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll preservation: remember which row sits at the top of the viewport
  // (and where), then after every commit scroll by however far that row
  // moved. Unlike compensating only for the earlier-history block, this
  // keeps the visible cards pinned no matter what appears or collapses above
  // them. The added-history feed, its "show earlier" button, or previously
  // hidden added/ignored rows revealed mid-stream by the toggles.
  //
  // The anchor row itself can unmount (a visibility toggle hiding the very
  // rows the user is looking at), so the capture keeps the CONSECUTIVE rows
  // below it as fallback ids, continuing until it has one row that no toggle
  // can hide (status other than added/ignored), so even a long run of
  // contiguous added rows can't leave the list without a survivor. Only the
  // first row's offset is stored: the restore pins whichever row survives to
  // the removed block's start, so per-fallback offsets are never needed.
  const scrollAnchorRef = useRef<{ ids: string[]; top: number } | null>(null);

  const rowTopInContainer = (row: HTMLElement, containerTop: number) =>
    row.getBoundingClientRect().top - containerTop;

  const captureScrollAnchor = useCallback(() => {
    const container = scrollRef.current;
    let anchor: { ids: string[]; top: number } | null = null;
    if (container) {
      const containerTop = container.getBoundingClientRect().top;
      for (const row of container.querySelectorAll<HTMLElement>('[data-row-id]')) {
        if (anchor === null) {
          // Skip rows fully above the viewport; the first row whose bottom
          // edge is inside it becomes the anchor, and the only row that
          // needs measuring.
          const top = rowTopInContainer(row, containerTop);
          if (top + row.offsetHeight <= 0) continue;
          anchor = { ids: [row.dataset.rowId!], top };
        } else if (anchor.ids.length < MAX_ANCHOR_CANDIDATES) {
          anchor.ids.push(row.dataset.rowId!);
        }
        // A row the toggles can't hide is a guaranteed survivor. The
        // fallback chain is complete (in the common case the very first
        // row qualifies, so the capture stays a single measurement). Rows
        // past the id cap aren't stored but are still scanned so the chain
        // always ends in a survivor.
        const status = row.dataset.rowStatus;
        if (status !== 'added' && status !== 'ignored') {
          if (anchor.ids[anchor.ids.length - 1] !== row.dataset.rowId!) {
            anchor.ids.push(row.dataset.rowId!);
          }
          break;
        }
      }
    }
    scrollAnchorRef.current = anchor;
  }, []);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const anchor = scrollAnchorRef.current;
    if (container && anchor) {
      // First captured row still mounted → keep it pinned where it was.
      // Otherwise mirror native scroll anchoring's removal semantics (the
      // container opts out of the native version via overflow-anchor:none,
      // and Safari doesn't ship it): the surviving fallback is pinned to
      // the REMOVED block's start (`anchor.top`), so the rows below a
      // hidden run slide up into its place. Pinning the survivor to its
      // own old offset instead would drag rows the user had already
      // scrolled past back into view above it. Both cases are the same
      // formula because the captured rows are consecutive.
      const containerTop = container.getBoundingClientRect().top;
      for (const id of anchor.ids) {
        const row = container.querySelector<HTMLElement>(
          `[data-row-id="${id}"]`,
        );
        if (!row) continue;
        const delta = rowTopInContainer(row, containerTop) - anchor.top;
        if (delta !== 0) container.scrollTop += delta;
        break;
      }
    }
    captureScrollAnchor();
  });

  // Paging is deliberately button-only, nothing loads from scrolling alone.
  // "Show earlier" (top) and "Show more" (bottom) are the sole fetch triggers.
  const canLoadEarlier = browse.showAdded && browse.earlierStatus === 'CanLoadMore';

  if (!collectionName) return null;

  const titleText = displayName ?? collectionName;
  const progress = totalTexts > 0 ? (cardsAdded / totalTexts) * 100 : 0;
  const remaining = collectionRemaining(totalTexts, { cardsAdded, ignoredCount });
  const isCompleteProgress = isComplete && totalTexts > 0;
  // Description is keyed by the raw collection name; the localized display
  // title (e.g. "Manually Added") is for rendering only.
  const description = getCollectionDescription(
    collectionName,
    (key) => tDesc(key),
    (key) => tDesc.has(key),
  );

  const isInitialLoading = browse.status === 'LoadingFirstPage';
  const isLoadingMore = browse.status === 'LoadingMore' || browse.isPreparingMore;
  const isLoadingEarlier = browse.earlierStatus === 'LoadingMore';

  const visibleRows = browse.rows.filter(browse.isRowVisible);
  const visibleEarlierRows = browse.earlierRows.filter(browse.isRowVisible);
  const mainExhausted = browse.status === 'Exhausted';
  const showEmptyState =
    !isInitialLoading &&
    mainExhausted &&
    visibleRows.length === 0 &&
    visibleEarlierRows.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden" data-tutorial={TUTORIAL_ANCHORS.collectionDetail}>
        {/* Progress accent bar */}
        <div className="h-1.5 bg-muted rounded-t-lg overflow-hidden">
          <div
            className={cn(
              'h-full transition-all',
              isCompleteProgress ? 'bg-green-500' : 'bg-primary',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Static header section */}
        <div className="flex-shrink-0 p-6 pb-4 space-y-4">
          <DialogHeader className="text-left">
            <div className="flex items-center justify-between">
              <DialogTitle className="heading-dialog">{titleText}</DialogTitle>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {cardsAdded} / {totalTexts} {t('sentences')}
              </span>
            </div>
            <DialogDescription className="text-sm leading-relaxed text-left">
              {description}
            </DialogDescription>
          </DialogHeader>

          {/* Stats row */}
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1">
              <Layers className="h-3 w-3 text-muted-foreground" />
              <span>{cardsAdded} {t('added')}</span>
            </div>
            <div className="flex items-center gap-1">
              <ArrowUpCircle className="h-3 w-3 text-muted-foreground" />
              <span>{prioritizedCount} {t('prioritizedCount')}</span>
            </div>
            {ignoredCount > 0 && (
              <div className="flex items-center gap-1">
                <EyeOff className="h-3 w-3 text-muted-foreground" />
                <span>{ignoredCount} {t('ignoredCount')}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <BookOpen className="h-3 w-3 text-muted-foreground" />
              <span>{remaining} {t('remaining')}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            {(!isComplete || showToggleWhenComplete) ? (
              <Button
                variant={isActive ? 'secondary' : 'outline'}
                className="justify-center"
                onClick={onSelect}
              >
                {isActive && <Check className="h-4 w-4" />}
                {isActive ? t('selected') : t('select')}
              </Button>
            ) : (
              <div className="flex items-center justify-center gap-1.5 text-sm text-success font-medium">
                <CheckCircle2 className="h-5 w-5" />
                {t('done')}
              </div>
            )}
            {!isComplete && !hideAddCards && (
              sentencesRemaining === 0 ? (
                <Button
                  onClick={onUpgrade}
                  className="justify-center gap-1.5"
                >
                  <Lock className="h-4 w-4" />
                  Upgrade
                </Button>
              ) : (
                <Button
                  disabled={isAdding}
                  onClick={onAddCards}
                  className="justify-center min-w-[7.5rem] transition-colors"
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('adding')}
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      {t('addN', {
                        count: Math.min(
                          COLLECTION_PREVIEW_SIZE,
                          remaining,
                          ...(sentencesRemaining != null ? [sentencesRemaining] : []),
                        ),
                      })}
                    </>
                  )}
                </Button>
              )
            )}
          </div>

          {/* Browse controls */}
          <div className="flex items-center justify-end gap-1.5">
            <Toggle
              variant="outline"
              size="sm"
              pressed={browse.showAdded}
              onPressedChange={browse.setShowAdded}
              className="h-7 gap-1.5 px-2 text-xs"
              data-testid="collection-show-added-toggle"
            >
              <Eye className="h-3.5 w-3.5" />
              {t('showAdded')}
            </Toggle>
            <Toggle
              variant="outline"
              size="sm"
              pressed={browse.showIgnored}
              onPressedChange={browse.setShowIgnored}
              className="h-7 gap-1.5 px-2 text-xs"
              data-testid="collection-show-ignored-toggle"
            >
              <EyeOff className="h-3.5 w-3.5" />
              {t('showIgnored')}
            </Toggle>
          </div>
        </div>

        {/* Scrollable sentences section. Native scroll anchoring is disabled
            so it can't stack on top of the manual anchor compensation. */}
        <div
          ref={scrollRef}
          onScroll={captureScrollAnchor}
          className="flex-1 overflow-y-auto px-6 pb-6 [overflow-anchor:none]"
        >
          {isInitialLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="content-box flex overflow-hidden p-0">
                  <div className="flex flex-1 items-center p-3 min-w-0">
                    <div className="w-full space-y-2">
                      <Skeleton className="h-5 w-3/4 rounded" />
                      <Separator />
                      <Skeleton className="h-5 w-2/3 rounded" />
                    </div>
                  </div>
                  <div className={PREVIEW_ACTION_PANEL_CLASS}>
                    <Skeleton className="size-7 rounded-md" />
                    <Skeleton className="size-7 rounded-md" />
                    <Skeleton className="size-7 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Added-history feed (ranks at/below the anchor). Growth above
                  the viewport is absorbed by the scroll-anchor compensation,
                  so the user's position never jumps. */}
              {browse.showAdded && (
                <div className="space-y-4 pb-4">
                  {(canLoadEarlier || isLoadingEarlier) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground"
                      disabled={isLoadingEarlier}
                      onClick={browse.loadEarlier}
                      data-testid="collection-load-earlier"
                    >
                      {isLoadingEarlier ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {t('loadingMore')}
                        </>
                      ) : (
                        t('loadEarlier')
                      )}
                    </Button>
                  )}
                  {visibleEarlierRows.map((row) => (
                    <PreviewTextRow
                      showIpa={showIpa}
                      showFurigana={showFurigana}
                      key={row._id}
                      row={row}
                      highlightEnabled={highlightEnabled}
                      browse={browse}
                      sentencesRemaining={sentencesRemaining}
                    />
                  ))}
                </div>
              )}

              {showEmptyState ? (
                <div className="text-center py-6 space-y-2">
                  <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
                  <p className="text-sm font-medium">
                    {isComplete ? t('allCardsAdded') : t('noMoreCards')}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleRows.map((row) => (
                    <PreviewTextRow
                      showIpa={showIpa}
                      showFurigana={showFurigana}
                      key={row._id}
                      row={row}
                      highlightEnabled={highlightEnabled}
                      browse={browse}
                      sentencesRemaining={sentencesRemaining}
                    />
                  ))}
                  {(browse.status === 'CanLoadMore' || isLoadingMore) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground"
                      disabled={isLoadingMore}
                      onClick={browse.loadMore}
                      data-testid="collection-load-more"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {t('loadingMore')}
                        </>
                      ) : (
                        t('loadMore')
                      )}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Each preview row owns its own button-playback state so per-language
// highlighting stays scoped to the row whose AudioButton was clicked. A
// single shared hook at the dialog level would highlight every row that
// happens to share the active language.
function PreviewTextRow({
  row,
  highlightEnabled,
  showIpa,
  showFurigana,
  browse,
  sentencesRemaining,
}: {
  row: BrowseTextRow;
  highlightEnabled: boolean;
  showIpa: boolean;
  showFurigana: boolean;
  browse: CollectionBrowse;
  sentencesRemaining?: number | null;
}) {
  const t = useTranslations('AppPage.collections.carousel.detail');
  const buttonPlayback = useButtonPlayback();
  const baseTranslations = row.translations.filter((tr) => tr.isBaseLanguage);
  const targetTranslations = row.translations.filter(
    (tr) => tr.isTargetLanguage,
  );

  const isAdded = row.status === 'added';
  const isPrioritized = row.status === 'prioritized';
  const isIgnored = row.status === 'ignored';
  const isAddPending = browse.pendingAddTextIds.has(row._id);
  const addLocked = sentencesRemaining === 0;

  const renderLine = (translation: BrowseTextRow['translations'][number], isBase: boolean) => {
    const audio = row.audioRecordings.find(
      (a) => a.language === translation.language,
    );
    const isActiveLine =
      buttonPlayback.active?.language === translation.language;
    // Audio can only be generated once there is text to synthesize, for a
    // still-translating line the button stays in the passive spinner state.
    const hasText = translation.text.length > 0;
    return (
      <div key={translation.language} className="flex items-start gap-2">
        <div className="flex-1">
          <HighlightedText
            text={translation.text || '...'}
            language={translation.language}
            wordTimings={audio?.wordTimings ?? null}
            localTime={buttonPlayback.active?.localTime ?? 0}
            isActive={isActiveLine}
            enabled={highlightEnabled}
            furigana={showFurigana ? translation.furigana : undefined}
            className={cn(
              'text-sm leading-relaxed',
              isBase && 'font-medium',
            )}
          />
          <AnnotationLines
            romanization={translation.romanization}
            ipa={translation.ipa}
            showIpa={showIpa}
          />
        </div>
        <AudioButton
          url={audio?.url ?? null}
          language={translation.language}
          onTimeUpdate={buttonPlayback.onTimeUpdate}
          onStop={buttonPlayback.onStop}
          onRequestGenerate={
            hasText
              ? () => browse.onRequestAudio(row._id, translation.language)
              : undefined
          }
        />
      </div>
    );
  };

  return (
    <div
      className={cn(
        'content-box flex overflow-hidden p-0',
        isAdded &&
          'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
        isPrioritized && 'border-primary bg-primary/5',
        isIgnored && 'bg-muted/30',
      )}
      data-row-id={row._id}
      data-row-status={row.status}
      data-testid={`collection-text-${row.status}`}
    >
      <div className={cn('flex flex-1 items-center p-3 min-w-0', isIgnored && 'opacity-50')}>
        <div className="w-full">
          <div className="space-y-1">
            {baseTranslations.map((translation) => renderLine(translation, true))}
            {baseTranslations.length === 0 && (
              <p
                dir={getTextDirection(row.sourceLanguage)}
                className="text-sm font-medium leading-relaxed text-left"
              >
                {row.text}
              </p>
            )}
          </div>

          <Separator className="my-2" />

          <div className="space-y-1">
            {targetTranslations.map((translation) => renderLine(translation, false))}
          </div>
        </div>
      </div>

      <div className={PREVIEW_ACTION_PANEL_CLASS}>
        {isAdded ? (
          <div
            className="flex items-center justify-center text-success"
            title={t('addedOne')}
          >
            <CheckCircle2 className="size-4" />
          </div>
        ) : (
          <>
            <Button
              size="icon"
              variant="outline"
              className={cn(
                PREVIEW_ACTION_ICON_CLASS,
                isPrioritized &&
                  'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
              )}
              title={isPrioritized ? t('prioritized') : t('prioritize')}
              onClick={() =>
                browse.onSetMark(row._id, isPrioritized ? null : 'prioritized')
              }
              data-testid="collection-text-prioritize"
            >
              <ArrowUpCircle className="size-3.5" />
            </Button>
            <Button
              size="icon"
              className={PREVIEW_ACTION_ICON_CLASS}
              title={t('addOne')}
              disabled={isAddPending || addLocked}
              onClick={() => browse.onAddSingle(row._id)}
              data-testid="collection-text-add"
            >
              {isAddPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : addLocked ? (
                <Lock className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
            <Button
              size="icon"
              variant="outline"
              className={cn(
                PREVIEW_ACTION_ICON_CLASS,
                'text-muted-foreground',
                isIgnored && 'bg-muted text-foreground',
              )}
              title={isIgnored ? t('ignored') : t('ignore')}
              onClick={() =>
                browse.onSetMark(row._id, isIgnored ? null : 'ignored')
              }
              data-testid="collection-text-ignore"
            >
              <EyeOff className="size-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
