import { MutationCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';

/**
 * Permanent per-review event log (`reviewHistory` table). One row per GRADED
 * review, written by `reviewCard` next to the undo-stack entry and revoked by
 * `undoLastReview` when that review is undone. Unlike `reviewLogs` (a capped
 * undo stack) rows here are never trimmed; see the table definition in
 * schema.ts for field semantics.
 */

export type ReviewHistoryEntry = Omit<
  Doc<'reviewHistory'>,
  '_id' | '_creationTime'
>;

export async function insertReviewHistory(
  ctx: MutationCtx,
  entry: ReviewHistoryEntry,
): Promise<Id<'reviewHistory'>> {
  return ctx.db.insert('reviewHistory', entry);
}
