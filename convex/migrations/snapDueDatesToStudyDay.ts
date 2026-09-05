import { v, type Infer } from 'convex/values';
import { vOnCompleteArgs } from '@convex-dev/workpool';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { patchCard } from '../db/stats/cardAggregates';
import { getCourseStatsForMutation } from '../db/courseStats';
import { getUserSettings } from '../db/users';
import { seedPool } from '../lib/workpools';
import { trackException } from '../analytics';
import { pickUniqueDueSlot, studyDayFromSettings } from '../lib/dueSlots';
import { fetchTrackCardsAfterDue, trackDueOf } from '../lib/dueQueue';
import {
  isInsideSlotWindow,
  studyDayStart,
  type StudyDay,
} from '../../lib/scheduling';

/**
 * One-off sweep for the study-day due-date change (2026-09-05).
 *
 * Before it, every FSRS due date was the exact instant FSRS computed, so a
 * card rated at 14:07 with a 30-day interval stayed out of a morning-only
 * learner's reach for 30 days. Live reviews now snap day-scale due dates to
 * the start of the study day (lib/scheduling.ts `scheduleCard` +
 * `pickUniqueDueSlot`). This sweep applies the same rule to every card
 * already scheduled into the future, per deck, so the change takes effect
 * at once instead of one review cycle later.
 *
 * Run once after deploy from the dashboard:
 *   npx convex run migrations/snapDueDatesToStudyDay:kickOff --prod
 *
 * Shape, borrowed from seedWritingTrack.ts: batches run on `seedPool` so a
 * batch that throws still reaches its onComplete supervisor, which
 * re-enqueues the same args (a bounded number of times) instead of letting
 * the chain die silently. The batch DOES carry a cursor (`afterDue`), unlike
 * the writing seed: snapped cards move EARLIER and would otherwise sit at
 * the head of the ascending range forever, so restarting from the kick time
 * cannot find the remaining work. The cursor is safe to carry because a
 * failed batch's writes roll back and the supervisor resumes from the same
 * args. A moved card always lands below its own old due date and therefore
 * below the cursor, so it is neither revisited nor lost.
 */

const BATCH_SIZE = 50;
const KICK_PAGE_SIZE = 100;
const MAX_ATTEMPTS = 5;

const batchArgsValidator = v.object({
  deckId: v.id('decks'),
  track: v.union(v.literal('shared'), v.literal('writing')),
  /** Kick time. Cards due at or before it are already available and are
   * never touched; each track's walk starts here. */
  kickTime: v.number(),
  /** Exclusive lower bound of this batch's walk on the track's due date. */
  afterDue: v.number(),
});
type BatchArgs = Infer<typeof batchArgsValidator>;

const completionContextValidator = batchArgsValidator.extend({
  attempts: v.number(),
});

type PoolRunResult =
  | { kind: 'success'; returnValue: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' };

/**
 * Enqueue one shared-track sweep per deck, paging through `decks` by
 * creation time and re-scheduling itself for the next page.
 */
export const kickOff = internalMutation({
  args: { afterCreationTime: v.optional(v.number()) },
  returns: v.object({ enqueued: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const decks = await ctx.db
      .query('decks')
      .withIndex('by_creation_time', (q) =>
        q.gt('_creationTime', args.afterCreationTime ?? 0),
      )
      .order('asc')
      .take(KICK_PAGE_SIZE);

    const now = Date.now();
    for (const deck of decks) {
      await enqueueBatch(
        ctx,
        { deckId: deck._id, track: 'shared', kickTime: now, afterDue: now },
        0,
      );
    }

    if (decks.length === KICK_PAGE_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.snapDueDatesToStudyDay.kickOff,
        { afterCreationTime: decks[decks.length - 1]._creationTime },
      );
      return { enqueued: decks.length, isDone: false };
    }
    return { enqueued: decks.length, isDone: true };
  },
});

/**
 * Snap one page of a deck's future-due cards on one track. Walks the
 * track's due index ascending from `afterDue`; a card is moved when it has
 * a day-scale FSRS interval and does not already sit inside its study day's
 * slot window. Overdue cards (due <= kick time) are never touched: they are
 * already available.
 *
 * The study day is the same rule `reviewCard` applies
 * (`studyDayFromSettings`): the learner's `userSettings`, with the zone as
 * last recorded on `courseStats` (refreshed on every review). UTC when the
 * course was never reviewed, in which case there is nothing day-scale to
 * move anyway. A learner with `dueByDay: false` is skipped entirely.
 */
export const processBatch = internalMutation({
  args: batchArgsValidator.fields,
  returns: v.object({ snapped: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const studyDay = await resolveDeckStudyDay(ctx, args.deckId);
    if (!studyDay) return { snapped: 0, isDone: true };

    const page = await fetchTrackCardsAfterDue(
      ctx,
      args.deckId,
      args.track,
      args.afterDue,
      BATCH_SIZE,
    );
    let snapped = 0;
    for (const card of page) {
      const due = trackDueOf(card, args.track);
      const fsrsState =
        args.track === 'writing' ? card.writingFsrsState : card.fsrsState;
      if (!fsrsState || fsrsState.scheduledDays < 1) continue;
      if (isInsideSlotWindow(due, studyDay)) continue;

      const slot = await pickUniqueDueSlot(
        ctx,
        args.deckId,
        args.track,
        studyDayStart(due, studyDay),
      );
      if (slot === null) continue; // window full; the card keeps its instant
      await patchCard(
        ctx,
        card._id,
        args.track === 'writing' ? { writingDueDate: slot } : { dueDate: slot },
        card,
      );
      snapped++;
    }

    if (page.length === BATCH_SIZE) {
      await enqueueBatch(
        ctx,
        { ...args, afterDue: trackDueOf(page[page.length - 1], args.track) },
        0,
      );
      return { snapped, isDone: false };
    }
    if (args.track === 'shared') {
      // Shared track exhausted: walk the writing track from the kick time
      // (NOT from the shared cursor, which has moved on). Cards without a
      // writing track have no writingDueDate and fall outside the range.
      await enqueueBatch(
        ctx,
        { ...args, track: 'writing', afterDue: args.kickTime },
        0,
      );
      return { snapped, isDone: false };
    }
    return { snapped, isDone: true };
  },
});

/**
 * Guaranteed completion callback (see seedWritingTrack.onSeedBatchComplete
 * for why the param types are written out). A failed batch is re-enqueued
 * with the same cursor up to MAX_ATTEMPTS times, then reported.
 */
export const onBatchComplete = internalMutation({
  args: vOnCompleteArgs(completionContextValidator),
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    {
      context,
      result,
    }: {
      workId: string;
      context: Infer<typeof completionContextValidator>;
      result: PoolRunResult;
    },
  ) => {
    if (result.kind !== 'failed') return null;
    const { attempts, ...batch } = context;
    const nextAttempt = attempts + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      await trackException(
        ctx,
        new Error(
          `study-day snap gave up after ${nextAttempt} failed batches: ${result.error}`,
        ),
        undefined,
        {
          deckId: batch.deckId,
          track: batch.track,
          afterDue: batch.afterDue,
          source: 'snapDueDatesToStudyDay.onBatchComplete',
        },
      );
      return null;
    }
    await enqueueBatch(ctx, batch, nextAttempt);
    return null;
  },
});

async function enqueueBatch(
  ctx: MutationCtx,
  batch: BatchArgs,
  attempts: number,
): Promise<void> {
  await seedPool.enqueueMutation(
    ctx,
    internal.migrations.snapDueDatesToStudyDay.processBatch,
    batch,
    {
      onComplete: internal.migrations.snapDueDatesToStudyDay.onBatchComplete,
      context: { ...batch, attempts },
    },
  );
}

async function resolveDeckStudyDay(
  ctx: MutationCtx,
  deckId: Id<'decks'>,
): Promise<StudyDay | undefined> {
  const deck = await ctx.db.get(deckId);
  if (!deck) return undefined;
  const course = await ctx.db.get(deck.courseId);
  if (!course) return undefined;
  const [settings, stats] = await Promise.all([
    getUserSettings(ctx, course.userId),
    getCourseStatsForMutation(ctx, course.userId, course._id),
  ]);
  return studyDayFromSettings(settings, stats?.timezone ?? 'UTC');
}
