import { components } from '../../_generated/api';
import { DataModel } from '../../_generated/dataModel';
import { MutationCtx } from '../../_generated/server';
import { TableAggregate } from '@convex-dev/aggregate';
import { Doc, Id } from '../../_generated/dataModel';
import { LEGACY_TO_NEW_CODE } from '../../lib/collections';

// ============================================================================
// State label helpers
// ============================================================================

import { FSRS_STATE_LABELS } from '../../lib/fsrsStates';

/**
 * Derive a single state label for a card document.
 * Priority: hidden > mastered > FSRS state (or preReview).
 */
export function getCardStateLabel(doc: Doc<'cards'>): string {
  if (doc.isHidden) return 'hidden';
  if (doc.isMastered) return 'mastered';
  if (doc.schedulingPhase === 'preReview') return 'new';
  return FSRS_STATE_LABELS[doc.fsrsState?.state ?? 0] ?? 'new';
}

// ============================================================================
// Aggregate instances
// ============================================================================

/**
 * Cards grouped by [deckId, stateLabel].
 * Enables O(log n) counts like: how many cards in "learning" state for a deck.
 */
export const cardsByState = new TableAggregate<{
  Namespace: string; // deckId as string
  Key: string; // state label
  DataModel: DataModel;
  TableName: 'cards';
}>(components.cardsByState, {
  namespace: (doc) => doc.deckId,
  sortKey: (doc) => getCardStateLabel(doc),
});

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
 * Cards sorted by [deckId, dueDate].
 * Enables O(log n) count of due cards: count where dueDate <= now.
 */
export const cardsByDueDate = new TableAggregate<{
  Namespace: string; // deckId as string
  Key: number; // dueDate timestamp
  DataModel: DataModel;
  TableName: 'cards';
}>(components.cardsByDueDate, {
  namespace: (doc) => doc.deckId,
  sortKey: (doc) => doc.dueDate,
});

// ============================================================================
// Card write helpers (wrap ctx.db calls + aggregate sync)
// ============================================================================

/**
 * Insert a card and update both aggregates.
 */
export async function insertCard(
  ctx: MutationCtx,
  data: Omit<Doc<'cards'>, '_id' | '_creationTime'>,
): Promise<Id<'cards'>> {
  const id = await ctx.db.insert('cards', data);
  const doc = (await ctx.db.get(id))!;
  await cardsByState.insertIfDoesNotExist(ctx, doc);
  await cardsByDueDate.insertIfDoesNotExist(ctx, doc);
  await cardsByStateAndDueDate.insertIfDoesNotExist(ctx, doc);
  return id;
}

/**
 * Patch a card and update both aggregates.
 *
 * Pass `oldDoc` when the caller has already fetched the card — saves a read
 * on the hot path. The post-patch doc is computed in memory instead of being
 * re-read; the aggregates only key on fields that are deterministic from
 * `oldDoc + patch` (deckId, dueDate, isHidden, isMastered, schedulingPhase,
 * fsrsState).
 *
 * Also bumps `collectionProgress.cardsMastered` on the false → true mastery
 * transition. The counter is strictly monotonic — true → false (demaster) is
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
  await cardsByState.replaceOrInsert(ctx, resolvedOld, newDoc);
  await cardsByDueDate.replaceOrInsert(ctx, resolvedOld, newDoc);
  await cardsByStateAndDueDate.replaceOrInsert(ctx, resolvedOld, newDoc);

  if (!resolvedOld.isMastered && newDoc.isMastered && newDoc.collectionId) {
    await bumpCardsMastered(ctx, newDoc.deckId, newDoc.collectionId);
  }
}

/**
 * Bump `cardsMastered` on the matching collectionProgress row. Looks up the
 * (userId, courseId) pair via the card's deck. Idempotency is the caller's
 * responsibility — only call on actual false → true transitions.
 *
 * Post-cutover redirect: if the card's collection is one of the seven legacy
 * CEFR rows AND the user has been reconciled to a new dataset, we bump the
 * rolled-forward destination collection's row instead. This keeps masteries
 * on pre-cutover cards (whose `collectionId` still points at the legacy row)
 * visible on the new home view. If the lookup fails at any step we fall back
 * to bumping the legacy row — never silently drop the increment.
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
  // Skip if no row exists — `updateCollectionProgress` always creates the
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
 * collection AND the user's course has been reconciled to a new dataset —
 * then returns the rolled-forward destination collection's id.
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
  // seven legacy CEFR rows. Also require `datasetId` to be absent — a new
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
 * Delete a card and update both aggregates.
 */
export async function deleteCard(
  ctx: MutationCtx,
  cardId: Id<'cards'>,
): Promise<void> {
  const oldDoc = await ctx.db.get(cardId);
  if (!oldDoc) return;
  await cardsByState.deleteIfExists(ctx, oldDoc);
  await cardsByDueDate.deleteIfExists(ctx, oldDoc);
  await cardsByStateAndDueDate.deleteIfExists(ctx, oldDoc);
  await ctx.db.delete(cardId);
}
