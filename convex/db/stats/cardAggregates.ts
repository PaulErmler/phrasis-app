import { components } from '../../_generated/api';
import { DataModel } from '../../_generated/dataModel';
import { MutationCtx } from '../../_generated/server';
import { TableAggregate } from '@convex-dev/aggregate';
import { Doc, Id } from '../../_generated/dataModel';

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
