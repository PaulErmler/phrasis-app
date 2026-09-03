/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * Free play. ONE scheduling mode ('radio') with two faces, chosen by
 * `reviewMode`: Radio while listening (`'audio'`), Free Study while typing
 * (`'full'`). The faces share the round-robin mechanic but keep their own card
 * rotation fields (radio* vs freeStudy*), so practising a card in one face
 * never counts as having practised it in the other.
 *
 * The radio-face mechanic itself is covered in scheduling.test.ts; these tests
 * focus on the writing face, the shared advance mutation, its stats bucket,
 * undo, and. Most importantly. The independence of the two rotations.
 */

/**
 * Seed a deck with `cards.length` cards. Each entry can set the freeStudy
 * counter/orderKey plus (for independence tests) radio counter/orderKey and
 * FSRS-ish scheduling fields. The course is put into free play; `face` picks
 * which one via `reviewMode`, defaulting to the writing face. Returns ids in
 * insertion order.
 */
async function seedFreePlayDeck(
  t: TestConvex<typeof schema>,
  cards: Array<{
    counter?: number;
    orderKey?: number;
    text?: string;
    dueDate?: number;
    radioCounter?: number;
    radioOrderKey?: number;
    preReviewCount?: number;
    fsrsReps?: number;
    isMastered?: boolean;
    isHidden?: boolean;
    origin?: 'premade' | 'custom' | 'chat';
  }>,
  face: 'freeStudy' | 'radio' = 'freeStudy',
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
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 3,
      // One free-play mode; the review mode is what picks the face.
      schedulingMode: 'radio',
      reviewMode: face === 'radio' ? 'audio' : 'full',
    });
    // recordFreePlayStats requires a courseStats row (plays bump
    // totalRepetitions, totalTimeMs, totalReviewsByMode.<face>, streak).
    await ctx.db.insert('courseStats', {
      userId: 'user_A',
      courseId,
      totalRepetitions: 0,
      totalTimeMs: 0,
      totalCards: 0,
      currentStreak: 0,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: cards.length,
    });
    const cardIds = [];
    for (let i = 0; i < cards.length; i++) {
      const {
        counter = 0,
        orderKey,
        text = `card-${i}`,
        dueDate,
        radioCounter,
        radioOrderKey,
        preReviewCount = 0,
        fsrsReps,
        isMastered = false,
        isHidden = false,
        origin,
      } = cards[i];
      const textId = await ctx.db.insert('texts', {
        text,
        language: 'es',
        userCreated: true,
        userId: 'user_A',
        collectionId,
        collectionRank: i + 1,
      });
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'en',
        translatedText: `EN ${text}`,
      });
      const cardId = await ctx.db.insert('cards', {
        deckId,
        textId,
        collectionId,
        dueDate: dueDate ?? Date.now() - 1000 - i,
        isMastered,
        isHidden,
        schedulingPhase: 'preReview',
        preReviewCount,
        ...(fsrsReps != null
          ? {
              fsrsState: {
                due: Date.now() + 86_400_000,
                stability: 1,
                difficulty: 5,
                elapsedDays: 0,
                scheduledDays: 1,
                learningSteps: 0,
                reps: fsrsReps,
                lapses: 0,
                state: 2,
                lastReview: Date.now() - 1000,
              },
            }
          : {}),
        freeStudyRoundCounter: counter,
        // Deterministic orderKey by default so first-pick assertions are
        // stable; tests exercising the shuffle pass explicit values.
        freeStudyOrderKey: orderKey ?? i,
        ...(radioCounter != null ? { radioRoundCounter: radioCounter } : {}),
        ...(radioOrderKey != null ? { radioOrderKey } : {}),
        collectionOrigin: origin ?? 'premade',
      });
      cardIds.push(cardId);
    }
    return { courseId, deckId, cardIds };
  });
}

/** Flip the review mode, i.e. switch free-play faces mid-session, exactly as
 *  the settings-sheet switcher does. */
async function setReviewMode(
  t: TestConvex<typeof schema>,
  courseId: Awaited<ReturnType<typeof seedFreePlayDeck>>['courseId'],
  reviewMode: 'audio' | 'full',
) {
  await t.run(async (ctx) => {
    const settings = await ctx.db
      .query('courseSettings')
      .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
      .first();
    await ctx.db.patch(settings!._id, { reviewMode });
  });
}

/** Set the course's content-source filter (All / Course only / My content). */
async function setStudyContentFilter(
  t: TestConvex<typeof schema>,
  courseId: Awaited<ReturnType<typeof seedFreePlayDeck>>['courseId'],
  studyContentFilter: 'both' | 'course' | 'custom',
) {
  await t.run(async (ctx) => {
    const settings = await ctx.db
      .query('courseSettings')
      .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
      .first();
    await ctx.db.patch(settings!._id, { studyContentFilter });
  });
}

describe('features/scheduling: free play', () => {
  // --------------------------------------------------------------------------
  // getCardForReview (writing face)
  // --------------------------------------------------------------------------
  describe('getCardForReview', () => {
    it('picks the card with the lowest freeStudyRoundCounter', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [
        { counter: 5, text: 'high' },
        { counter: 0, text: 'low' },
        { counter: 3, text: 'mid' },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res?._id).toBe(cardIds[1]);
      expect(res?.sourceText).toBe('low');
    });

    it('ignores dueDate (studies cards even when nothing is due)', async () => {
      const t = convexTest(schema, modules);
      const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const { cardIds } = await seedFreePlayDeck(t, [
        { counter: 10, dueDate: farFuture + 1 },
        { counter: 0, dueDate: farFuture },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res?._id).toBe(cardIds[1]);
    });

    it('orders by the freeStudy fields, not the radio fields', async () => {
      // Radio ordering would pick card 0 (radio counter 0); the writing face
      // must pick card 1 (freeStudy counter 0), the rotations are independent.
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [
        { counter: 7, radioCounter: 0 },
        { counter: 0, radioCounter: 9 },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res?._id).toBe(cardIds[1]);
    });

    it('switches queues when the review mode flips mid-session', async () => {
      // The whole point of merging the modes: the same free-play session
      // serves a DIFFERENT rotation the moment the user flips the switcher.
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [
        { counter: 7, radioCounter: 0 },
        { counter: 0, radioCounter: 9 },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      expect(
        (await asUser.query(api.features.scheduling.getCardForReview, {}))?._id,
      ).toBe(cardIds[1]);

      await setReviewMode(t, courseId, 'audio');
      expect(
        (await asUser.query(api.features.scheduling.getCardForReview, {}))?._id,
      ).toBe(cardIds[0]);

      await setReviewMode(t, courseId, 'full');
      expect(
        (await asUser.query(api.features.scheduling.getCardForReview, {}))?._id,
      ).toBe(cardIds[1]);
    });

    it('skips mastered and hidden cards', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [
        { counter: 0, isMastered: true },
        { counter: 1, isHidden: true },
        { counter: 2, text: 'playable' },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res?._id).toBe(cardIds[2]);
    });

    it('returns null when the deck is empty', async () => {
      const t = convexTest(schema, modules);
      await seedFreePlayDeck(t, []);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // advanceFreePlayCard
  // --------------------------------------------------------------------------
  describe('advanceFreePlayCard', () => {
    it('rejects unauthenticated callers', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      await expect(
        t.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        }),
      ).rejects.toThrow();
    });

    it("rejects access to another user's card", async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asOther = t.withIdentity({ subject: 'user_B' });
      await expect(
        asOther.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        }),
      ).rejects.toThrow();
    });

    it('rejects when the course is not in free play', async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      await t.run(async (ctx) => {
        const settings = await ctx.db
          .query('courseSettings')
          .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
          .first();
        await ctx.db.patch(settings!._id, { schedulingMode: 'learnAndReview' });
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: cardIds[0],
          timezone: 'UTC',
        }),
      ).rejects.toThrow();
    });

    it('sequential passes of a single-card deck increment monotonically', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const counters: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await asUser.mutation(
          api.features.scheduling.advanceFreePlayCard,
          { cardId: cardIds[0], timezone: 'UTC' },
        );
        counters.push(r.nextRoundCounter);
      }
      expect(counters).toEqual([1, 2, 3, 4]);
    });

    it('catches a fresh card up to one past the floor instead of incrementing by 1', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [
        { counter: 0, text: 'fresh' },
        { counter: 100, text: 'veteran-a' },
        { counter: 101, text: 'veteran-b' },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const r = await asUser.mutation(
        api.features.scheduling.advanceFreePlayCard,
        { cardId: cardIds[0], timezone: 'UTC' },
      );
      // Floor is the next-lowest peer (100) → fresh card lands at 101, one
      // strictly above the floor, so it can't be re-picked immediately.
      expect(r.nextRoundCounter).toBe(101);
    });

    it('seeds freeStudyPlayCount from 0 (not the review count, unlike radio)', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [
        // Seeded WITHOUT a freeStudyPlayCount, so the mutation's own seeding
        // runs on a card that has real review history.
        { counter: 0, preReviewCount: 2, fsrsReps: 7 },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      // The radio face would seed 2 + 7 = 9 and land on 10 (it feeds the
      // "Only new" Practice-Listening limit); the writing face starts fresh.
      expect(card?.freeStudyPlayCount).toBe(1);
    });

    it('does not modify FSRS state, dueDate, schedulingPhase, preReviewCount, or the radio fields', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [
        {
          counter: 0,
          preReviewCount: 2,
          fsrsReps: 4,
          radioCounter: 3,
          radioOrderKey: 42,
        },
        { counter: 1 },
      ]);
      const before = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      const after = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      expect(after?.dueDate).toBe(before?.dueDate);
      expect(after?.schedulingPhase).toBe(before?.schedulingPhase);
      expect(after?.preReviewCount).toBe(before?.preReviewCount);
      expect(after?.fsrsState).toEqual(before?.fsrsState);
      // Radio rotation untouched. The two faces are independent.
      expect(after?.radioRoundCounter).toBe(3);
      expect(after?.radioOrderKey).toBe(42);
      expect(after?.radioPlayCount).toBe(before?.radioPlayCount);
    });

    it('advances only the face the review mode selects', async () => {
      // The load-bearing guarantee: listening to a card must not count as
      // having typed it, and vice versa.
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(
        t,
        [{ counter: 5, orderKey: 77, radioCounter: 0 }],
        'radio',
      );
      const asUser = t.withIdentity({ subject: 'user_A' });

      // Listening face: bumps radio*, leaves freeStudy* alone.
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      let card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      expect(card?.radioRoundCounter).toBe(1);
      expect(card?.freeStudyRoundCounter).toBe(5);
      expect(card?.freeStudyOrderKey).toBe(77);
      expect(card?.freeStudyPlayCount).toBeUndefined();

      // Flip to the writing face: bumps freeStudy*, leaves radio* alone.
      await setReviewMode(t, courseId, 'full');
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      expect(card?.freeStudyRoundCounter).toBe(6);
      expect(card?.freeStudyPlayCount).toBe(1);
      expect(card?.radioRoundCounter).toBe(1);
    });

    it('stamps lastReviewedAt and re-rolls the order key', async () => {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [
        { counter: 0, orderKey: 5 },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const beforeMs = Date.now();
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      expect(card?.lastReviewedAt).toBeGreaterThanOrEqual(beforeMs);
      // Re-rolled into the full 32-bit space; equality with the tiny seeded
      // value would be a ~1e-9 fluke, so assert it moved.
      expect(card?.freeStudyOrderKey).not.toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // Stats. Per-face buckets, progress bar excluded
  // --------------------------------------------------------------------------
  describe('advanceFreePlayCard: stats', () => {
    it('writes dailyStats with reviewsByMode.freeStudy + timeMsByMode.freeStudy', async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
        timeSpentMs: 7500,
      });
      const daily = await t.run(async (ctx) =>
        ctx.db
          .query('dailyStats')
          .withIndex('by_userId_and_courseId_and_date', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first(),
      );
      expect(daily?.reps).toBe(1);
      expect(daily?.timeMs).toBe(7500);
      expect(daily?.reviewsByMode?.freeStudy).toBe(1);
      expect(daily?.reviewsByMode?.radio).toBe(0);
      expect(daily?.reviewsByMode?.audio).toBe(0);
      expect(daily?.reviewsByMode?.full).toBe(0);
      expect(daily?.timeMsByMode?.freeStudy).toBe(7500);
      expect(daily?.accuracySum).toBeUndefined();
    });

    it('counts each face into its own bucket', async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(
        t,
        [{ counter: 0 }],
        'radio',
      );
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      await setReviewMode(t, courseId, 'full');
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      const daily = await t.run(async (ctx) =>
        ctx.db
          .query('dailyStats')
          .withIndex('by_userId_and_courseId_and_date', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first(),
      );
      expect(daily?.reviewsByMode?.radio).toBe(1);
      expect(daily?.reviewsByMode?.freeStudy).toBe(1);
      expect(daily?.reps).toBe(2);
    });

    it('updates courseStats totals + freeStudy counter and the streak', async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
        timeSpentMs: 4000,
      });
      const stats = await t.run(async (ctx) =>
        ctx.db
          .query('courseStats')
          .withIndex('by_userId_and_courseId', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first(),
      );
      expect(stats?.totalRepetitions).toBe(1);
      expect(stats?.totalTimeMs).toBe(4000);
      expect(stats?.totalReviewsByMode?.freeStudy).toBe(1);
      expect(stats?.totalReviewsByMode?.radio ?? 0).toBe(0);
      expect(stats?.totalTimeMsByMode?.freeStudy).toBe(4000);
      expect(stats?.totalTimeMsByMode?.radio ?? 0).toBe(0);
      expect(stats?.totalCards).toBe(0);
      expect(stats?.currentStreak).toBe(1);
    });

    it('populates weekly / monthly / yearly rollups with reviewsByMode.freeStudy', async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
        timeSpentMs: 2500,
      });
      const rows = await t.run(async (ctx) => {
        const w = await ctx.db
          .query('weeklyStats')
          .withIndex('by_userId_and_courseId', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first();
        const m = await ctx.db
          .query('monthlyStats')
          .withIndex('by_userId_and_courseId', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first();
        const y = await ctx.db
          .query('yearlyStats')
          .withIndex('by_userId_and_courseId', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first();
        return [w, m, y];
      });
      for (const row of rows) {
        expect(row).not.toBeNull();
        expect(row?.totalRepetitions).toBe(1);
        expect(row?.totalTimeMs).toBe(2500);
        expect(row?.reviewsByMode?.freeStudy).toBe(1);
      }
    });

    it('keeps getTodayStats and getCourseStats returnable after a play (validators accept the freeStudy bucket)', async () => {
      // Regression: these queries once re-declared the reviewsByMode shape
      // inline without `freeStudy`, so the first play made them throw a
      // ReturnsValidationError for the whole home screen.
      const t = convexTest(schema, modules);
      const { cardIds } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      const today = await asUser.query(api.features.courses.getTodayStats, {
        timezone: 'UTC',
      });
      expect(today?.reviewsByMode?.freeStudy).toBe(1);
      const course = await asUser.query(api.features.courses.getCourseStats, {
        timezone: 'UTC',
      });
      expect(course?.totalReviewsByMode?.freeStudy).toBe(1);
    });

    it('excludes free plays from dailyReviewsToday (progress bar / milestones)', async () => {
      const t = convexTest(schema, modules);
      await seedFreePlayDeck(t, [{ counter: 0 }, { counter: 1 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      for (let i = 0; i < 3; i++) {
        const current = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
          cardId: current!._id,
          timezone: 'UTC',
        });
      }
      const res = await asUser.query(api.features.scheduling.getCardForReview, {
        timezone: 'UTC',
      });
      expect(res?.dailyReviewsToday).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Undo
  // --------------------------------------------------------------------------
  describe('undoLastReview', () => {
    it('restores the pre-play rotation state and reverses the stats', async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [
        { counter: 2, orderKey: 11 },
        { counter: 3 },
      ]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
        timeSpentMs: 3000,
      });

      const res = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        {
          timezone: 'UTC',
        },
      );
      expect(res.status).toBe('undone');
      if (res.status === 'undone') expect(res.cardId).toBe(cardIds[0]);

      const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      expect(card?.freeStudyRoundCounter).toBe(2);
      expect(card?.freeStudyOrderKey).toBe(11);
      expect(card?.freeStudyPlayCount).toBeUndefined();

      const [stats, daily] = await t.run(async (ctx) => {
        const s = await ctx.db
          .query('courseStats')
          .withIndex('by_userId_and_courseId', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first();
        const d = await ctx.db
          .query('dailyStats')
          .withIndex('by_userId_and_courseId_and_date', (q) =>
            q.eq('userId', 'user_A').eq('courseId', courseId),
          )
          .first();
        return [s, d];
      });
      expect(stats?.totalRepetitions).toBe(0);
      expect(stats?.totalReviewsByMode?.freeStudy).toBe(0);
      expect(daily?.reps).toBe(0);
      expect(daily?.reviewsByMode?.freeStudy).toBe(0);
      // Time deliberately stays. The practice genuinely happened.
      expect(daily?.timeMs).toBe(3000);

      // The restored card is at the front of the queue again.
      const next = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(next?._id).toBe(cardIds[0]);
    });

    it("hides the other face's plays but restores them when you switch back", async () => {
      // Undo is scoped to the rotation on screen: popping a typing play while
      // looking at the listening queue would restore counters the visible
      // queue doesn't read. Flipping the switcher logs nothing, though, so the
      // entry is only hidden, never lost.
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      expect(
        await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
      ).toBe(1);

      await setReviewMode(t, courseId, 'audio');
      expect(
        await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
      ).toBe(0);
      expect(
        (
          await asUser.mutation(api.features.scheduling.undoLastReview, {
            timezone: 'UTC',
          })
        ).status,
      ).toBe('nothing_to_undo');

      await setReviewMode(t, courseId, 'full');
      expect(
        await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
      ).toBe(1);
      expect(
        (
          await asUser.mutation(api.features.scheduling.undoLastReview, {
            timezone: 'UTC',
          })
        ).status,
      ).toBe('undone');
    });

    it("blocks the other face's entries once a newer play sits on top", async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      // A typing play, then a listening play on top of it.
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      await setReviewMode(t, courseId, 'audio');
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      // Only the listening play is reachable from the listening face...
      expect(
        await asUser.query(api.features.scheduling.getUndoableReviewCount, {}),
      ).toBe(1);
      await asUser.mutation(api.features.scheduling.undoLastReview, {
        timezone: 'UTC',
      });
      // ...and undoing it restores the radio rotation, leaving the typing
      // rotation exactly where the earlier play left it.
      const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
      expect(card?.radioRoundCounter ?? 0).toBe(0);
      expect(card?.freeStudyRoundCounter).toBe(1);
    });

    it('does not undo a free play after leaving free play (context scoping)', async () => {
      const t = convexTest(schema, modules);
      const { cardIds, courseId } = await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
        cardId: cardIds[0],
        timezone: 'UTC',
      });
      await t.run(async (ctx) => {
        const settings = await ctx.db
          .query('courseSettings')
          .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
          .first();
        await ctx.db.patch(settings!._id, { schedulingMode: 'learnAndReview' });
      });
      const res = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        {
          timezone: 'UTC',
        },
      );
      expect(res.status).toBe('nothing_to_undo');
    });
  });
});

// ----------------------------------------------------------------------------
// Content filter (studyContentFilter), the rotation, the catch-up floor, and
// the home-screen gate must all see the SAME filtered population.
// ----------------------------------------------------------------------------
describe('features/scheduling: free play under a content filter', () => {
  it('serves only cards of the allowed origin', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seedFreePlayDeck(t, [
      { counter: 0, text: 'custom-low', origin: 'custom' },
      { counter: 3, text: 'premade-high', origin: 'premade' },
    ]);
    await setStudyContentFilter(t, courseId, 'course');
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.query(
      api.features.scheduling.getCardForReview,
      {},
    );
    // The custom card has the lowest counter but is filtered out.
    expect(res?.sourceText).toBe('premade-high');
  });

  /**
   * The regression this exists for: the advance's catch-up floor was read
   * from the UNfiltered rotation, so with "Course only" active a hidden
   * custom card stuck at counter 0 anchored the floor. A fresh premade card
   * jumped to 1 instead of past the premade veterans and was re-served
   * dozens of times in a row.
   */
  it('computes the catch-up floor from the filtered rotation', async () => {
    const t = convexTest(schema, modules);
    const { courseId, cardIds } = await seedFreePlayDeck(t, [
      { counter: 0, text: 'fresh', origin: 'premade' },
      { counter: 50, text: 'veteran-a', origin: 'premade' },
      { counter: 51, text: 'veteran-b', origin: 'premade' },
      // Filtered out under 'course'. Must NOT anchor the floor at 0.
      { counter: 0, text: 'invisible-custom', origin: 'custom' },
    ]);
    await setStudyContentFilter(t, courseId, 'course');
    const asUser = t.withIdentity({ subject: 'user_A' });
    const r = await asUser.mutation(
      api.features.scheduling.advanceFreePlayCard,
      { cardId: cardIds[0], timezone: 'UTC' },
    );
    // Floor = veteran-a's 50 → land at 51 (one past), not 1.
    expect(r.nextRoundCounter).toBe(51);
  });

  it("still floors against other allowed-origin cards under 'custom' (custom + chat merge)", async () => {
    const t = convexTest(schema, modules);
    const { courseId, cardIds } = await seedFreePlayDeck(t, [
      { counter: 0, text: 'fresh-custom', origin: 'custom' },
      { counter: 20, text: 'chat-veteran', origin: 'chat' },
      { counter: 0, text: 'invisible-premade', origin: 'premade' },
    ]);
    await setStudyContentFilter(t, courseId, 'custom');
    const asUser = t.withIdentity({ subject: 'user_A' });
    const r = await asUser.mutation(
      api.features.scheduling.advanceFreePlayCard,
      { cardId: cardIds[0], timezone: 'UTC' },
    );
    expect(r.nextRoundCounter).toBe(21);
  });

  describe('hasPlayableCards', () => {
    it('is false when the filter hides every card', async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedFreePlayDeck(t, [
        { counter: 0, origin: 'premade' },
      ]);
      await setStudyContentFilter(t, courseId, 'custom');
      const asUser = t.withIdentity({ subject: 'user_A' });
      expect(
        await asUser.query(api.features.scheduling.hasPlayableCards, {}),
      ).toBe(false);
    });

    it('is true when at least one allowed-origin card exists', async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedFreePlayDeck(t, [
        { counter: 0, origin: 'premade' },
        { counter: 0, origin: 'chat' },
      ]);
      await setStudyContentFilter(t, courseId, 'custom');
      const asUser = t.withIdentity({ subject: 'user_A' });
      expect(
        await asUser.query(api.features.scheduling.hasPlayableCards, {}),
      ).toBe(true);
    });

    it("keeps the unfiltered behaviour for 'both'", async () => {
      const t = convexTest(schema, modules);
      await seedFreePlayDeck(t, [{ counter: 0 }]);
      const asUser = t.withIdentity({ subject: 'user_A' });
      expect(
        await asUser.query(api.features.scheduling.hasPlayableCards, {}),
      ).toBe(true);
    });
  });
});
