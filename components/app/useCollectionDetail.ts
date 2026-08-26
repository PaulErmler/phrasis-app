'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, usePaginatedQuery } from 'convex/react';
import type { OptimisticLocalStore } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useTranslations } from 'next-intl';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { toast } from 'sonner';
import {
  COLLECTION_PREVIEW_SIZE,
  MAX_PREVIEW_PAGE_SIZE,
  settledCount,
} from '@/convex/lib/collections';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { convexErrorCode } from '@/lib/utils';
import type { CollectionProgressItem } from './CollectionCarouselUI';

import { reportError } from '@/lib/report-error';

export type CollectionTextMark = 'prioritized' | 'ignored';

export type BrowseTextRow = FunctionReturnType<
  typeof api.features.collections.browseCollectionTexts
>['page'][number];

type PaginationStatus =
  | 'LoadingFirstPage'
  | 'CanLoadMore'
  | 'LoadingMore'
  | 'Exhausted';

/**
 * How long a "show more" click may hold the next page back while its
 * translations finish generating before revealing the rows anyway.
 */
const REVEAL_TIMEOUT_MS = 12_000;

/**
 * Optimistically flip a row's status across every loaded page of every
 * browse session (forward AND upTo, any anchor), so add/ignore/prioritize
 * clicks recolor the card instantly. Returns the row's previous status (so
 * the caller can derive counter deltas), or null when the row isn't loaded.
 * Convex rolls the patch back automatically if the mutation fails.
 */
function optimisticallySetRowStatus(
  localStore: OptimisticLocalStore,
  textId: string,
  status: BrowseTextRow['status'],
): BrowseTextRow['status'] | null {
  let previousStatus: BrowseTextRow['status'] | null = null;
  for (const { args, value } of localStore.getAllQueries(
    api.features.collections.browseCollectionTexts,
  )) {
    if (!value) continue;
    let changed = false;
    const page = value.page.map((row) => {
      if (row._id !== textId) return row;
      if (previousStatus === null) previousStatus = row.status;
      if (row.status === status) return row;
      changed = true;
      return { ...row, status };
    });
    if (changed) {
      localStore.setQuery(
        api.features.collections.browseCollectionTexts,
        args,
        { ...value, page },
      );
    }
  }
  return previousStatus;
}

/**
 * Optimistically nudge the per-collection counters (`cardsAdded`,
 * `prioritizedCount`, `ignoredCount`) in the home summary, so the dialog's
 * stats row and the carousel's remaining/progress numbers move in the same
 * frame as the row recolor instead of one server round-trip later.
 */
function optimisticallyAdjustCollectionCounters(
  localStore: OptimisticLocalStore,
  collectionId: string,
  delta: { cardsAdded?: number; prioritizedCount?: number; ignoredCount?: number },
): void {
  const summary = localStore.getQuery(api.features.home.getHomeSummary, {});
  if (!summary) return;
  const apply = <
    T extends {
      collectionId: string;
      cardsAdded: number;
      prioritizedCount: number;
      ignoredCount: number;
    },
  >(entry: T): T =>
      entry.collectionId === collectionId
        ? {
          ...entry,
          cardsAdded: Math.max(0, entry.cardsAdded + (delta.cardsAdded ?? 0)),
          prioritizedCount: Math.max(
            0,
            entry.prioritizedCount + (delta.prioritizedCount ?? 0),
          ),
          ignoredCount: Math.max(0, entry.ignoredCount + (delta.ignoredCount ?? 0)),
        }
        : entry;
  localStore.setQuery(api.features.home.getHomeSummary, {}, {
    ...summary,
    levels: summary.levels.map(apply),
    customCollections: summary.customCollections.map(apply),
  });
}

export interface CollectionBrowse {
  /** Main stream (ranks > anchor), ascending. Reveal-gated after "show more". */
  rows: BrowseTextRow[];
  status: PaginationStatus;
  loadMore: () => void;
  /** True while newly loaded rows are held back for their translations. */
  isPreparingMore: boolean;
  /** Added-history feed (ranks ≤ anchor), ASCENDING for display. Empty unless showAdded. */
  earlierRows: BrowseTextRow[];
  earlierStatus: PaginationStatus;
  loadEarlier: () => void;
  showAdded: boolean;
  setShowAdded: (value: boolean) => void;
  showIgnored: boolean;
  setShowIgnored: (value: boolean) => void;
  /**
   * Visibility filter: hides 'added'/'ignored' rows behind their toggles,
   * EXCEPT rows the user acted on this session. Those stay visible (green /
   * grey) until the dialog is closed and reopened.
   */
  isRowVisible: (row: BrowseTextRow) => boolean;
  onSetMark: (textId: string, mark: CollectionTextMark | null) => Promise<void>;
  onAddSingle: (textId: string) => Promise<void>;
  onRequestAudio: (
    textId: string,
    language: string,
  ) => Promise<{ scheduled: boolean }>;
  /** Text ids with an in-flight single-add (per-row button spinner). */
  pendingAddTextIds: Set<string>;
}

interface UseCollectionDetailOptions {
  collections: CollectionProgressItem[] | undefined;
}

export function useCollectionDetail({
  collections,
}: UseCollectionDetailOptions) {
  const t = useTranslations('AppPage.collections.carousel');
  const [openCollectionId, setOpenCollectionId] = useState<string | null>(null);
  // Range anchor frozen at dialog open: {collection, frontier-at-open}. The
  // browse queries only run once the snapshot matches the open collection,
  // and never shift range mid-session (that's what keeps just-added rows in
  // the list until reopen).
  const [anchor, setAnchor] = useState<{ id: string; rank: number } | null>(null);
  const [showAdded, setShowAdded] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [usageLimitHit, setUsageLimitHit] = useState(false);
  const [pendingAddTextIds, setPendingAddTextIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Rows the user acted on this session (added/ignored, incl. batch adds).
  // Exempt from the visibility toggles until the dialog reopens.
  const [sessionActedIds, setSessionActedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const sessionStatusRef = useRef<Map<string, BrowseTextRow['status']>>(new Map());
  // Below-anchor rows are only in the forward feed because their mark row is
  // injected into page 1. Adding one deletes that mark in-transaction, so
  // the reactive re-run drops the row entirely instead of flipping it to
  // 'added' in place like above-anchor rows. Keep a snapshot of every row
  // seen, plus the resurrected copies of rows that vanished, so acted rows
  // honor the stay-visible contract regardless of which side of the anchor
  // they live on.
  const rowSnapshotsRef = useRef<Map<string, BrowseTextRow>>(new Map());
  const forwardIdsRef = useRef<Set<string> | null>(null);
  const [resurrectedRows, setResurrectedRows] = useState<
    Map<string, BrowseTextRow>
  >(() => new Map());
  // Reveal gate for "show more": index into the raw forward rows below which
  // rows are shown. null = show everything loaded.
  const [revealBoundary, setRevealBoundary] = useState<number | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentencesQuota = useFeatureQuota(FEATURE_IDS.SENTENCES);

  const addCardsFromCollection = useMutation(
    api.features.decks.addCardsFromCollection,
  );
  const addSingleText = useMutation(
    api.features.decks.addSingleTextFromCollection,
  ).withOptimisticUpdate((localStore, args) => {
    const prev = optimisticallySetRowStatus(localStore, args.textId, 'added');
    if (!openCollectionId || prev === null || prev === 'added') return;
    optimisticallyAdjustCollectionCounters(localStore, openCollectionId, {
      cardsAdded: 1,
      // Adding clears any mark server-side; mirror that in the counters.
      prioritizedCount: prev === 'prioritized' ? -1 : 0,
      ignoredCount: prev === 'ignored' ? -1 : 0,
    });
  });
  const setMarkMutation = useMutation(
    api.features.collections.setCollectionTextMark,
  ).withOptimisticUpdate((localStore, args) => {
    const next = args.mark ?? 'none';
    const prev = optimisticallySetRowStatus(localStore, args.textId, next);
    if (!openCollectionId || prev === null || prev === next || prev === 'added') {
      return;
    }
    optimisticallyAdjustCollectionCounters(localStore, openCollectionId, {
      prioritizedCount:
        (next === 'prioritized' ? 1 : 0) - (prev === 'prioritized' ? 1 : 0),
      ignoredCount: (next === 'ignored' ? 1 : 0) - (prev === 'ignored' ? 1 : 0),
    });
  });
  const requestTranslations = useMutation(
    api.features.collections.requestPreviewTranslations,
  );
  const prewarmTranslations = useMutation(
    api.features.collections.prewarmPreviewTranslations,
  );
  const requestAudio = useMutation(api.features.collections.requestPreviewAudio);

  const openedCollection = collections?.find(
    (c) => c.collectionId === openCollectionId,
  );
  // Complete = every text either added or deliberately ignored.
  const isOpenedComplete = openedCollection
    ? settledCount(openedCollection) >= openedCollection.totalTexts &&
      openedCollection.totalTexts > 0
    : false;

  // Fresh dialog open: snapshot the anchor, reset all session state, and
  // default the toggles (added rows visible only for complete collections,
  // where the main stream would otherwise be empty).
  const lastOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (openCollectionId === lastOpenedRef.current) return;
    lastOpenedRef.current = openCollectionId;
    sessionStatusRef.current = new Map();
    rowSnapshotsRef.current = new Map();
    forwardIdsRef.current = null;
    setResurrectedRows(new Map());
    setSessionActedIds(new Set());
    setRevealBoundary(null);
    if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    if (openCollectionId) {
      setShowAdded(isOpenedComplete);
      setShowIgnored(false);
      setAnchor({
        id: openCollectionId,
        rank: openedCollection?.browseAnchor ?? 0,
      });
    } else {
      setAnchor(null);
    }
  }, [openCollectionId, isOpenedComplete, openedCollection]);

  useEffect(
    () => () => {
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    },
    [],
  );

  const anchorReady = anchor !== null && anchor.id === openCollectionId;

  const forward = usePaginatedQuery(
    api.features.collections.browseCollectionTexts,
    anchorReady
      ? {
        collectionId: anchor.id as Id<'collections'>,
        anchorRank: anchor.rank,
        direction: 'after' as const,
      }
      : 'skip',
    { initialNumItems: MAX_PREVIEW_PAGE_SIZE },
  );
  // Added-history feed above the anchor, only mounted while "show added" is
  // on (toggling it off unmounts; toggling back on refetches page 1).
  const earlier = usePaginatedQuery(
    api.features.collections.browseCollectionTexts,
    anchorReady && showAdded && anchor.rank > 0
      ? {
        collectionId: anchor.id as Id<'collections'>,
        anchorRank: anchor.rank,
        direction: 'upTo' as const,
      }
      : 'skip',
    { initialNumItems: MAX_PREVIEW_PAGE_SIZE },
  );

  const forwardRowsRaw = forward.results;
  const earlierRowsRaw = earlier.results;

  // Session pinning: any row whose status TRANSITIONS to added/ignored while
  // the dialog is open (per-row buttons, batch "Add N", prioritized drains)
  // is pinned visible for the rest of the session. The first sighting of a
  // row only records its baseline so pre-existing states aren't pinned.
  useEffect(() => {
    const statuses = sessionStatusRef.current;
    const newlyActed: string[] = [];
    for (const row of [...forwardRowsRaw, ...earlierRowsRaw]) {
      const prev = statuses.get(row._id);
      if (
        prev !== undefined &&
        prev !== row.status &&
        (row.status === 'added' || row.status === 'ignored')
      ) {
        newlyActed.push(row._id);
      }
      statuses.set(row._id, row.status);
    }
    if (newlyActed.length > 0) {
      setSessionActedIds((prevSet) => {
        const next = new Set(prevSet);
        for (const id of newlyActed) next.add(id);
        return next;
      });
    }
  }, [forwardRowsRaw, earlierRowsRaw]);

  // Resurrect injected rows the moment they vanish from the forward feed.
  // Adding is the only thing that removes a below-anchor row mid-session
  // (mark clears flip to the internal 'readd' mark, which stays injected;
  // above-anchor rows are range-selected and never leave), so a vanished id
  // means "added": pin its last snapshot as a green row. This covers batch
  // "Add N" drains too, which never produce an observable status transition.
  useEffect(() => {
    if (!anchorReady) {
      forwardIdsRef.current = null;
      return;
    }
    const currentIds = new Set<string>(forwardRowsRaw.map((row) => row._id));
    for (const row of forwardRowsRaw) rowSnapshotsRef.current.set(row._id, row);
    const prevIds = forwardIdsRef.current;
    forwardIdsRef.current = currentIds;
    if (!prevIds) return;
    const vanished: BrowseTextRow[] = [];
    for (const id of prevIds) {
      if (currentIds.has(id)) continue;
      const snapshot = rowSnapshotsRef.current.get(id);
      if (snapshot) vanished.push({ ...snapshot, status: 'added' });
    }
    if (vanished.length === 0) return;
    setResurrectedRows((prev) => {
      const next = new Map(prev);
      for (const row of vanished) next.set(row._id, row);
      return next;
    });
    setSessionActedIds((prev) => {
      const next = new Set(prev);
      for (const row of vanished) next.add(row._id);
      return next;
    });
  }, [forwardRowsRaw, anchorReady]);

  // Generate missing translations for every fetched non-added row (page 1 on
  // open, each revealed page, and the earlier feed's stragglers). Audio is
  // NEVER generated here. That's the per-row audio-icon click. The ref
  // dedups per mount; the backend claim tables dedup across sessions/users.
  const requestedTranslationsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!anchorReady || !openCollectionId) return;
    const pending = [...forwardRowsRaw, ...earlierRowsRaw]
      .filter(
        (row) =>
          row.status !== 'added' &&
          (row.missingTranslationLanguages.length > 0 ||
            // Complete translations can still lack an annotation line
            // (IPA/romanization); requesting the row runs the server's
            // annotation backfill without touching the translations.
            row.needsAnnotationBackfill) &&
          !requestedTranslationsRef.current.has(row._id),
      )
      .map((row) => row._id);
    if (pending.length === 0) return;
    const batch = pending.slice(0, MAX_PREVIEW_PAGE_SIZE);
    for (const id of batch) requestedTranslationsRef.current.add(id);
    requestTranslations({
      collectionId: openCollectionId as Id<'collections'>,
      textIds: batch,
    }).catch((error) => {
      reportError(error, { op: 'requestPreviewTranslations' });
      for (const id of batch) requestedTranslationsRef.current.delete(id);
    });
  }, [forwardRowsRaw, earlierRowsRaw, anchorReady, openCollectionId, requestTranslations]);

  // Prewarm one page AHEAD of what's loaded (translations only, no audio):
  // fires when page 1 lands (i.e. on open, warming rows 26-50) and again
  // after each "show more", so the next page is usually ready before it's
  // requested. Deduped per (collection, afterRank); the backend claims dedup
  // the rest.
  const prewarmedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!anchorReady || !openCollectionId) return;
    if (forward.status === 'LoadingFirstPage') return;
    const lastRank =
      forwardRowsRaw.length > 0
        ? forwardRowsRaw[forwardRowsRaw.length - 1].collectionRank
        : anchor.rank;
    const key = `${openCollectionId}:${lastRank}`;
    if (prewarmedRef.current.has(key)) return;
    prewarmedRef.current.add(key);
    prewarmTranslations({
      collectionId: openCollectionId as Id<'collections'>,
      afterRank: lastRank,
    }).catch((error) => {
      reportError(error, { op: 'prewarmPreviewTranslations' });
      prewarmedRef.current.delete(key);
    });
  }, [forwardRowsRaw, forward.status, anchorReady, openCollectionId, anchor, prewarmTranslations]);

  // Reveal gate: rows loaded by "show more" stay hidden (button keeps its
  // spinner) until each one either has all translations or is an added row,
  // with a timeout fallback so a stuck generation can't wedge the button.
  useEffect(() => {
    if (revealBoundary === null) return;
    const hidden = forwardRowsRaw.slice(revealBoundary);
    if (hidden.length === 0) {
      // An exactly-full page reports isDone=false, so "Show more" can load an
      // EMPTY page (status flips straight to Exhausted). That's not "still
      // loading". Clear the gate or the button spins for the full timeout.
      if (forward.status === 'Exhausted') {
        setRevealBoundary(null);
        if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
      }
      return; // otherwise: page still loading
    }
    const allReady = hidden.every(
      (row) => row.status === 'added' || row.missingTranslationLanguages.length === 0,
    );
    if (allReady) {
      setRevealBoundary(null);
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    }
  }, [forwardRowsRaw, forward.status, revealBoundary]);

  const handleLoadMore = useCallback(() => {
    setRevealBoundary((prev) => prev ?? forwardRowsRaw.length);
    if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    revealTimeoutRef.current = setTimeout(
      () => setRevealBoundary(null),
      REVEAL_TIMEOUT_MS,
    );
    forward.loadMore(MAX_PREVIEW_PAGE_SIZE);
  }, [forward, forwardRowsRaw.length]);

  const handleLoadEarlier = useCallback(() => {
    earlier.loadMore(MAX_PREVIEW_PAGE_SIZE);
  }, [earlier]);

  const effectiveBatchSize = sentencesQuota.unlimited
    ? COLLECTION_PREVIEW_SIZE
    : Math.min(COLLECTION_PREVIEW_SIZE, Math.max(0, sentencesQuota.balance));

  const handleAddCards = useCallback(async (targetCollectionId?: string) => {
    const collectionId = targetCollectionId ?? openCollectionId;
    if (!collectionId) return;

    setIsAdding(true);
    setUsageLimitHit(false);
    try {
      const args = {
        collectionId: collectionId as Id<'collections'>,
        batchSize: effectiveBatchSize > 0 ? effectiveBatchSize : COLLECTION_PREVIEW_SIZE,
        exclusive: true,
      };
      let result = await addCardsFromCollection(args);
      // A 0-card result with scanIncomplete means the scan burned its per-call
      // read budget on an ignored/direct-added streak; the frontier already
      // advanced, so re-calling continues past it. Bounded retries.
      let attempts = 1;
      while (result.cardsAdded === 0 && result.scanIncomplete && attempts < 5) {
        result = await addCardsFromCollection(args);
        attempts++;
      }

      if (result.cardsAdded === 0) {
        if (result.quotaLimited) {
          // Out of sentences, not out of collection, "nothing left to add"
          // would be wrong. Surface the same quota dialog as a thrown
          // USAGE_LIMIT does.
          setUsageLimitHit(true);
        } else {
          toast.info(t('noCardsToAdd'));
        }
      } else {
        toast.success(t('cardsAdded', { count: result.cardsAdded }));
      }
    } catch (error) {
      const code = convexErrorCode(error);
      if (code === 'PAYMENT_PAST_DUE') {
        // Silent: the reactive payment-overdue dialog is the canonical
        // surface for this state.
      } else if (code === 'USAGE_LIMIT') {
        setUsageLimitHit(true);
      } else if (code === 'QUOTA_NOT_SYNCED') {
        toast.error(t('failedToAdd'));
      } else {
        reportError(error, { op: 'addCardsFromCollection' });
        toast.error(t('failedToAdd'));
      }
    } finally {
      setIsAdding(false);
    }
  }, [openCollectionId, addCardsFromCollection, t, effectiveBatchSize]);

  const handleSetMark = useCallback(
    async (textId: string, mark: CollectionTextMark | null) => {
      try {
        await setMarkMutation({ textId: textId as Id<'texts'>, mark });
      } catch (error) {
        reportError(error, { op: 'setCollectionTextMark' });
        toast.error(t('detail.failedToMark'));
      }
    },
    [setMarkMutation, t],
  );

  const handleAddSingle = useCallback(
    async (textId: string) => {
      setPendingAddTextIds((prev) => new Set(prev).add(textId));
      setUsageLimitHit(false);
      try {
        await addSingleText({ textId: textId as Id<'texts'> });
      } catch (error) {
        const code = convexErrorCode(error);
        if (code === 'PAYMENT_PAST_DUE') {
          // Silent: the reactive payment-overdue dialog is the canonical
          // surface for this state.
        } else if (code === 'USAGE_LIMIT') {
          setUsageLimitHit(true);
        } else {
          reportError(error, { op: 'addSentenceToCollection' });
          toast.error(t('failedToAdd'));
        }
      } finally {
        setPendingAddTextIds((prev) => {
          const next = new Set(prev);
          next.delete(textId);
          return next;
        });
      }
    },
    [addSingleText, t],
  );

  const handleRequestAudio = useCallback(
    async (textId: string, language: string) => {
      // Errors propagate to the AudioButton, which resets its generate state.
      // The result does too: `scheduled: false` means no job was enqueued by
      // this click, so the button must not wait for a URL that isn't coming.
      return requestAudio({ textId: textId as Id<'texts'>, language });
    },
    [requestAudio],
  );

  const isRowVisible = useCallback(
    (row: BrowseTextRow) => {
      if (sessionActedIds.has(row._id)) return true;
      if (row.status === 'added' && !showAdded) return false;
      if (row.status === 'ignored' && !showIgnored) return false;
      return true;
    },
    [sessionActedIds, showAdded, showIgnored],
  );

  const browse: CollectionBrowse = useMemo(() => {
    const visibleForward =
      revealBoundary === null
        ? forwardRowsRaw
        : forwardRowsRaw.slice(0, revealBoundary);
    const forwardIds = new Set(forwardRowsRaw.map((row) => row._id));
    // Merge resurrected rows (added below-anchor rows the server dropped)
    // back in AFTER the reveal slice, so they don't shift the gate's index
    // math. The feed is globally rank-ascending (injected ranks ≤ anchor,
    // then page ranks > anchor), so a rank sort restores each row's spot.
    const resurrected = [...resurrectedRows.values()].filter(
      (row) => !forwardIds.has(row._id),
    );
    const rows =
      resurrected.length > 0
        ? [...resurrected, ...visibleForward].sort(
          (a, b) => a.collectionRank - b.collectionRank,
        )
        : visibleForward;
    // Below-anchor marked texts exist in BOTH feeds: injected into the
    // forward first page (or resurrected above) and returned by the 'upTo'
    // history query (which has no status filter). The forward copy is the
    // actionable one. Drop the history duplicate so the same sentence never
    // renders twice.
    const mainIds = new Set([...forwardIds, ...resurrectedRows.keys()]);
    return {
      rows,
      status: forward.status,
      loadMore: handleLoadMore,
      isPreparingMore: revealBoundary !== null,
      // 'upTo' pages descend from the anchor; display order is ascending.
      earlierRows: showAdded
        ? [...earlierRowsRaw].reverse().filter((row) => !mainIds.has(row._id))
        : [],
      earlierStatus: earlier.status,
      loadEarlier: handleLoadEarlier,
      showAdded,
      setShowAdded,
      showIgnored,
      setShowIgnored,
      isRowVisible,
      onSetMark: handleSetMark,
      onAddSingle: handleAddSingle,
      onRequestAudio: handleRequestAudio,
      pendingAddTextIds,
    };
  },
  [
    forwardRowsRaw,
    forward.status,
    handleLoadMore,
    revealBoundary,
    resurrectedRows,
    earlierRowsRaw,
    earlier.status,
    handleLoadEarlier,
    showAdded,
    showIgnored,
    isRowVisible,
    handleSetMark,
    handleAddSingle,
    handleRequestAudio,
    pendingAddTextIds,
  ],
  );

  return {
    openCollectionId,
    setOpenCollectionId,
    openedCollection,
    isOpenedComplete,
    browse,
    isAdding,
    handleAddCards,
    // While the quota query is loading, treat as unlimited so the inline
    // detail renders "+Add" by default instead of flashing the locked
    // Upgrade button before the real balance arrives. The server mutation
    // is still the authoritative gate if the user actually has 0 quota.
    sentencesRemaining:
      sentencesQuota.isLoading || sentencesQuota.unlimited
        ? null
        : sentencesQuota.balance,
    sentencesQuota,
    usageLimitHit,
  };
}
