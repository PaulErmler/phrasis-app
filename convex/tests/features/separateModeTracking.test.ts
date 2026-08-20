/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import type { WorkId } from '@convex-dev/workpool';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { FsrsState } from '../../types';

import {
  drainScheduler,
  drainSchedulerAfterEach,
} from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

// The enable-time seeding fans out through 0ms scheduler hops.
drainSchedulerAfterEach();

function makeFsrsState(overrides: Partial<FsrsState> = {}): FsrsState {
  const now = Date.now();
  return {
    due: now - 1000,
    stability: 5,
    difficulty: 4,
    elapsedDays: 1,
    scheduledDays: 3,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    state: 2, // Review
    lastReview: now - 86_400_000,
    ...overrides,
  };
}

/**
 * Seed a user + course + settings + stats + deck, plus N cards (one text
 * each). Card fields beyond the defaults come from `cardOverrides[i]`.
 */
async function seedCourse(
  t: TestConvex<typeof schema>,
  opts: {
    settings?: Partial<Doc<'courseSettings'>>;
    cards?: Array<Partial<Doc<'cards'>>>;
  } = {},
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    await ctx.db.insert('courseStats', {
      userId: 'user_A',
      courseId,
      totalRepetitions: 0,
      totalTimeMs: 0,
      totalCards: 0,
      currentStreak: 0,
    });
    const settingsId = await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 5,
      ...opts.settings,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: opts.cards?.length ?? 1,
    });

    const cardSpecs = opts.cards ?? [{}];
    const cardIds: Id<'cards'>[] = [];
    for (let i = 0; i < cardSpecs.length; i++) {
      const textId = await ctx.db.insert('texts', {
        text: `Hola ${i}`,
        language: 'es',
        userCreated: true,
        userId: 'user_A',
        collectionId,
        collectionRank: i + 1,
      });
      cardIds.push(
        await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
          ...cardSpecs[i],
        }),
      );
    }
    return { courseId, deckId, settingsId, cardIds };
  });
}

// The pool stamps a branded WorkId on every job. The seed's onComplete handler
// ignores it. Batches are stateless, so there is nothing to correlate, and
// tests only need a placeholder that satisfies the brand.
const FAKE_WORK_ID = 'work_test' as WorkId;

const getCard = (t: TestConvex<typeof schema>, cardId: Id<'cards'>) =>
  t.run(async (ctx) => (await ctx.db.get(cardId))!);

describe('separateModeTracking', () => {
  describe('enable-time seeding', () => {
    it('seeds every card with a copy of its shared schedule', async () => {
      const t = convexTest(schema, modules);
      const fsrs = makeFsrsState();
      const { courseId, cardIds } = await seedCourse(t, {
        cards: [
          {}, // fresh preReview card
          {
            dueDate: 123_456,
            schedulingPhase: 'review',
            fsrsState: fsrs,
            isGraduated: true,
            lastReviewedAt: 42,
            goodReviewCount: 2,
          },
        ],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        separateModeTracking: true,
      });
      await drainScheduler();

      const fresh = await getCard(t, cardIds[0]);
      expect(fresh.writingDueDate).toBe(fresh.dueDate);
      expect(fresh.writingFsrsState).toBeUndefined();
      expect(fresh.writingIsGraduated).toBe(false);
      expect(fresh.writingLastReviewedAt).toBeUndefined();

      const mature = await getCard(t, cardIds[1]);
      expect(mature.writingDueDate).toBe(123_456);
      expect(mature.writingFsrsState).toEqual(fsrs);
      expect(mature.writingIsGraduated).toBe(true);
      expect(mature.writingLastReviewedAt).toBe(42);
      expect(mature.writingGoodReviewCount).toBe(2);
    });

    it('marks the seed done and does not carry lastReviewedAt onto never-reviewed cards', async () => {
      const t = convexTest(schema, modules);
      const { courseId, settingsId, cardIds } = await seedCourse(t, {
        cards: [
          // Never actually reviewed, but free play stamped lastReviewedAt.
          { lastReviewedAt: 999 },
          // Genuinely reviewed once (left preReview count 0 behind).
          { preReviewCount: 1, lastReviewedAt: 1234 },
        ],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        separateModeTracking: true,
      });
      await drainScheduler();

      // A free-play-only card must NOT look review-touched on the writing
      // track. That would permanently suppress the "first review" counters.
      const freePlayed = await getCard(t, cardIds[0]);
      expect(freePlayed.writingLastReviewedAt).toBeUndefined();
      const reviewed = await getCard(t, cardIds[1]);
      expect(reviewed.writingLastReviewedAt).toBe(1234);

      const settings = await t.run(
        async (ctx) => (await ctx.db.get(settingsId))!,
      );
      expect(settings.writingSeedDone).toBe(true);
    });

    it('a settings save while the split is on resumes an unfinished seed', async () => {
      const t = convexTest(schema, modules);
      // Simulate a seed whose scheduler chain died: flag already on,
      // writingSeedDone never set, cards unseeded. (No transition happens on
      // the next save, so pre-fix this stranded the cards forever.)
      const { courseId, settingsId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true },
        cards: [{}, {}],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        showRomanization: true, // unrelated save, flag stays on
      });
      await drainScheduler();

      for (const cardId of cardIds) {
        const card = await getCard(t, cardId);
        expect(card.writingDueDate).toBe(card.dueDate);
      }
      const settings = await t.run(
        async (ctx) => (await ctx.db.get(settingsId))!,
      );
      expect(settings.writingSeedDone).toBe(true);
    });

    it('reports preparing_writing instead of all_caught_up while the seed is unfinished', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [{ dueDate: Date.now() - 5000 }], // due but unseeded
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      // Unseeded cards are excluded from the writing queue…
      expect(
        await asUser.query(api.features.scheduling.getCardForReview, {}),
      ).toBeNull();
      // …and the empty reason must say the seed is still preparing, not lie
      // with "all caught up".
      const reason = await asUser.query(
        api.features.scheduling.getCardForReviewEmptyReason,
        {},
      );
      expect(reason).toEqual({ reason: 'preparing_writing' });
    });

    // The seed carries NO state between batches. It relocates its remaining
    // work through `by_deck_writingDue` each run. That is what makes a lost
    // batch survivable, so it is asserted directly: run one batch, then invoke
    // the next with nothing but the courseId and expect it to pick up exactly
    // where the first stopped.
    it('resumes from card state alone, with no cursor carried between batches', async () => {
      const t = convexTest(schema, modules);
      const { courseId, settingsId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true },
        cards: [{}, {}, {}],
      });

      // Seed the first card by hand, as a completed batch would have.
      await t.run(async (ctx) => {
        const card = (await ctx.db.get(cardIds[0]))!;
        await ctx.db.patch(cardIds[0], {
          writingDueDate: card.dueDate,
          writingIsGraduated: false,
        });
      });

      // A fresh batch, given only the courseId, finishes the rest.
      await t.mutation(
        internal.migrations.seedWritingTrack.processBatch,
        { courseId },
      );
      await drainScheduler();

      for (const cardId of cardIds) {
        const card = await getCard(t, cardId);
        expect(card.writingDueDate).toBe(card.dueDate);
      }
      const settings = await t.run(
        async (ctx) => (await ctx.db.get(settingsId))!,
      );
      expect(settings.writingSeedDone).toBe(true);
    });

    // Hidden and mastered cards are excluded from every writing DUE index, but
    // they must still be seeded. They can be unhidden or demastered later, at
    // which point the track has to already exist. The seeding index
    // (`by_deck_writingDue`) deliberately has nothing between deckId and
    // writingDueDate for this reason.
    it('seeds hidden and mastered cards too', async () => {
      const t = convexTest(schema, modules);
      const { courseId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true },
        cards: [{ isHidden: true }, { isMastered: true }, {}],
      });

      await t.mutation(
        internal.migrations.seedWritingTrack.processBatch,
        { courseId },
      );
      await drainScheduler();

      for (const cardId of cardIds) {
        const card = await getCard(t, cardId);
        expect(card.writingDueDate).toBe(card.dueDate);
      }
    });

    // A batch that throws still reaches its onComplete (that is the whole
    // reason the sweep runs on a workpool), and because batches are stateless
    // the supervisor can resume by re-enqueueing the same args.
    it('recovers from a failed batch via the onComplete supervisor', async () => {
      const t = convexTest(schema, modules);
      const { courseId, settingsId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true },
        cards: [{}, {}],
      });

      // Simulate the batch dying before it seeded anything: nothing ran, so
      // the failure callback is the only thing left holding the chain.
      await t.mutation(
        internal.migrations.seedWritingTrack.onSeedBatchComplete,
        {
          workId: FAKE_WORK_ID,
          context: { courseId },
          result: { kind: 'failed', error: 'simulated batch failure' },
        },
      );
      await drainScheduler();

      for (const cardId of cardIds) {
        const card = await getCard(t, cardId);
        expect(card.writingDueDate).toBe(card.dueDate);
      }
      const settings = await t.run(
        async (ctx) => (await ctx.db.get(settingsId))!,
      );
      expect(settings.writingSeedDone).toBe(true);
    });

    it('stops re-enqueueing once the failure cap is reached', async () => {
      const t = convexTest(schema, modules);
      const { courseId, settingsId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, writingSeedAttempts: 4 },
        cards: [{}],
      });

      await t.mutation(
        internal.migrations.seedWritingTrack.onSeedBatchComplete,
        {
          workId: FAKE_WORK_ID,
          context: { courseId },
          result: { kind: 'failed', error: 'simulated batch failure' },
        },
      );
      await drainScheduler();

      // Gave up rather than looping: no retry ran, so nothing was seeded.
      const card = await getCard(t, cardIds[0]);
      expect(card.writingDueDate).toBeUndefined();
      const settings = await t.run(
        async (ctx) => (await ctx.db.get(settingsId))!,
      );
      expect(settings.writingSeedAttempts).toBe(5);
      expect(settings.writingSeedDone).toBeUndefined();
    });

    // Free Study resolves to track 'writing' too (same settings combination),
    // but it serves from the free-play rotation and never reads the writing
    // queue, so a seed in progress says nothing about why its rotation is
    // empty, and must not hide the real empty state behind a spinner.
    it('does not report preparing_writing in Free Study', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t, {
        settings: {
          separateModeTracking: true,
          reviewMode: 'full',
          schedulingMode: 'radio',
          studyContentFilter: 'course',
        },
        // Custom-origin card: excluded by the 'course' filter, so the
        // free-play rotation is empty for a reason that is not the seed.
        cards: [{ collectionOrigin: 'custom', dueDate: Date.now() - 5000 }],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const reason = await asUser.query(
        api.features.scheduling.getCardForReviewEmptyReason,
        {},
      );
      expect(reason).not.toEqual({ reason: 'preparing_writing' });
    });

    it('re-enable seeds only unseeded cards and preserves the frozen track', async () => {
      const t = convexTest(schema, modules);
      const frozen = makeFsrsState({ reps: 9 });
      const { courseId, cardIds } = await seedCourse(t, {
        cards: [
          // Card seeded during a previous enable, since diverged.
          {
            writingDueDate: 777,
            writingFsrsState: frozen,
            writingIsGraduated: true,
            writingLastReviewedAt: 55,
          },
          // Card created while the split was off.
          {},
        ],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        separateModeTracking: true,
      });
      await drainScheduler();

      const kept = await getCard(t, cardIds[0]);
      expect(kept.writingDueDate).toBe(777);
      expect(kept.writingFsrsState).toEqual(frozen);
      expect(kept.writingLastReviewedAt).toBe(55);

      const seeded = await getCard(t, cardIds[1]);
      expect(seeded.writingDueDate).toBe(seeded.dueDate);
    });
  });

  describe('reviewCard track routing', () => {
    it('writing review (split on) writes only the writing fields', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [{ writingDueDate: Date.now() - 1000, writingIsGraduated: false }],
      });
      const before = await getCard(t, cardIds[0]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        forceReviewPhase: true,
      });

      const after = await getCard(t, cardIds[0]);
      // Shared SCHEDULE untouched. (`lastReviewedAt` is the track-agnostic
      // activity timestamp. The Library sorts on it, so a writing review
      // does stamp it, like free play does.)
      expect(after.dueDate).toBe(before.dueDate);
      expect(after.schedulingPhase).toBe('preReview');
      expect(after.preReviewCount).toBe(0);
      expect(after.fsrsState).toBeUndefined();
      expect(after.lastReviewedAt).toBeDefined();
      expect(after.goodReviewCount).toBeUndefined();
      // Writing track advanced.
      expect(after.writingFsrsState?.reps).toBe(1);
      expect(after.writingDueDate).toBeGreaterThan(before.writingDueDate!);
      expect(after.writingLastReviewedAt).toBeDefined();
      expect(after.writingGoodReviewCount).toBe(1);
    });

    it('audio review (split on) writes only the shared fields', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'audio' },
        cards: [{ writingDueDate: Date.now() - 1000, writingIsGraduated: false }],
      });
      const before = await getCard(t, cardIds[0]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'stillLearning',
        timezone: 'UTC',
        reviewMode: 'audio',
      });

      const after = await getCard(t, cardIds[0]);
      expect(after.preReviewCount).toBe(1);
      expect(after.lastReviewedAt).toBeDefined();
      // Writing track untouched.
      expect(after.writingDueDate).toBe(before.writingDueDate);
      expect(after.writingFsrsState).toBeUndefined();
      expect(after.writingLastReviewedAt).toBeUndefined();
    });

    it('lazy-seeds an unseeded card from a copy of the shared schedule', async () => {
      const t = convexTest(schema, modules);
      const fsrs = makeFsrsState({ reps: 3 });
      const { cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [
          {
            schedulingPhase: 'review',
            fsrsState: fsrs,
            isGraduated: true,
            goodReviewCount: 2,
          },
        ],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        forceReviewPhase: true,
      });

      const after = await getCard(t, cardIds[0]);
      // Copy-then-review: the writing track continues from the shared state.
      expect(after.writingFsrsState?.reps).toBe(4);
      expect(after.writingIsGraduated).toBe(true);
      expect(after.writingGoodReviewCount).toBe(3);
      // Shared untouched.
      expect(after.fsrsState).toEqual(fsrs);
      expect(after.goodReviewCount).toBe(2);
    });

    it('split off: writing-mode reviews keep writing the shared schedule', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedCourse(t, {
        settings: { reviewMode: 'full' },
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        forceReviewPhase: true,
      });

      const after = await getCard(t, cardIds[0]);
      expect(after.fsrsState?.reps).toBe(1);
      expect(after.schedulingPhase).toBe('review');
      expect(after.writingDueDate).toBeUndefined();
      expect(after.writingFsrsState).toBeUndefined();
    });
  });

  describe('getCardForReview queue selection', () => {
    it('serves the writing queue in Writing mode and the shared queue in Shadowing', async () => {
      const t = convexTest(schema, modules);
      const now = Date.now();
      const { settingsId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [
          // Shared-due, writing NOT due.
          { dueDate: now - 5000, writingDueDate: now + 86_400_000 },
          // Shared NOT due, writing due.
          { dueDate: now + 86_400_000, writingDueDate: now - 5000 },
        ],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const inWriting = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(inWriting?._id).toBe(cardIds[1]);
      // Writing-track state is surfaced in the shared-named fields.
      expect(inWriting?.schedulingPhase).toBe('review');
      expect(inWriting?.dueDate).toBe(now - 5000);

      await t.run(async (ctx) => {
        await ctx.db.patch(settingsId, { reviewMode: 'audio' });
      });
      const inShadowing = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(inShadowing?._id).toBe(cardIds[0]);
    });

    it('Free Study serves cards with their REAL shared fields, not the writing mask', async () => {
      const t = convexTest(schema, modules);
      // Same settings combo as Writing mode plus free play: the track is
      // 'writing' but cards come from the rotation. Masking their
      // preReviewCount/fsrsState made long-known cards look brand new to the
      // client (translation assist reappeared, auto-rating flipped).
      const { cardIds } = await seedCourse(t, {
        settings: {
          separateModeTracking: true,
          reviewMode: 'full',
          schedulingMode: 'radio',
        },
        cards: [{ preReviewCount: 5 }], // well-known card, unseeded writing track
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const served = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(served?._id).toBe(cardIds[0]);
      expect(served?.schedulingPhase).toBe('preReview');
      expect(served?.preReviewCount).toBe(5);
    });

    it('never serves unseeded cards in the writing queue', async () => {
      const t = convexTest(schema, modules);
      const { settingsId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [{ dueDate: Date.now() - 5000 }], // shared-due, no writing track
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res).toBeNull();

      // The same card is served once the mode (and thus the track) flips back.
      await t.run(async (ctx) => {
        await ctx.db.patch(settingsId, { reviewMode: 'audio' });
      });
      const shared = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(shared?._id).toBe(cardIds[0]);
    });
  });

  describe('first-review counting and per-mode counters', () => {
    it('a free-played card (lastReviewedAt stamped) still counts as a first review after seeding', async () => {
      const t = convexTest(schema, modules);
      const { courseId, cardIds } = await seedCourse(t, {
        // Free play stamps lastReviewedAt without advancing phase/count.
        cards: [{ lastReviewedAt: 999 }],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.courses.updateCourseSettings, {
        courseId,
        separateModeTracking: true,
      });
      await drainScheduler();

      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'stillLearning',
        timezone: 'UTC',
        reviewMode: 'audio',
      });

      const stats = await t.run(async (ctx) =>
        ctx.db
          .query('courseStats')
          .filter((q) => q.eq(q.field('courseId'), courseId))
          .unique(),
      );
      // The first real review of the card must increment totalCards. The
      // seeded writing track must not make it look already-reviewed.
      expect(stats?.totalCards).toBe(1);
    });

    it('a lazy-seeded writing review is stat-bucketed from the copied mature state', async () => {
      const t = convexTest(schema, modules);
      const fsrs = makeFsrsState({ state: 2, reps: 3 });
      const { courseId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        // Mature card the backfill hasn't reached (no writing track yet).
        cards: [{ schedulingPhase: 'review', fsrsState: fsrs }],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        forceReviewPhase: true,
        accuracy: 0.9,
      });

      // FSRS scheduled from the COPIED state (reps 3 → 4), so the stats must
      // say the same: bucket 'review' (not 'new'), depth 4 (not 1), exactly
      // what an identical backfill-seeded card would have recorded.
      const { daily, depthRows } = await t.run(async (ctx) => ({
        daily: await ctx.db
          .query('dailyStats')
          .filter((q) => q.eq(q.field('courseId'), courseId))
          .unique(),
        depthRows: await ctx.db.query('reviewDepthAccuracy').collect(),
      }));
      expect(daily?.reviewsByCardState).toEqual({
        new: 0,
        learning: 0,
        review: 1,
        relearning: 0,
      });
      expect(depthRows).toHaveLength(1);
      expect(depthRows[0].reviewNumber).toBe(4);
    });

    // The counterpart of the test above, and the reason `statsReversal.cardState`
    // is stamped rather than re-derived. The review is BUCKETED from the copied
    // shared state ('review'), but the undo snapshot necessarily records the
    // card's true writing fields, which on a lazy seed are unset. Re-deriving
    // the bucket from that snapshot decremented 'new' (floored at 0, silently
    // lost) and left 'review' inflated forever, with no way to repair a
    // historical dailyStats row.
    it('undoing a lazy-seeded writing review restores every card-state bucket', async () => {
      const t = convexTest(schema, modules);
      const fsrs = makeFsrsState({ state: 2, reps: 3 });
      const { courseId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [{ schedulingPhase: 'review', fsrsState: fsrs }],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      const readBuckets = async () =>
        (
          await t.run(async (ctx) =>
            ctx.db
              .query('dailyStats')
              .filter((q) => q.eq(q.field('courseId'), courseId))
              .unique(),
          )
        )?.reviewsByCardState;

      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        forceReviewPhase: true,
        accuracy: 0.9,
      });
      expect(await readBuckets()).toEqual({
        new: 0,
        learning: 0,
        review: 1,
        relearning: 0,
      });

      const undone = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        { timezone: 'UTC' },
      );
      expect(undone.status).toBe('undone');

      // Back to zero in EVERY bucket, not "review still 1, new floored at 0".
      expect(await readBuckets()).toEqual({
        new: 0,
        learning: 0,
        review: 0,
        relearning: 0,
      });
    });

    it('counts reviews per mode and reverses the count on undo', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [{ writingDueDate: Date.now() - 1000, writingIsGraduated: false }],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        forceReviewPhase: true,
      });
      expect((await getCard(t, cardIds[0])).reviewCountByMode).toEqual({
        audio: 0,
        full: 1,
      });

      await asUser.mutation(api.features.scheduling.undoLastReview, {
        timezone: 'UTC',
      });
      expect((await getCard(t, cardIds[0])).reviewCountByMode).toEqual({
        audio: 0,
        full: 0,
      });
    });
  });

  describe('undo', () => {
    it('restores the writing track and un-seeds a lazy-seeded card', async () => {
      const t = convexTest(schema, modules);
      const fsrs = makeFsrsState({ reps: 3 });
      const { cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'full' },
        cards: [{ schedulingPhase: 'review', fsrsState: fsrs }],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        forceReviewPhase: true,
      });
      expect((await getCard(t, cardIds[0])).writingFsrsState).toBeDefined();

      const undone = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        { timezone: 'UTC' },
      );
      expect(undone.status).toBe('undone');

      const after = await getCard(t, cardIds[0]);
      // Back to the unseeded state, as if the review never happened.
      expect(after.writingDueDate).toBeUndefined();
      expect(after.writingFsrsState).toBeUndefined();
      expect(after.writingLastReviewedAt).toBeUndefined();
      expect(after.writingGoodReviewCount).toBeUndefined();
      // Shared untouched throughout.
      expect(after.fsrsState).toEqual(fsrs);
    });

    it('a track flip fences the undo stack', async () => {
      const t = convexTest(schema, modules);
      const { settingsId, cardIds } = await seedCourse(t, {
        settings: { separateModeTracking: true, reviewMode: 'audio' },
        cards: [{ writingDueDate: Date.now() - 1000, writingIsGraduated: false }],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      // Shared-track review while in Shadowing.
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId: cardIds[0],
        rating: 'stillLearning',
        timezone: 'UTC',
        reviewMode: 'audio',
      });
      expect(
        await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
      ).toBe(1);

      // Flip to Writing (track becomes 'writing'), the shared-track entry is
      // no longer undoable from here.
      await t.run(async (ctx) => {
        await ctx.db.patch(settingsId, { reviewMode: 'full' });
      });
      expect(
        await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
      ).toBe(0);
      const res = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        { timezone: 'UTC' },
      );
      expect(res.status).toBe('nothing_to_undo');
    });
  });

  describe('creation-time seeding (createCardsFromTexts)', () => {
    /** Card-less collection texts + quota, so `addCardsFromCollection` drives
     * the REAL creation path (`createCardsFromTexts`) instead of the direct
     * `ctx.db.insert` the other suites use. */
    async function seedCollectionTexts(
      t: TestConvex<typeof schema>,
      opts: { settings?: Partial<Doc<'courseSettings'>>; texts?: number } = {},
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: opts.texts ?? 2,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert('courseSettings', {
          courseId,
          initialReviewCount: 5,
          ...opts.settings,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 0,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            sentences: { balance: 100, included: 100, used: 0, unlimited: false },
          },
          lastSyncedAt: Date.now(),
        });
        for (let i = 1; i <= (opts.texts ?? 2); i++) {
          await ctx.db.insert('texts', {
            text: `Hola ${i}`,
            language: 'es',
            userCreated: false,
            collectionId,
            collectionRank: i,
          });
        }
        return { courseId, deckId, collectionId };
      });
    }

    const deckCards = (t: TestConvex<typeof schema>, deckId: Id<'decks'>) =>
      t.run(async (ctx) =>
        ctx.db
          .query('cards')
          .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
          .collect(),
      );

    it('split on: new cards are writing-seeded at creation and immediately in the writing due index', async () => {
      const t = convexTest(schema, modules);
      const { deckId, collectionId } = await seedCollectionTexts(t, {
        settings: {
          separateModeTracking: true,
          reviewMode: 'full',
          writingSeedDone: true,
        },
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId,
        batchSize: 2,
      });
      expect(res.cardsAdded).toBe(2);

      const cards = await deckCards(t, deckId);
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        // Seeded at insert, no backfill needed for cards created while the
        // split is on.
        expect(card.writingDueDate).toBeDefined();
        expect(card.writingIsGraduated).toBe(false);
      }

      // And the writing due index actually serves them (the queue every
      // writing-track query draws from. Unseeded cards are excluded by the
      // `.gte('writingDueDate', 0)` bound).
      const due = await t.run(async (ctx) =>
        ctx.db
          .query('cards')
          .withIndex('by_deck_hidden_mastered_writingDue', (q) =>
            q
              .eq('deckId', deckId)
              .eq('isHidden', false)
              .eq('isMastered', false)
              .gte('writingDueDate', 0)
              .lte('writingDueDate', Date.now() + 10_000),
          )
          .collect(),
      );
      expect(due).toHaveLength(2);
    });

    it('split off: new cards stay unseeded (the enable-time sweep owns their eventual seed)', async () => {
      const t = convexTest(schema, modules);
      const { deckId, collectionId } = await seedCollectionTexts(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId,
        batchSize: 2,
      });
      const cards = await deckCards(t, deckId);
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        expect(card.writingDueDate).toBeUndefined();
        expect(card.writingIsGraduated).toBeUndefined();
      }
    });
  });

  describe('content warmer track selection (ensureUpcomingCardsContent)', () => {
    it('warms the queue of the ACTIVE track, not the other one', async () => {
      const t = convexTest(schema, modules);
      const now = Date.now();
      // Card A due only on the shared track; card B due only on the writing
      // track. Texts have no audio, so every card the warmer selects leaves a
      // ttsGenerationClaims row for its text, which card was warmed is read
      // from there (the processed COUNT alone is 1 for either track and would
      // pass with the selection broken).
      const { settingsId, cardIds } = await seedCourse(t, {
        settings: {
          separateModeTracking: true,
          reviewMode: 'full',
          writingSeedDone: true,
        },
        cards: [
          { dueDate: now - 1000, writingDueDate: now + 86_400_000, writingIsGraduated: false },
          { dueDate: now + 86_400_000, writingDueDate: now - 1000, writingIsGraduated: false },
        ],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const textIdOf = async (i: number) => (await getCard(t, cardIds[i])).textId;
      const claimedTextIds = () =>
        t.run(async (ctx) =>
          (await ctx.db.query('ttsGenerationClaims').collect()).map(
            (c) => c.textId,
          ),
        );

      // Writing mode → only card B (writing-due) is warmed.
      expect(
        await asUser.mutation(api.features.decks.ensureUpcomingCardsContent, {}),
      ).toBe(1);
      expect(await claimedTextIds()).toEqual([await textIdOf(1)]);

      // Shadowing → only card A (shared-due) is warmed on top.
      await t.run(async (ctx) => {
        await ctx.db.patch(settingsId, { reviewMode: 'audio' });
      });
      expect(
        await asUser.mutation(api.features.decks.ensureUpcomingCardsContent, {}),
      ).toBe(1);
      expect((await claimedTextIds()).sort()).toEqual(
        [await textIdOf(0), await textIdOf(1)].sort(),
      );
    });

    it('ensureUpcomingCardsContentAllModes warms BOTH tracks when the split is on', async () => {
      const t = convexTest(schema, modules);
      const now = Date.now();
      const { cardIds } = await seedCourse(t, {
        settings: {
          separateModeTracking: true,
          reviewMode: 'full',
          writingSeedDone: true,
        },
        cards: [
          { dueDate: now - 1000, writingDueDate: now + 86_400_000, writingIsGraduated: false },
          { dueDate: now + 86_400_000, writingDueDate: now - 1000, writingIsGraduated: false },
        ],
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      // Both cards are due on exactly one track each → the all-modes warmer
      // must reach both (deduped by card id).
      expect(
        await asUser.mutation(
          api.features.decks.ensureUpcomingCardsContentAllModes,
          {},
        ),
      ).toBe(cardIds.length);
    });
  });
});
