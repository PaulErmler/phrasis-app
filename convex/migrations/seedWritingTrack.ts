import { v, Infer } from 'convex/values';
import { vOnCompleteArgs } from '@convex-dev/workpool';
import { internalMutation, MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';
import { getCourseSettings } from '../db/courseSettings';
import { patchCard } from '../db/stats/cardAggregates';
import { seedPool } from '../lib/workpools';
import { trackException } from '../analytics';

const BATCH_SIZE = 50;

/** How long a scheduled sweep "owns" the seed before a re-kick may schedule
 * another one. Debounce only — sweeps are idempotent, this just keeps rapid
 * settings saves / lazy-seed reviews from piling up overlapping rescans. */
const SEED_KICK_DEBOUNCE_MS = 5 * 60 * 1000;

/** Consecutive failed batches before the sweep gives up and reports. Failures
 * are counted, not retried forever: a batch that fails five times in a row is
 * failing for a reason a sixth attempt won't fix, and a silent infinite
 * re-enqueue loop is worse than a reported stall. Reset on any success. */
const MAX_SEED_ATTEMPTS = 5;

/** Bounded deck fan-out. The product model is one deck per course; the cap
 * only guards against a pathological future fan-out. */
const MAX_DECKS = 100;

/** onComplete context: the batch carries no state, so the course id is all the
 * supervisor needs to re-enqueue an equivalent batch. */
const seedCompletionContextValidator = v.object({
  courseId: v.id('courses'),
});

// Same shape the other pool consumers declare (llmTranslationQueue,
// ttsProcessing) — see their note on why handler params are typed explicitly
// rather than inferred through the generated `internal` object.
type PoolRunResult =
  | { kind: 'success'; returnValue: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' };

/**
 * Seed the writing track (separateModeTracking) for every card in a course.
 *
 * Each unseeded card's `writing*` fields become a copy of its shared
 * scheduling state, so nothing is suddenly due and the two tracks diverge from
 * a common starting point.
 *
 * ## Why this is stateless
 *
 * Progress lives ENTIRELY in the cards themselves — there is no cursor, no
 * deck index, and no chain position in the args. Each batch locates its own
 * remaining work through `by_deck_writingDue`, where an unset `writingDueDate`
 * sorts before every number and is therefore directly reachable.
 *
 * That is the whole reliability story. The previous design threaded a
 * pagination cursor through `ctx.scheduler.runAfter`, which made the chain a
 * single point of failure: the continuation was written in the same
 * transaction as the batch, so one throw lost both the work AND the position,
 * and nothing could resume it (the lazy-seed re-kick in `reviewCard` can never
 * fire while zero cards are seeded, because every writing due query excludes
 * unseeded cards). Now any kick from anywhere resumes exactly where the last
 * one stopped, overlapping sweeps find nothing to do, and a batch that dies
 * costs only that batch.
 *
 * Idempotent and re-runnable: cards that already carry a writing track — from
 * a previous enable (the split's disable is freeze-and-keep), from creation
 * (`createCardsFromTexts` seeds while the split is on), or from a `reviewCard`
 * lazy seed — are simply not returned by the query.
 *
 * Runs on `seedPool` rather than the scheduler so that a failed batch still
 * reaches `onSeedBatchComplete` (see convex/lib/workpools.ts).
 */
export const processBatch = internalMutation({
  args: { courseId: v.id('courses') },
  returns: v.object({ seeded: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    // Abort if the user toggled the split back off — the seed would only be
    // wasted writes then (cards already seeded stay seeded; that's the
    // freeze-and-keep contract, and re-enabling starts a fresh sweep).
    const settings = await getCourseSettings(ctx, args.courseId);
    if (settings?.separateModeTracking !== true) {
      return { seeded: 0, isDone: true };
    }

    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
      .take(MAX_DECKS);

    let seeded = 0;
    for (const deck of decks) {
      // Unseeded cards sort first, so the head of this index IS the remaining
      // work. Hidden and mastered cards are included on purpose — they can be
      // unhidden or demastered later, and the writing track has to exist by
      // then.
      const page = await ctx.db
        .query('cards')
        .withIndex('by_deck_writingDue', (q) => q.eq('deckId', deck._id))
        .order('asc')
        .take(BATCH_SIZE);

      const todo = page.filter((card) => card.writingDueDate === undefined);
      if (todo.length === 0) continue;

      for (const card of todo) {
        await patchCard(ctx, card._id, writingSeedPatch(card), card);
      }
      seeded = todo.length;
      break; // one deck's worth per batch — keeps the transaction small
    }

    // Termination: re-enqueue whenever we seeded anything, and mark done ONLY
    // when a pass over every deck found nothing left. Do NOT key this on
    // whether the batch filled up — a run that finishes a deck without filling
    // its batch may still leave work in the next deck. The cost is one extra
    // no-op pass at the end, which is the price of carrying no state.
    if (seeded > 0) {
      await enqueueSeedBatch(ctx, args.courseId);
      return { seeded, isDone: false };
    }

    await markSeedDone(ctx, args.courseId);
    return { seeded: 0, isDone: true };
  },
});

/**
 * Guaranteed completion callback for every `processBatch` job — fires on
 * success, failure, and cancellation.
 *
 * Explicit handler param types (rather than inferring through the generated
 * `internal` object) for the same reason as llmTranslationQueue.ts: this file's
 * handlers reference same-file functions via `internal.…`, and letting TS infer
 * through that is circular.
 */
export const onSeedBatchComplete = internalMutation({
  args: vOnCompleteArgs(seedCompletionContextValidator),
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    {
      context,
      result,
    }: {
      workId: string;
      context: Infer<typeof seedCompletionContextValidator>;
      result: PoolRunResult;
    },
  ) => {
    const { courseId } = context;

    if (result.kind === 'canceled') return null;

    const settings = await getCourseSettings(ctx, courseId);
    if (!settings) return null;

    if (result.kind === 'success') {
      // Clear the failure streak — the successor batch (if any) was already
      // enqueued by the batch itself.
      if (settings.writingSeedAttempts !== undefined) {
        await ctx.db.patch(settings._id, { writingSeedAttempts: undefined });
      }
      return null;
    }

    // Failure. Because batches are stateless, re-enqueueing the SAME args
    // resumes correctly — the retry relocates the remaining work itself.
    const attempts = (settings.writingSeedAttempts ?? 0) + 1;
    await ctx.db.patch(settings._id, { writingSeedAttempts: attempts });

    if (attempts >= MAX_SEED_ATTEMPTS) {
      // Give up rather than loop forever, and make it visible — a stalled seed
      // leaves the course on the "preparing writing" state, which used to fail
      // completely silently.
      await trackException(
        ctx,
        new Error(
          `writing-track seed gave up after ${attempts} failed batches: ${result.error}`,
        ),
        undefined,
        { courseId, source: 'seedWritingTrack.onSeedBatchComplete' },
      );
      return null;
    }

    await seedPool.enqueueMutation(
      ctx,
      internal.migrations.seedWritingTrack.processBatch,
      { courseId },
      {
        onComplete: internal.migrations.seedWritingTrack.onSeedBatchComplete,
        context: { courseId },
      },
    );
    return null;
  },
});

/** Enqueue one seed batch with its supervisor attached. Single place that
 * knows the pool wiring, so the batch's self-continuation and the failure
 * retry can never drift apart. */
async function enqueueSeedBatch(ctx: MutationCtx, courseId: Id<'courses'>) {
  await seedPool.enqueueMutation(
    ctx,
    internal.migrations.seedWritingTrack.processBatch,
    { courseId },
    {
      onComplete: internal.migrations.seedWritingTrack.onSeedBatchComplete,
      context: { courseId },
    },
  );
}

/** The copy-of-shared-schedule patch the sweep writes for one unseeded card.
 * Exported so `reviewCard`'s lazy seed reads its baseline from the SAME
 * helper — one formula, so the two seeding paths can't diverge. */
export function writingSeedPatch(card: Doc<'cards'>): Partial<Doc<'cards'>> {
  const neverReviewed =
    card.schedulingPhase === 'preReview' && card.preReviewCount === 0;
  return {
    writingDueDate: card.dueDate,
    writingFsrsState: card.fsrsState,
    // Explicit false (not undefined) — the learn_new writing index matches on
    // eq(writingIsGraduated, false).
    writingIsGraduated: card.isGraduated ?? false,
    // Only carried over for cards that were actually reviewed: free play also
    // stamps `lastReviewedAt` on mere plays, and copying that onto a
    // never-reviewed card would make it look review-touched on the writing
    // track (the same trap the shared "never reviewed" check avoids by using
    // phase+count instead of the timestamp).
    writingLastReviewedAt: neverReviewed ? undefined : card.lastReviewedAt,
    writingGoodReviewCount: card.goodReviewCount,
  };
}

async function markSeedDone(ctx: MutationCtx, courseId: Id<'courses'>) {
  const settings = await getCourseSettings(ctx, courseId);
  if (settings && settings.writingSeedDone !== true) {
    await ctx.db.patch(settings._id, {
      writingSeedDone: true,
      writingSeedAttempts: undefined,
    });
  }
}

/**
 * Schedule the seed sweep if the course needs one. The single entry point —
 * called from `updateCourseSettings` (on the enable transition with
 * `force: true`, and on every later save while the split is on) and from
 * `reviewCard` when it lazy-seeds a card the sweep hasn't reached.
 *
 * Both callers pass the already-loaded settings doc, so the check costs no
 * extra read; the debounce stamp keeps repeated kicks from piling up
 * overlapping (idempotent but wasteful) sweeps.
 *
 * These kicks are a convenience, not the recovery mechanism. Recovery lives in
 * `onSeedBatchComplete`, which fires even when a batch throws — and works at
 * all only because batches carry no state (see `processBatch`).
 */
export async function maybeScheduleWritingSeed(
  ctx: MutationCtx,
  settings: Doc<'courseSettings'>,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (settings.separateModeTracking !== true) return false;
  if (settings.writingSeedDone === true) return false;
  const now = Date.now();
  if (
    !opts?.force &&
    settings.writingSeedStartedAt !== undefined &&
    now - settings.writingSeedStartedAt < SEED_KICK_DEBOUNCE_MS
  ) {
    return false;
  }
  // A manual kick is a fresh start: clear the failure streak so a course that
  // previously exhausted its attempts can be retried.
  await ctx.db.patch(settings._id, {
    writingSeedStartedAt: now,
    writingSeedAttempts: undefined,
  });
  await enqueueSeedBatch(ctx, settings.courseId);
  return true;
}
