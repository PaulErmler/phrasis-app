import { ConvexError } from 'convex/values';
import { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import { insertCard } from '../db/stats/cardAggregates';
import {
  getCourseSettings,
  setActiveCollectionOnSettings,
} from '../db/courseSettings';
import { requireActiveCourse } from '../db/courses';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import {
  findNextIncompleteCollection,
  getActiveDataset,
  getCollectionProgress as getCollectionProgressHelper,
  getNextCollection,
  getNextTextsFromRank,
} from '../db/collections';
import { ogteLevelToCollectionCode } from '../../lib/constants/onboarding';
import { EVENTS, track } from '../analytics';
import {
  collectionRemaining,
  effectiveTextCount,
  isCollectionComplete,
  isPremadeLevelCollection,
} from '../lib/collections';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import { consumeQuota, checkQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { MAX_CARDS_PER_BATCH, ENSURE_CONTENT_LOOKAHEAD } from '../../lib/constants/learning';
import { randomOrderKey } from '../lib/freePlay';
import { requireAccessibleText } from '../lib/collectionAccess';
import {
  applyMarkCounterDelta,
  clearMarkForAddedText,
  counterDeltaForMark,
  listMarksForCollection,
} from '../db/collectionTextMarks';
import { buildCardSearchableText } from '../lib/cardContent';

/**
 * Collection selection + card adding: which collection the course studies
 * from (active/custom selection, auto-advance on completion) and how texts
 * become cards — the mark-drain + sequential-frontier scan, dedup, quota,
 * progress bookkeeping, and the per-card content kick-off. The registered
 * mutations (setActiveCollection, addCardsFromCollection, …) stay in
 * features/decks.ts and delegate here.
 */

/** Handler body of `setActiveCollection`. */
export async function setActiveCollectionHandler(
  ctx: MutationCtx,
  args: { collectionId: Id<'collections'> },
): Promise<null> {
  const { userId, course } = await requireActiveCourse(ctx);
  const courseId = course._id;

  const collection = await ctx.db.get(args.collectionId);
  if (!collection) throw new ConvexError({ code: 'NOT_FOUND', message: 'Collection not found' });

  const courseSettings = await getCourseSettings(ctx, courseId);

  const isLevelCollection = isPremadeLevelCollection(collection);
  if (!isLevelCollection) {
    const isChatCollection =
      courseSettings?.chatCollectionId === args.collectionId;
    const isCustomCollection = (
      courseSettings?.activeCustomCollectionIds ?? []
    ).includes(args.collectionId);
    if (!isChatCollection && !isCustomCollection) {
      throw new ConvexError({ code: 'FORBIDDEN', message: 'Collection not accessible' });
    }
  }

  // Re-selecting the collection that's already active is a no-op, not an
  // error: `setCollectionTextMark` can complete a collection (via
  // `ignoredCount`) without running auto-advance, leaving it complete AND
  // still active. The guard below would then reject a click that changes
  // nothing.
  if (courseSettings?.activeCollectionId === args.collectionId) return null;

  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    args.collectionId,
  );

  // Complete = every text either added or deliberately ignored, counted
  // against the carry-widened total so this matches the predicate the UI
  // uses to decide whether to offer the button at all (empty collections
  // included, there's nothing to finish, so selecting one isn't an error).
  if (
    progress &&
    effectiveTextCount(collection.textCount, progress) > 0 &&
    isCollectionComplete(collection.textCount, progress)
  ) {
    throw new ConvexError({
      code: 'INVALID_STATE',
      message: 'This collection is already complete',
    });
  }

  await setActiveCollectionOnSettings(ctx, courseId, args.collectionId);
  return null;
}

/** Handler body of `setActiveCollectionByLevel`. */
export async function setActiveCollectionByLevelHandler(
  ctx: MutationCtx,
  args: { ogteLevel: number },
): Promise<null> {
  const { userId, course } = await requireActiveCourse(ctx);
  const courseId = course._id;

  const code = ogteLevelToCollectionCode(args.ogteLevel);
  if (!code) throw new ConvexError({ code: 'INVALID_ARGUMENT', message: 'Invalid level' });

  const activeDataset = await getActiveDataset(ctx);
  if (!activeDataset) throw new ConvexError({ code: 'INVALID_STATE', message: 'No active dataset' });
  const collection = await ctx.db
    .query('collections')
    .withIndex('by_datasetId_and_code', (q) =>
      q.eq('datasetId', activeDataset._id).eq('code', code),
    )
    .first();
  if (!collection) throw new ConvexError({ code: 'NOT_FOUND', message: 'Collection not found' });

  const courseSettings = await getCourseSettings(ctx, courseId);
  if (courseSettings?.activeCollectionId === collection._id) return null;

  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    collection._id,
  );
  if (
    progress &&
    effectiveTextCount(collection.textCount, progress) > 0 &&
    isCollectionComplete(collection.textCount, progress)
  ) {
    throw new ConvexError({
      code: 'INVALID_STATE',
      message: 'This collection is already complete',
    });
  }

  await setActiveCollectionOnSettings(ctx, courseId, collection._id);
  return null;
}

/** Handler body of `toggleCustomCollection`. */
export async function toggleCustomCollectionHandler(
  ctx: MutationCtx,
  args: { collectionId: Id<'collections'> },
): Promise<{ selected: boolean }> {
  const { course } = await requireActiveCourse(ctx);
  const courseId = course._id;

  const collection = await ctx.db.get(args.collectionId);
  if (!collection) throw new ConvexError({ code: 'NOT_FOUND', message: 'Collection not found' });

  const isLevelCollection = isPremadeLevelCollection(collection);
  if (isLevelCollection) {
    throw new ConvexError({
      code: 'INVALID_STATE',
      message: 'Cannot toggle a level collection',
    });
  }

  const courseSettings = await getCourseSettings(ctx, courseId);

  const isChatCollection =
    courseSettings?.chatCollectionId?.toString() === args.collectionId.toString();
  const isCustomCollection =
    courseSettings?.customCollectionId?.toString() === args.collectionId.toString();
  const isAlreadyCustom = (courseSettings?.activeCustomCollectionIds ?? []).some(
    (id) => id.toString() === args.collectionId.toString(),
  );
  if (!isChatCollection && !isCustomCollection && !isAlreadyCustom) {
    throw new ConvexError({ code: 'FORBIDDEN', message: 'Collection not accessible' });
  }

  const currentIds = courseSettings?.activeCustomCollectionIds ?? [];
  const idStr = args.collectionId.toString();
  const isCurrentlySelected = currentIds.some((id) => id.toString() === idStr);

  const newIds = isCurrentlySelected
    ? currentIds.filter((id) => id.toString() !== idStr)
    : [...currentIds, args.collectionId];

  if (courseSettings) {
    await ctx.db.patch(courseSettings._id, {
      activeCustomCollectionIds: newIds,
    });
  } else {
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      activeCustomCollectionIds: newIds,
    });
  }

  return { selected: !isCurrentlySelected };
}

/**
 * Creates cards from a list of texts and returns count of new cards inserted.
 * Shared by both chat-collection and difficulty-collection card creation.
 */
export async function createCardsFromTexts(
  ctx: MutationCtx,
  texts: Doc<'texts'>[],
  deck: Doc<'decks'>,
  collectionId: Id<'collections'>,
  course: Doc<'courses'>,
): Promise<{ cardsInserted: number; newLastRank: number }> {
  const now = Date.now();
  let cardsInserted = 0;
  let newLastRank = 0;

  // Look up the source collection's origin once per batch so each inserted
  // card carries the denormalized field for the content-source filter.
  // Fall back to `isPremadeLevelCollection` for legacy CEFR collections
  // (pre-OGTE-cutover rows that have neither a `datasetId` nor an explicit
  // `legacy: true` flag and never got their `origin` backfilled), otherwise
  // cards inserted from them get `collectionOrigin: undefined` and never
  // match the 'course' filter even though the UI treats them as course content.
  const collection = await ctx.db.get(collectionId);
  const maybeOrigin: 'premade' | 'custom' | 'chat' | undefined =
    collection?.origin
    ?? (collection && isPremadeLevelCollection(collection) ? 'premade' : undefined);
  // `cards.collectionOrigin` is a required field: every collection carries
  // `origin` since the one-time backfill (and all insert paths stamp it), so
  // this only fires for a dangling collectionId or an unbackfilled legacy
  // row — cases where the card insert below would fail schema validation
  // anyway. Fail fast with a diagnosable error instead.
  if (maybeOrigin === undefined) {
    throw new Error(
      `createCardsFromTexts: collection ${collectionId} is missing or has no resolvable origin; cannot insert cards`,
    );
  }
  const collectionOrigin: 'premade' | 'custom' | 'chat' = maybeOrigin;

  // With separateModeTracking on, seed the writing track at creation (a new
  // card's writing schedule is identical to its shared one) so the card is
  // immediately visible to the writing-due indexes without a backfill. While
  // it's off, cards stay unseeded. The enable-time seedWritingTrack backfill
  // copies the then-current shared state instead.
  const settingsForSeed = await getCourseSettings(ctx, course._id);
  const seedWritingTrack = settingsForSeed?.separateModeTracking === true;

  for (const text of texts) {
    if (text.collectionRank > newLastRank) {
      newLastRank = text.collectionRank;
    }

    const existingCard = await getCardByDeckAndText(ctx, deck._id, text._id);

    if (!existingCard) {
      const courseLanguages = [...course.baseLanguages, ...course.targetLanguages];
      const { searchableText, searchableTextLanguages } =
        await buildCardSearchableText(ctx, text._id, text.text, courseLanguages);

      await insertCard(ctx, {
        deckId: deck._id,
        textId: text._id,
        collectionId,
        collectionOrigin,
        dueDate: now + cardsInserted,
        isMastered: false,
        isHidden: false,
        isFavorite: false,
        isGraduated: false,
        schedulingPhase: 'preReview' as const,
        preReviewCount: 0,
        ...(seedWritingTrack
          ? { writingDueDate: now + cardsInserted, writingIsGraduated: false }
          : {}),
        radioRoundCounter: 0,
        radioPlayCount: 0,
        // Random tiebreaks so that even brand-new cards inserted in a single
        // batch (which would otherwise share creation time + counter) end up
        // in a shuffled free-play order rather than insertion order. The two
        // faces roll separately so their rotations never correlate.
        radioOrderKey: randomOrderKey(),
        freeStudyRoundCounter: 0,
        freeStudyPlayCount: 0,
        freeStudyOrderKey: randomOrderKey(),
        searchableText,
        searchableTextLanguages,
      });
      cardsInserted++;
    }
  }

  return { cardsInserted, newLastRank };
}

/**
 * Updates collection progress after adding cards.
 *
 * `addedDelta` must be the number of cards actually INSERTED (not texts
 * scanned): direct-adds from the collection preview create cards ahead of the
 * sequential frontier, and the later scan passing over them must not count
 * them a second time.
 *
 * `frontierRank` advances `lastRankProcessed` (monotonic via Math.max).
 * Omit it for out-of-order adds (preview direct-add, prioritized drain).
 * Those must NOT move the frontier, or every unscanned text between the old
 * frontier and the added rank would be silently skipped forever.
 */
export async function updateCollectionProgress(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  update: { addedDelta: number; frontierRank?: number },
): Promise<void> {
  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    collectionId,
  );

  if (progress) {
    await ctx.db.patch(progress._id, {
      cardsAdded: progress.cardsAdded + update.addedDelta,
      ...(update.frontierRank !== undefined
        ? {
          lastRankProcessed: Math.max(
            progress.lastRankProcessed ?? 0,
            update.frontierRank,
          ),
        }
        : {}),
    });
  } else {
    await ctx.db.insert('collectionProgress', {
      userId,
      courseId,
      collectionId,
      cardsAdded: update.addedDelta,
      ...(update.frontierRank !== undefined
        ? { lastRankProcessed: update.frontierRank }
        : {}),
    });
  }
}

async function getOrCreateDeck(
  ctx: MutationCtx,
  course: Doc<'courses'>,
): Promise<Doc<'decks'>> {
  const existing = await getDeckByCourseId(ctx, course._id);
  if (existing) return existing;
  const deckId = await ctx.db.insert('decks', {
    courseId: course._id,
    name: `Learning ${course.targetLanguages.join(', ')}`,
    cardCount: 0,
  });
  const deck = await ctx.db.get(deckId);
  // Plain Error, not ConvexError: an unreachable read-after-insert invariant
  // whose audience is server logs, never the client.
  if (!deck) throw new Error('Failed to create deck');
  return deck;
}

/**
 * Per-call bound on how many texts the sequential add scan may walk over.
 * Keeps one mutation's reads bounded when the frontier sits at the start of a
 * long ignored/direct-added streak: each scanned text costs ~2 reads (text
 * doc + card point-read), so 1500 ≈ 3k document reads. Well inside Convex's
 * per-transaction limits. The frontier advance is persisted even when nothing
 * addable was found, so the caller can signal `scanIncomplete` and the client
 * re-calls. Each retry resumes past the already-scanned stretch (guaranteed
 * progress). Exported for the scan-continuation test.
 */
export const ADD_SCAN_CAP = 1500;

/**
 * The next texts from a collection that can actually become cards: walks the
 * rank index from `afterRank`, passing over ignored-marked texts and texts
 * that already have a card (preview direct-adds ahead of the frontier).
 *
 * Returns the picked texts plus the new frontier (rank of the last text
 * processed, every text at or below it is added-or-ignored). `exhausted`
 * means the index range ran dry; `capped` means the ADD_SCAN_CAP was hit
 * before filling `limit` with more texts possibly remaining.
 */
export async function getNextAddableTextsFromRank(
  ctx: MutationCtx,
  params: {
    collectionId: Id<'collections'>;
    afterRank: number;
    limit: number;
    deckId: Id<'decks'>;
    userId: string;
    courseId: Id<'courses'>;
    options?: { onlyCurriculum?: boolean; forUserId?: string };
    /** Texts already selected by the prioritized drain in this call. */
    excludeTextIds?: Set<string>;
  },
): Promise<{
  picked: Doc<'texts'>[];
  newFrontier: number;
  exhausted: boolean;
  capped: boolean;
}> {
  const { collectionId, afterRank, limit, deckId, userId, courseId } = params;
  if (limit <= 0) {
    return { picked: [], newFrontier: afterRank, exhausted: false, capped: false };
  }

  const picked: Doc<'texts'>[] = [];
  let cursor = afterRank;
  let scanned = 0;
  let exhausted = false;

  while (picked.length < limit && scanned < ADD_SCAN_CAP) {
    // Floor of 50 keeps the skip-heavy worst case at ≤ 30 loop rounds while
    // costing at most ~45 extra text reads in the common instant-hit case.
    const batchSize = Math.min(Math.max(limit * 2, 50), ADD_SCAN_CAP - scanned);
    const batch = await getNextTextsFromRank(
      ctx,
      collectionId,
      cursor,
      batchSize,
      params.options,
    );
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    // Ignore set scoped to exactly this batch's rank window. Bounded by the
    // batch size no matter how many marks the user has in total (a global
    // read would need an unbounded collect and silently miss marks past any
    // fixed cap).
    const [cards, ignoredMarks] = await Promise.all([
      Promise.all(batch.map((t) => getCardByDeckAndText(ctx, deckId, t._id))),
      listMarksForCollection(ctx, userId, courseId, collectionId, 'ignored', {
        minRank: batch[0].collectionRank,
        maxRank: batch[batch.length - 1].collectionRank,
        limit: batch.length,
      }),
    ]);
    const ignoredTextIds = new Set(ignoredMarks.map((m) => m.textId.toString()));
    for (let i = 0; i < batch.length; i++) {
      if (picked.length >= limit) break; // don't pass unprocessed texts
      const text = batch[i];
      cursor = text.collectionRank;
      scanned++;
      if (ignoredTextIds.has(text._id.toString())) continue;
      if (params.excludeTextIds?.has(text._id.toString())) continue;
      if (cards[i]) continue; // direct-added earlier: pass, don't re-count
      picked.push(text);
    }
    // Short batch fully consumed → the range is dry.
    if (picked.length < limit && batch.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  return {
    picked,
    newFrontier: cursor,
    exhausted,
    capped: !exhausted && picked.length < limit && scanned >= ADD_SCAN_CAP,
  };
}

/**
 * Load the texts behind one type of the user's marks for a collection, rank
 * order, up to `limit`. Orphan marks (text deleted, or a card already exists)
 * are cleaned up here without counting toward the batch. The kept marks are
 * NOT deleted yet. `addTextsAsCards` clears them in the same transaction
 * that inserts the cards.
 */
async function drainMarkedTexts(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  deckId: Id<'decks'>,
  mark: 'prioritized' | 'readd',
  limit: number,
): Promise<Doc<'texts'>[]> {
  if (limit <= 0) return [];
  const marks = await listMarksForCollection(
    ctx,
    userId,
    courseId,
    collectionId,
    mark,
    { limit },
  );
  const texts: Doc<'texts'>[] = [];
  for (const markDoc of marks) {
    const text = await ctx.db.get(markDoc.textId);
    const existingCard = text
      ? await getCardByDeckAndText(ctx, deckId, text._id)
      : null;
    if (!text || existingCard) {
      await ctx.db.delete(markDoc._id);
      await applyMarkCounterDelta(
        ctx,
        userId,
        courseId,
        markDoc.collectionId,
        counterDeltaForMark(markDoc.mark, -1),
      );
      continue;
    }
    texts.push(text);
  }
  return texts;
}

/**
 * The out-of-band texts an add call must take before its sequential scan:
 * 'prioritized' marks jump the queue by design; 'readd' marks are un-marked
 * texts the frontier already passed (they'd otherwise be unreachable, since
 * the scan never looks backwards). Rank-ordered within each type,
 * prioritized first.
 */
async function drainQueuedMarkTexts(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  deckId: Id<'decks'>,
  limit: number,
): Promise<Doc<'texts'>[]> {
  const prioritized = await drainMarkedTexts(
    ctx, userId, courseId, collectionId, deckId, 'prioritized', limit,
  );
  const readd = await drainMarkedTexts(
    ctx, userId, courseId, collectionId, deckId, 'readd',
    limit - prioritized.length,
  );
  return [...prioritized, ...readd];
}

/**
 * Turn texts into cards: insert (deduped), clear any marks (keeps the
 * "marks exist only for card-less texts" invariant + counters), and schedule
 * full content (translations + audio) per text. Returns cards inserted.
 */
async function addTextsAsCards(
  ctx: MutationCtx,
  texts: Doc<'texts'>[],
  deck: Doc<'decks'>,
  collectionId: Id<'collections'>,
  course: Doc<'courses'>,
  userId: string,
): Promise<number> {
  if (texts.length === 0) return 0;
  const { cardsInserted } = await createCardsFromTexts(
    ctx,
    texts,
    deck,
    collectionId,
    course,
  );
  for (const text of texts) {
    await clearMarkForAddedText(ctx, userId, course._id, text._id);
    await ctx.scheduler.runAfter(
      0,
      internal.features.decks.prepareCardContent,
      {
        textId: text._id,
        baseLanguages: course.baseLanguages,
        targetLanguages: course.targetLanguages,
      },
    );
  }
  return cardsInserted;
}

/**
 * If `collectionId` is the active premade collection and is now complete.
 * Every text either added or deliberately ignored. Advance the active
 * collection to the next incomplete one (or clear it when none remain).
 * Walks forward within the same collection generation. New-dataset
 * collections advance by `order + 1`, legacy collections walk
 * LEGACY_LEVEL_ORDER. See findNextIncompleteCollection / getNextCollection.
 */
async function maybeAutoAdvanceActiveCollection(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
): Promise<void> {
  const collection = await ctx.db.get(collectionId);
  if (!collection || !isPremadeLevelCollection(collection)) return;
  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    collectionId,
  );
  if (!isCollectionComplete(collection.textCount, progress)) return;
  const latestSettings = await getCourseSettings(ctx, courseId);
  if (
    latestSettings?.activeCollectionId?.toString() !== collectionId.toString()
  ) {
    return;
  }
  // Start the search at the collection AFTER the one we just completed, so a
  // partially-filled current row can't be picked.
  const startCollection = await getNextCollection(ctx, collection);
  const next = startCollection
    ? await findNextIncompleteCollection(ctx, startCollection, userId, courseId)
    : null;
  await setActiveCollectionOnSettings(ctx, courseId, next?._id);
}

/** Handler body of `addCardsFromCollection`. */
export async function addCardsFromCollectionHandler(
  ctx: MutationCtx,
  args: { collectionId: Id<'collections'>; batchSize: number; exclusive?: boolean },
): Promise<{
  cardsAdded: number;
  totalCardsInDeck: number;
  scanIncomplete: boolean;
  quotaLimited?: boolean;
}> {
  const { userId, course } = await requireActiveCourse(ctx);
  const courseId = course._id;

  const clampedBatchSize = Math.max(1, Math.min(MAX_CARDS_PER_BATCH, Math.floor(args.batchSize)));

  const deck = await getOrCreateDeck(ctx, course);

  let totalCardsInserted = 0;
  let remainingBatch = clampedBatchSize;
  let scanIncomplete = false;

  // --- Phase 1: Add from custom collection(s) ---
  // When the requested collection is a level collection (learning mode auto-add),
  // drain pending texts from ALL selected custom collections randomly.
  // When the requested collection is a custom collection (collection detail "add" button),
  // only add from that specific collection.
  const courseSettings = await getCourseSettings(ctx, courseId);
  const requestedCollection = await ctx.db.get(args.collectionId);
  const isLevelCollection = requestedCollection
    ? isPremadeLevelCollection(requestedCollection)
    : false;

  // Content-source filter: scopes the learning-mode auto-add flow only.
  // When `exclusive` is set, the user is explicitly adding from a specific
  // collection via the collection detail dialog. Honor that source directly.
  const studyContentFilter = courseSettings?.studyContentFilter ?? 'both';
  const skipCustomSources = !args.exclusive && studyContentFilter === 'course';
  const skipPremadeSource = !args.exclusive && studyContentFilter === 'custom';

  const customCollectionIdsToProcess: Id<'collections'>[] = skipCustomSources
    ? []
    : args.exclusive
      ? (isLevelCollection
        ? []
        : [args.collectionId])
      : isLevelCollection
        ? (courseSettings?.activeCustomCollectionIds ?? [])
        : [args.collectionId].filter((id) =>
          courseSettings?.chatCollectionId?.toString() === id.toString() ||
          courseSettings?.customCollectionId?.toString() === id.toString() ||
          (courseSettings?.activeCustomCollectionIds ?? []).some(
            (cid) => cid.toString() === id.toString(),
          ),
        );

  if (customCollectionIdsToProcess.length > 0 && remainingBatch > 0) {
    const collectionsWithPending: {
      id: Id<'collections'>;
      collection: Doc<'collections'>;
      lastRank: number;
      pendingCount: number;
    }[] = [];

    for (const collId of customCollectionIdsToProcess) {
      const coll = await ctx.db.get(collId);
      if (!coll) continue;
      const prog = await getCollectionProgressHelper(ctx, userId, courseId, collId);
      const lastRank = prog?.lastRankProcessed ?? 0;
      // Ignored texts are deliberately excluded from auto-add, so they
      // don't count as pending. (Custom collections never carry cutover
      // credit, so widening here is a no-op. It just keeps every
      // `collectionRemaining` call on the effective total.)
      const pending = collectionRemaining(
        effectiveTextCount(coll.textCount, prog),
        prog,
      );
      if (pending > 0) {
        collectionsWithPending.push({
          id: collId,
          collection: coll,
          lastRank,
          pendingCount: pending,
        });
      }
    }

    if (collectionsWithPending.length > 0) {
      const allocations = new Map<string, number>();
      const pool = [...collectionsWithPending];
      let remaining = remainingBatch;

      while (remaining > 0 && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        const entry = pool[idx];
        const key = entry.id.toString();
        allocations.set(key, (allocations.get(key) ?? 0) + 1);
        entry.pendingCount--;
        if (entry.pendingCount <= 0) pool.splice(idx, 1);
        remaining--;
      }

      for (const entry of collectionsWithPending) {
        const count = allocations.get(entry.id.toString()) ?? 0;
        if (count === 0) continue;

        // Prioritized/readd marks jump the queue (rank-ordered, frontier
        // untouched); the sequential scan fills the rest, skipping ignored
        // and already-carded texts.
        const queuedTexts = await drainQueuedMarkTexts(
          ctx, userId, courseId, entry.id, deck._id, count,
        );
        const scan = await getNextAddableTextsFromRank(ctx, {
          collectionId: entry.id,
          afterRank: entry.lastRank,
          limit: count - queuedTexts.length,
          deckId: deck._id,
          userId,
          courseId,
          options: { forUserId: userId },
          excludeTextIds: new Set(queuedTexts.map((t) => t._id.toString())),
        });
        if (scan.capped) scanIncomplete = true;

        const texts = [...queuedTexts, ...scan.picked];
        const cardsInserted = await addTextsAsCards(
          ctx, texts, deck, entry.id, course, userId,
        );

        totalCardsInserted += cardsInserted;
        remainingBatch -= texts.length;

        if (cardsInserted > 0 || scan.newFrontier > entry.lastRank) {
          await updateCollectionProgress(ctx, userId, courseId, entry.id, {
            addedDelta: cardsInserted,
            frontierRank: scan.newFrontier,
          });
        }
      }
    }
  }

  // --- Phase 2: Fill remaining batch from the difficulty collection (only for level collections) ---
  if (isLevelCollection && remainingBatch > 0 && !skipPremadeSource) {
    // Deduct sentences quota for difficulty-collection cards
    const quota = await checkQuota(ctx, userId, FEATURE_IDS.SENTENCES, remainingBatch);
    if (quota.synced && !quota.allowed) {
      // Clamp to whatever balance is left
      if (quota.balance > 0) {
        remainingBatch = quota.balance;
      } else {
        // No sentences left. Skip Phase 2 entirely, return Phase 1 results.
        // `insertCard` maintained deck.cardCount per insert; `deck` is the
        // pre-insert snapshot, so add this call's inserts for the report.
        return {
          cardsAdded: totalCardsInserted,
          totalCardsInDeck: deck.cardCount + totalCardsInserted,
          scanIncomplete,
          quotaLimited: true,
        };
      }
    }

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      courseId,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    // Prioritized/readd marks jump the queue (rank-ordered, frontier
    // untouched); the sequential scan fills the rest, skipping ignored
    // texts and cards direct-added ahead of the frontier.
    const queuedTexts = await drainQueuedMarkTexts(
      ctx, userId, courseId, args.collectionId, deck._id, remainingBatch,
    );
    const scan = await getNextAddableTextsFromRank(ctx, {
      collectionId: args.collectionId,
      afterRank: lastRankProcessed,
      limit: remainingBatch - queuedTexts.length,
      deckId: deck._id,
      userId,
      courseId,
      options: { onlyCurriculum: true },
      excludeTextIds: new Set(queuedTexts.map((t) => t._id.toString())),
    });
    if (scan.capped) scanIncomplete = true;

    const textsToAdd = [...queuedTexts, ...scan.picked];

    if (textsToAdd.length > 0) {
      await consumeQuota(ctx, userId, FEATURE_IDS.SENTENCES, textsToAdd.length);

      const cardsInserted = await addTextsAsCards(
        ctx, textsToAdd, deck, args.collectionId, course, userId,
      );
      totalCardsInserted += cardsInserted;

      await updateCollectionProgress(ctx, userId, courseId, args.collectionId, {
        addedDelta: cardsInserted,
        frontierRank: scan.newFrontier,
      });

      // Warm-ahead: pre-generate content for the NEXT batch beyond the
      // just-advanced frontier, so it is ready by the time a fast reviewer
      // adds it (the full pipeline takes ~15-40s per card, and batches were
      // observed being added ~30s apart). Fire-and-forget in its own
      // transaction so a warm failure can't fail the add.
      await ctx.scheduler.runAfter(
        0,
        internal.features.decks.warmNextCollectionBatch,
        {
          collectionId: args.collectionId,
          courseId,
          deckId: deck._id,
          userId,
          afterRank: scan.newFrontier,
          limit: Math.min(clampedBatchSize, ENSURE_CONTENT_LOOKAHEAD),
        },
      );

      // Auto-advance: if the collection is now complete (every text added
      // or deliberately ignored) and is the active one, move to the next
      // incomplete collection (or clear if last).
      await maybeAutoAdvanceActiveCollection(ctx, userId, courseId, args.collectionId);
    } else if (scan.newFrontier > lastRankProcessed) {
      // Nothing addable in the scanned window (an ignored/direct-added
      // streak), persist the frontier advance so the next call continues
      // past it instead of re-scanning the same stretch.
      await updateCollectionProgress(ctx, userId, courseId, args.collectionId, {
        addedDelta: 0,
        frontierRank: scan.newFrontier,
      });
      await maybeAutoAdvanceActiveCollection(ctx, userId, courseId, args.collectionId);
    }
  }

  // deck.cardCount is maintained by `insertCard` (db/stats/cardAggregates),
  // one increment per inserted row, in the same transaction as the insert.
  // `deck` below is the pre-insert snapshot, so snapshot + inserts equals
  // the stored count for the reported totals.

  // One event per batch with a count, not one per card. Adding 50 cards is
  // a single user decision, and modelling it as 50 events would both distort
  // the behavioural picture and multiply the bill.
  if (totalCardsInserted > 0) {
    await track(ctx, userId, EVENTS.CARDS_ADDED, {
      count: totalCardsInserted,
      source: 'collection',
      collection_id: args.collectionId,
      deck_size_after: deck.cardCount + totalCardsInserted,
    });
  }

  return {
    cardsAdded: totalCardsInserted,
    totalCardsInDeck: deck.cardCount + totalCardsInserted,
    scanIncomplete,
    quotaLimited: false,
  };
}

/** Handler body of `addSingleTextFromCollection`. */
export async function addSingleTextFromCollectionHandler(
  ctx: MutationCtx,
  args: { textId: Id<'texts'> },
): Promise<{ added: boolean; alreadyAdded: boolean }> {
  const { userId, course } = await requireActiveCourse(ctx);
  const courseId = course._id;

  const { text, isLevelCollection } = await requireAccessibleText(
    ctx,
    args.textId,
    courseId,
    userId,
  );

  const deck = await getOrCreateDeck(ctx, course);

  const existingCard = await getCardByDeckAndText(ctx, deck._id, args.textId);
  if (existingCard) {
    // Already in the deck, just make sure no stale mark survives.
    await clearMarkForAddedText(ctx, userId, courseId, args.textId);
    return { added: false, alreadyAdded: true };
  }

  if (isLevelCollection) {
    await consumeQuota(ctx, userId, FEATURE_IDS.SENTENCES, 1);
  }

  const cardsInserted = await addTextsAsCards(
    ctx, [text], deck, text.collectionId, course, userId,
  );
  if (cardsInserted > 0) {
    await updateCollectionProgress(ctx, userId, courseId, text.collectionId, {
      addedDelta: cardsInserted,
    });
    await maybeAutoAdvanceActiveCollection(ctx, userId, courseId, text.collectionId);
  }

  return { added: cardsInserted > 0, alreadyAdded: false };
}
