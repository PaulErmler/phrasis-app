import { MutationCtx, QueryCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { UNDO_DEPTH } from '../../lib/constants/learning';
import { SchedulingMode, StudyContentFilter } from '../types';

/**
 * Per-(user, course) undo stack for learning-mode reviews and radio plays.
 * Each entry snapshots the card state a review overwrote plus the keys needed
 * to reverse its stat increments (see the `reviewLogs` table in schema.ts).
 * The stack is capped at UNDO_DEPTH entries — `logReview` trims on insert.
 */

type ReviewLogEntry = Omit<Doc<'reviewLogs'>, '_id' | '_creationTime'>;

/**
 * Insert a review log entry, then trim the stack to UNDO_DEPTH entries.
 * Bounded work: each review adds exactly one entry, so the trim deletes at
 * most a couple of rows even if UNDO_DEPTH is later lowered.
 */
export async function logReview(
  ctx: MutationCtx,
  entry: ReviewLogEntry,
): Promise<void> {
  await ctx.db.insert('reviewLogs', entry);
  const newestFirst = await takeLatestReviewLogs(
    ctx,
    entry.userId,
    entry.courseId,
    UNDO_DEPTH + 5,
  );
  for (const stale of newestFirst.slice(UNDO_DEPTH)) {
    await ctx.db.delete(stale._id);
  }
}

/** Newest-first log entries for a (user, course) stack. */
export async function takeLatestReviewLogs(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  n: number,
): Promise<Doc<'reviewLogs'>[]> {
  return ctx.db
    .query('reviewLogs')
    .withIndex('by_userId_and_courseId', (q) =>
      q.eq('userId', userId).eq('courseId', courseId),
    )
    .order('desc')
    .take(n);
}

/**
 * The undoable prefix of the stack: newest-first consecutive entries whose
 * study context matches the CURRENT course settings, stopping at the first
 * mismatch. Entries logged under another mode/filter block everything older
 * beneath them — switching settings back does NOT resurface old entries once
 * newer mismatching reviews sit on top (they only become reachable again if
 * those newer reviews are themselves undone). Shared by getUndoableReviewCount
 * and undoLastReview so the button state and the mutation can't disagree.
 */
export async function takeUndoableLogs(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  currentMode: SchedulingMode,
  currentFilter: StudyContentFilter,
): Promise<Doc<'reviewLogs'>[]> {
  const newestFirst = await takeLatestReviewLogs(ctx, userId, courseId, UNDO_DEPTH);
  const prefix: Doc<'reviewLogs'>[] = [];
  for (const entry of newestFirst) {
    if (
      entry.schedulingMode !== currentMode ||
      entry.studyContentFilter !== currentFilter
    ) {
      break;
    }
    prefix.push(entry);
  }
  return prefix;
}
