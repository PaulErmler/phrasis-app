import { components } from '../../_generated/api';
import { DataModel } from '../../_generated/dataModel';
import { MutationCtx } from '../../_generated/server';
import { TableAggregate } from '@convex-dev/aggregate';
import { Doc, Id } from '../../_generated/dataModel';
import { LEGACY_TO_NEW_CODE } from '../../lib/collections';
import type { SchedulingTrack } from '../../types';

// ============================================================================
// State label helpers
// ============================================================================

import { FSRS_STATE_LABELS, EXTENDED_STATE_LABELS } from '../../lib/fsrsStates';

/**
 * Derive a single state label for a card document.
 * Priority: hidden > mastered > FSRS state (or preReview).
 *
 * For `track: 'writing'` the label derives from `writingFsrsState` instead.
 * The writing track has no pre-review phase, so an unreviewed (or
 * freshly-seeded-from-preReview) track is simply 'new'; only meaningful for
 * cards where `hasWritingTrack` is true.
 */
export function getCardStateLabel(
  doc: Doc<'cards'>,
  track: SchedulingTrack = 'shared',
): string {
  if (doc.isHidden) return 'hidden';
  if (doc.isMastered) return 'mastered';
  if (track === 'shared' && doc.schedulingPhase === 'preReview') return 'new';
  const fsrs = track === 'shared' ? doc.fsrsState : doc.writingFsrsState;
  return FSRS_STATE_LABELS[fsrs?.state ?? 0] ?? 'new';
}

/**
 * Whether the card has a seeded writing track (separateModeTracking courses).
 * Gates every write to the writing aggregates. Cards without the track are
 * simply absent from them.
 */
export function hasWritingTrack(doc: Doc<'cards'>): boolean {
  return doc.writingDueDate !== undefined;
}

/**
 * Origin bucket for the filter-aware aggregate. 'none' collects legacy cards
 * whose `collectionOrigin` was never resolved. They are only counted under
 * the unfiltered 'both' path, mirroring `fetchDueCardsWithFilter`.
 */
export const ORIGIN_BUCKETS = ['premade', 'custom', 'chat', 'none'] as const;
export type OriginBucket = (typeof ORIGIN_BUCKETS)[number];

export function getCardOriginBucket(doc: Doc<'cards'>): OriginBucket {
  return doc.collectionOrigin ?? 'none';
}

// ============================================================================
// Aggregate instances
// ============================================================================

/**
 * Cards grouped by [deckId:stateLabel], sorted by dueDate.
 * Enables O(log n) count of due cards per state: e.g. count 'new' cards where dueDate <= now.
 */
export const cardsByStateAndDueDate = new TableAggregate<{
  Namespace: string; // `${deckId}:${stateLabel}`
  Key: number; // dueDate
  DataModel: DataModel;
  TableName: 'cards';
}>(components.cardsByStateAndDueDate, {
  namespace: (doc) => `${doc.deckId}:${getCardStateLabel(doc)}`,
  sortKey: (doc) => doc.dueDate,
});

/**
 * Cards grouped by [deckId:originBucket:stateLabel], sorted by dueDate.
 * Enables O(log n) filter-aware due counts: e.g. count due 'new' cards whose
 * source is 'premade' (the content filter's 'course' option). The unfiltered
 * 'both' path keeps using `cardsByStateAndDueDate` (4 counts instead of 16).
 *
 * NOTE: `collectionOrigin` is part of this aggregate's namespace. Any write
 * that patches `collectionOrigin` outside the helpers below (e.g. a re-run of
 * `cardCollectionBackfill` that actually patches docs) must be followed by
 * the per-user recalc migration to repair drift.
 */
export const cardsByOriginStateAndDueDate = new TableAggregate<{
  Namespace: string; // `${deckId}:${originBucket}:${stateLabel}`
  Key: number; // dueDate
  DataModel: DataModel;
  TableName: 'cards';
}>(components.cardsByOriginStateAndDueDate, {
  namespace: (doc) =>
    `${doc.deckId}:${getCardOriginBucket(doc)}:${getCardStateLabel(doc)}`,
  sortKey: (doc) => doc.dueDate,
});

/**
 * Writing-track mirror of `cardsByStateAndDueDate`: [deckId:writingStateLabel],
 * sorted by writingDueDate. Powers due counts while a separateModeTracking
 * course is in Writing mode. Cards without a writing track are never inserted.
 */
export const cardsByWritingStateAndDueDate = new TableAggregate<{
  Namespace: string; // `${deckId}:${writingStateLabel}`
  Key: number; // writingDueDate
  DataModel: DataModel;
  TableName: 'cards';
}>(components.cardsByWritingStateAndDueDate, {
  namespace: (doc) => `${doc.deckId}:${getCardStateLabel(doc, 'writing')}`,
  sortKey: (doc) => doc.writingDueDate ?? 0,
});

/**
 * Writing-track mirror of `cardsByOriginStateAndDueDate`:
 * [deckId:originBucket:writingStateLabel], sorted by writingDueDate.
 */
export const cardsByOriginWritingStateAndDueDate = new TableAggregate<{
  Namespace: string; // `${deckId}:${originBucket}:${writingStateLabel}`
  Key: number; // writingDueDate
  DataModel: DataModel;
  TableName: 'cards';
}>(components.cardsByOriginWritingStateAndDueDate, {
  namespace: (doc) =>
    `${doc.deckId}:${getCardOriginBucket(doc)}:${getCardStateLabel(doc, 'writing')}`,
  sortKey: (doc) => doc.writingDueDate ?? 0,
});

// ============================================================================
// Card write helpers (wrap ctx.db calls + aggregate sync)
// ============================================================================

/**
 * Move `decks.cardCount` by `delta`, floored at 0.
 *
 * The denormalized counter (readers: admin dashboard, admin/deleteUser
 * preflight, features/projections fallback) is maintained ONLY here, in the
 * same transaction as the card-row write — the same single-writer contract
 * the aggregates above follow — so it cannot drift from the actual rows.
 * Before this lived here, four call sites incremented it and nothing
 * decremented, so every permanent delete inflated it forever; the one-shot
 * `migrations:recountDeckCardCounts` repairs that historical drift. The floor
 * guards decrements against counters that drifted LOW before the repair ran
 * (and against double-deletes); a missing deck (bulk purge mid-flight) is a
 * no-op.
 */
async function adjustDeckCardCount(
  ctx: MutationCtx,
  deckId: Id<'decks'>,
  delta: 1 | -1,
): Promise<void> {
  const deck = await ctx.db.get(deckId);
  if (!deck) return;
  await ctx.db.patch(deckId, {
    cardCount: Math.max(0, deck.cardCount + delta),
  });
}

/**
 * Insert a card, update both aggregates, and bump the deck's `cardCount`.
 */
export async function insertCard(
  ctx: MutationCtx,
  data: Omit<Doc<'cards'>, '_id' | '_creationTime'>,
): Promise<Id<'cards'>> {
  const id = await ctx.db.insert('cards', data);
  const doc = (await ctx.db.get(id))!;
  await cardsByStateAndDueDate.insertIfDoesNotExist(ctx, doc);
  await cardsByOriginStateAndDueDate.insertIfDoesNotExist(ctx, doc);
  if (hasWritingTrack(doc)) {
    await cardsByWritingStateAndDueDate.insertIfDoesNotExist(ctx, doc);
    await cardsByOriginWritingStateAndDueDate.insertIfDoesNotExist(ctx, doc);
  }
  await adjustDeckCardCount(ctx, data.deckId, 1);
  return id;
}

type CardsDueAggregate = TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: 'cards';
}>;

/**
 * Everything track-selected about the two due-count aggregate families, keyed
 * by SchedulingTrack. The same shape as `TRACK_DUE_QUERIES` in
 * lib/dueQueue.ts, so track-dependent code selects once instead of
 * re-spelling `track === 'writing' ? … : …` per aggregate.
 *
 * `fields`: the card fields each family derives its namespace/sortKey from.
 * A patch that touches NONE of a family's fields cannot move or re-key any of
 * that family's entries, so its `replaceOrInsert`s are skipped entirely.
 * Each one is a multi-read/write component subtransaction, and dropping the
 * no-op ones matters on hot paths (a shared-track review of a split-course
 * card would otherwise pay for two writing-aggregate writes; a
 * seedWritingTrack batch would pay for two shared ones per card, the exact
 * cost class that has blown mutation limits before). Key-presence is checked,
 * not value-equality, so the skip is conservative: a key listed in the patch
 * always counts as touched.
 *
 * One property this deliberately gives up: `replaceOrInsert` INSERTS when the
 * entry is missing, so before the skip existed every card patch incidentally
 * repaired a card that had fallen out of an aggregate (see the drift warning
 * on `cardsByOriginStateAndDueDate` above). Patches touching none of these
 * fields. `toggleFavoriteCard`, `setAudioSpeedOverride`, the free-play
 * counter advance, no longer do that, so drift no longer self-heals. It is
 * repaired only by `migrations/recalcUserCardAggregates`, which is where to
 * look first if due counts read low for one deck.
 */
export const TRACK_AGGREGATES: Record<
  SchedulingTrack,
  {
    state: CardsDueAggregate;
    originState: CardsDueAggregate;
    fields: ReadonlySet<string>;
  }
> = {
  shared: {
    state: cardsByStateAndDueDate,
    originState: cardsByOriginStateAndDueDate,
    fields: new Set([
      'deckId',
      'dueDate',
      'isHidden',
      'isMastered',
      'schedulingPhase',
      'fsrsState',
      'collectionOrigin',
    ]),
  },
  writing: {
    state: cardsByWritingStateAndDueDate,
    originState: cardsByOriginWritingStateAndDueDate,
    fields: new Set([
      'deckId',
      'writingDueDate',
      'writingFsrsState',
      'isHidden',
      'isMastered',
      'collectionOrigin',
    ]),
  },
};

/**
 * Patch a card and update both aggregates.
 *
 * Pass `oldDoc` when the caller has already fetched the card. Saves a read
 * on the hot path. The post-patch doc is computed in memory instead of being
 * re-read; the aggregates only key on fields that are deterministic from
 * `oldDoc + patch` (deckId, dueDate, isHidden, isMastered, schedulingPhase,
 * fsrsState, and their writing-track counterparts).
 *
 * Also bumps `collectionProgress.cardsMastered` on the false → true mastery
 * transition. The counter is strictly monotonic. True → false (demaster) is
 * a no-op. See schema.ts:collectionProgress for the broader semantic.
 */
export async function patchCard(
  ctx: MutationCtx,
  cardId: Id<'cards'>,
  patch: Partial<Doc<'cards'>>,
  oldDoc?: Doc<'cards'>,
): Promise<void> {
  const resolvedOld = oldDoc ?? (await ctx.db.get(cardId));
  if (!resolvedOld) return;
  await ctx.db.patch(cardId, patch);
  const newDoc: Doc<'cards'> = { ...resolvedOld, ...patch };
  const patchKeys = Object.keys(patch);
  const touchesShared = patchKeys.some((k) =>
    TRACK_AGGREGATES.shared.fields.has(k),
  );
  const touchesWriting = patchKeys.some((k) =>
    TRACK_AGGREGATES.writing.fields.has(k),
  );

  if (touchesShared) {
    await cardsByStateAndDueDate.replaceOrInsert(ctx, resolvedOld, newDoc);
    await cardsByOriginStateAndDueDate.replaceOrInsert(ctx, resolvedOld, newDoc);
  }
  // Writing-track aggregates: membership is gated on the track existing, so a
  // patch can move a card in (seeding), out (never in practice, nothing
  // unsets the track), or within them. Membership changes always come from a
  // `writingDueDate` write, so the untouched-skip can only apply to the
  // stayed-a-member branch.
  if (hasWritingTrack(newDoc)) {
    if (!hasWritingTrack(resolvedOld)) {
      await cardsByWritingStateAndDueDate.insertIfDoesNotExist(ctx, newDoc);
      await cardsByOriginWritingStateAndDueDate.insertIfDoesNotExist(ctx, newDoc);
    } else if (touchesWriting) {
      await cardsByWritingStateAndDueDate.replaceOrInsert(ctx, resolvedOld, newDoc);
      await cardsByOriginWritingStateAndDueDate.replaceOrInsert(ctx, resolvedOld, newDoc);
    }
  } else if (hasWritingTrack(resolvedOld)) {
    await cardsByWritingStateAndDueDate.deleteIfExists(ctx, resolvedOld);
    await cardsByOriginWritingStateAndDueDate.deleteIfExists(ctx, resolvedOld);
  }

  if (!resolvedOld.isMastered && newDoc.isMastered && newDoc.collectionId) {
    await bumpCardsMastered(ctx, newDoc.deckId, newDoc.collectionId);
  }
}

/**
 * Bump `cardsMastered` on the matching collectionProgress row. Looks up the
 * (userId, courseId) pair via the card's deck. Idempotency is the caller's
 * responsibility, only call on actual false → true transitions.
 *
 * Post-cutover redirect: if the card's collection is one of the seven legacy
 * CEFR rows AND the user has been reconciled to a new dataset, we bump the
 * rolled-forward destination collection's row instead. This keeps masteries
 * on pre-cutover cards (whose `collectionId` still points at the legacy row)
 * visible on the new home view. If the lookup fails at any step we fall back
 * to bumping the legacy row, never silently drop the increment.
 */
async function bumpCardsMastered(
  ctx: MutationCtx,
  deckId: Id<'decks'>,
  collectionId: Id<'collections'>,
): Promise<void> {
  const deck = await ctx.db.get(deckId);
  if (!deck) return;
  const course = await ctx.db.get(deck.courseId);
  if (!course) return;

  const targetCollectionId = await resolveProgressTargetCollectionId(
    ctx,
    deck.courseId,
    collectionId,
  );

  const progress = await ctx.db
    .query('collectionProgress')
    .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
      q
        .eq('userId', course.userId)
        .eq('courseId', deck.courseId)
        .eq('collectionId', targetCollectionId),
    )
    .first();
  if (!progress) return;
  // Skip if no row exists. `updateCollectionProgress` always creates the
  // row when the first card is added, so a missing row here means the card
  // was inserted by a path that bypasses progress tracking (manual import,
  // migration). The backfill migration handles those cases. Inserting here
  // would violate the invariant cardsMastered ≤ cardsAdded.
  await ctx.db.patch(progress._id, {
    cardsMastered: (progress.cardsMastered ?? 0) + 1,
  });
}

/**
 * Resolve the collectionProgress collection a counter bump should target.
 * Returns the input id unchanged unless the card sits on a legacy CEFR
 * collection AND the user's course has been reconciled to a new dataset.
 * Then returns the rolled-forward destination collection's id.
 */
async function resolveProgressTargetCollectionId(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
): Promise<Id<'collections'>> {
  const collection = await ctx.db.get(collectionId);
  if (!collection) return collectionId;

  const newCode = LEGACY_TO_NEW_CODE[collection.name];
  // Cheap guard: only proceed if this collection's name matches one of the
  // seven legacy CEFR rows. Also require `datasetId` to be absent. A new
  // collection happens to satisfy `name === code` but always has datasetId
  // set, so this rejects new rows quickly and avoids the courseSettings read
  // on the hot path.
  if (!newCode || collection.datasetId) return collectionId;

  const settings = await ctx.db
    .query('courseSettings')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .first();
  const reconciledDatasetId = settings?.reconciledDatasetId;
  if (!reconciledDatasetId) return collectionId;

  // The new dataset stamps `name = code` on every collection it creates
  // (see admin/uploadDataset.ts:upsertDatasetCollection), so by_name finds
  // the new row. Filter to the reconciled dataset to skip same-named custom
  // collections.
  const candidates = await ctx.db
    .query('collections')
    .withIndex('by_name', (q) => q.eq('name', newCode))
    .collect();
  const target = candidates.find((c) => c.datasetId === reconciledDatasetId);
  return target?._id ?? collectionId;
}

/**
 * Clear one TRACK's card aggregates for a single deck, so the caller can spend
 * two transactions instead of one. Namespaces are `${deckId}:${state}` (and
 * `${deckId}:${origin}:${state}`), so every possible label has to be cleared.
 *
 * Each track costs `EXTENDED_STATE_LABELS × (1 + ORIGIN_BUCKETS)` component
 * subtransactions, so 30 shared + 30 writing. Doing both in one mutation was
 * 60, double what the recalc migration was sized for; it splits them across
 * scheduled steps for exactly that reason (see
 * migrations/recalcUserCardAggregates).
 *
 * Used by the global backfill and the per-user recalc migrations before they
 * re-insert from the cards table.
 */
export async function clearAggregatesForDeck(
  ctx: MutationCtx,
  deckId: Id<'decks'>,
  track: SchedulingTrack = 'shared',
): Promise<void> {
  // One track-selection up front. The loops below then use identical
  // namespaces for both tracks, so a label or namespace-format change cannot
  // land on one track's branch and miss its twin.
  const { state: stateAggregate, originState: originStateAggregate } =
    TRACK_AGGREGATES[track];

  for (const state of EXTENDED_STATE_LABELS) {
    await stateAggregate.clear(ctx, { namespace: `${deckId}:${state}` });
    for (const origin of ORIGIN_BUCKETS) {
      await originStateAggregate.clear(ctx, {
        namespace: `${deckId}:${origin}:${state}`,
      });
    }
  }
}

/**
 * Delete a card, update both aggregates, and decrement the deck's `cardCount`.
 */
export async function deleteCard(
  ctx: MutationCtx,
  cardId: Id<'cards'>,
): Promise<void> {
  const oldDoc = await ctx.db.get(cardId);
  if (!oldDoc) return;
  await adjustDeckCardCount(ctx, oldDoc.deckId, -1);
  await cardsByStateAndDueDate.deleteIfExists(ctx, oldDoc);
  await cardsByOriginStateAndDueDate.deleteIfExists(ctx, oldDoc);
  if (hasWritingTrack(oldDoc)) {
    await cardsByWritingStateAndDueDate.deleteIfExists(ctx, oldDoc);
    await cardsByOriginWritingStateAndDueDate.deleteIfExists(ctx, oldDoc);
  }
  // AI-feedback accepted alternatives are keyed by card; they die with it.
  // Bounded: WRITING_ALTERNATIVES_MAX per language, a handful of languages.
  const alternatives = await ctx.db
    .query('writingAlternatives')
    .withIndex('by_cardId_and_language', (q) => q.eq('cardId', cardId))
    .take(100);
  for (const alt of alternatives) {
    await ctx.db.delete(alt._id);
  }
  await ctx.db.delete(cardId);
}
