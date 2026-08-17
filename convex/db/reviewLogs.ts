import { MutationCtx, QueryCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { UNDO_DEPTH } from '../../lib/constants/learning';
import {
  freePlayFace,
  schedulingTrackFromSettings,
  type FreePlayFace,
  type SchedulingMode,
  type SchedulingTrack,
  type StudyContentFilter,
} from '../types';

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
 * The study context an undo is scoped to. `face` disambiguates the two free-play
 * rotations, which share one `schedulingMode` but keep separate per-card counters
 * — undo must not pop a listening play while the user is looking at the typing
 * queue, since restoring `radio*` counters would leave the visible queue
 * unchanged. Null outside free play.
 */
export type StudyContext = {
  schedulingMode: SchedulingMode;
  face: FreePlayFace | null;
  studyContentFilter: StudyContentFilter;
  /** Which per-card schedule 'review' entries currently target — 'writing'
   * iff separateModeTracking is on and the course is in Writing mode. Scopes
   * undo the same way `face` does for free play: undoing a shared-track
   * review while looking at the writing queue would not change what's on
   * screen. Ignored for free-play entries. */
  track: SchedulingTrack;
};

/** Resolve the undo/queue scope from course settings, defaults included. The
 *  single place this defaulting lives, so the count query and the mutation
 *  can't drift apart. */
export function studyContextFromSettings(
  settings: Doc<'courseSettings'> | null,
): StudyContext {
  const schedulingMode: SchedulingMode =
    settings?.schedulingMode ?? 'learnAndReview';
  return {
    schedulingMode,
    face: freePlayFace(schedulingMode, settings?.reviewMode ?? 'audio'),
    studyContentFilter: settings?.studyContentFilter ?? 'both',
    track: schedulingTrackFromSettings({
      separateModeTracking: settings?.separateModeTracking,
      reviewMode: settings?.reviewMode,
    }),
  };
}

/**
 * The undoable prefix of the stack: newest-first consecutive entries whose
 * study context matches the CURRENT course settings, stopping at the first
 * mismatch. Entries logged under another mode/face/filter block everything
 * older beneath them — switching settings back does NOT resurface old entries
 * once newer mismatching reviews sit on top (they only become reachable again
 * if those newer reviews are themselves undone). Shared by
 * getUndoableReviewCount and undoLastReview so the button state and the
 * mutation can't disagree.
 *
 * Note that merely toggling review mode logs nothing, so flipping between the
 * free-play faces and back leaves the stack intact — a boundary only forms
 * once a card is actually played in the other face.
 */
export async function takeUndoableLogs(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  current: StudyContext,
): Promise<Doc<'reviewLogs'>[]> {
  const newestFirst = await takeLatestReviewLogs(ctx, userId, courseId, UNDO_DEPTH);
  const prefix: Doc<'reviewLogs'>[] = [];
  for (const entry of newestFirst) {
    if (
      entry.schedulingMode !== current.schedulingMode ||
      entry.studyContentFilter !== current.studyContentFilter ||
      // `kind` IS the free-play face ('radio' | 'freeStudy'); 'review' entries
      // belong to the FSRS modes and are scoped by schedulingMode + track.
      (entry.kind !== 'review' && entry.kind !== current.face) ||
      // Entries from before the track field existed are all shared-track.
      (entry.kind === 'review' && (entry.track ?? 'shared') !== current.track)
    ) {
      break;
    }
    prefix.push(entry);
  }
  return prefix;
}
