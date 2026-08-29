/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { REVIEW_TIME_CLAMP_MAX_MS } from '../../lib/reviewTimeStats';
import { UNDO_DEPTH } from '../../../lib/constants/learning';
import type { Infer } from 'convex/values';
import type { fsrsStateValidator } from '../../types';

type FsrsState = Infer<typeof fsrsStateValidator>;

const modules = import.meta.glob('/convex/**/*.ts');

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

/** Seed a user with an active course, stats row, deck, and one due card.
 * Mirrors the seeding in schedulingUndo.test.ts / separateModeTracking.test.ts. */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    settings?: Partial<Doc<'courseSettings'>>;
    card?: Partial<Doc<'cards'>>;
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
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 5,
      ...opts.settings,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hola mundo',
      language: 'es',
      userCreated: true,
      userId: 'user_A',
      collectionId,
      collectionRank: 1,
    });
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate: Date.now() - 1000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
      ...opts.card,
    });
    return { cardId, courseId, deckId, collectionId };
  });
}

const getHistory = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.db
      .query('reviewHistory')
      .withIndex('by_userId_and_courseId_and_reviewedAt', (q) =>
        q.eq('userId', 'user_A'),
      )
      .collect(),
  );

const getCard = (t: TestConvex<typeof schema>, cardId: Id<'cards'>) =>
  t.run(async (ctx) => (await ctx.db.get(cardId))!);

const getLogs = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query('reviewLogs').collect());

describe('reviewHistory', () => {
  it('records an FSRS-phase review with the scheduling transition', async () => {
    const t = convexTest(schema, modules);
    const fsrs = makeFsrsState();
    const prevDue = Date.now() - 5000;
    const { cardId, courseId } = await seed(t, {
      card: {
        schedulingPhase: 'review',
        preReviewCount: 5,
        fsrsState: fsrs,
        isGraduated: true,
        dueDate: prevDue,
      },
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: 'good',
      timezone: 'UTC',
      timeSpentMs: 4000,
      sessionId: 's1',
    });

    const rows = await getHistory(t);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.courseId).toBe(courseId);
    expect(row.cardId).toBe(cardId);
    expect(row.track).toBe('shared');
    expect(row.phase).toBe('review');
    expect(row.rating).toBe('good');
    expect(row.timeSpentMs).toBe(4000);
    expect(row.sessionId).toBe('s1');
    expect(row.wasFirstReview).toBe(false);
    expect(row.prevDueDate).toBe(prevDue);
    expect(row.newDueDate).toBe(res.dueDate);
    expect(row.prevPreReviewCount).toBe(5);
    expect(row.prevFsrsState).toEqual(fsrs);
    expect(row.newFsrsState).toEqual(res.fsrsState);
    expect(row.phaseTransitioned).toBeUndefined();
    expect(row.lazySeededWriting).toBeUndefined();
    // The undo entry links back to this row.
    const logs = await getLogs(t);
    expect(logs[0].historyId).toBe(row._id);
  });

  it('records preReview grades, marking the phase transition on understood', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: 'stillLearning',
      timezone: 'UTC',
    });
    let rows = await getHistory(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('preReview');
    expect(rows[0].rating).toBe('stillLearning');
    expect(rows[0].wasFirstReview).toBe(true);
    expect(rows[0].prevPreReviewCount).toBe(0);
    expect(rows[0].prevFsrsState).toBeUndefined();
    expect(rows[0].newFsrsState).toBeUndefined();
    expect(rows[0].phaseTransitioned).toBeUndefined();
    expect(rows[0].timeSpentMs).toBeUndefined();

    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: 'understood',
      timezone: 'UTC',
    });
    rows = await getHistory(t);
    expect(rows).toHaveLength(2);
    const understood = rows.find((r) => r.rating === 'understood')!;
    expect(understood.phaseTransitioned).toBe(true);
    expect(understood.newFsrsState).toBeDefined();
    expect(understood.wasFirstReview).toBe(false);
  });

  it('records a lazy-seeded writing-track review scheduled from the copied baseline', async () => {
    const t = convexTest(schema, modules);
    const fsrs = makeFsrsState();
    const sharedDue = Date.now() - 2000;
    const { cardId } = await seed(t, {
      settings: { separateModeTracking: true, reviewMode: 'full' },
      card: {
        schedulingPhase: 'review',
        preReviewCount: 5,
        fsrsState: fsrs,
        isGraduated: true,
        dueDate: sharedDue,
        // No writing* fields: the enable-time sweep hasn't reached this card.
      },
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    await asUser.mutation(api.features.scheduling.reviewCard, {
      cardId,
      rating: 'good',
      timezone: 'UTC',
      reviewMode: 'full',
      forceReviewPhase: true,
    });

    const rows = await getHistory(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].track).toBe('writing');
    expect(rows[0].reviewMode).toBe('full');
    expect(rows[0].phase).toBe('review');
    expect(rows[0].lazySeededWriting).toBe(true);
    // Scheduled FROM the copied shared baseline, not the (unset) raw fields.
    expect(rows[0].prevDueDate).toBe(sharedDue);
    expect(rows[0].prevFsrsState).toEqual(fsrs);
    expect(rows[0].prevPreReviewCount).toBeUndefined();
  });

  it('free play never writes history', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t, {
      settings: { schedulingMode: 'radio' },
      card: { radioRoundCounter: 0, radioOrderKey: 0.5 },
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    await asUser.mutation(api.features.scheduling.advanceFreePlayCard, {
      cardId,
      timezone: 'UTC',
    });
    expect(await getHistory(t)).toHaveLength(0);
  });

  it('rows survive the undo-stack trim', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seed(t, {
      // FSRS-phase card so every iteration can rate 'good' (a preReview card
      // would graduate mid-loop and reject the binary rating).
      card: {
        schedulingPhase: 'review',
        preReviewCount: 5,
        fsrsState: makeFsrsState(),
      },
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    const total = UNDO_DEPTH + 2;
    for (let i = 0; i < total; i++) {
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'good',
        timezone: 'UTC',
      });
    }
    expect(await getLogs(t)).toHaveLength(UNDO_DEPTH);
    expect(await getHistory(t)).toHaveLength(total);
  });

  describe('undo', () => {
    it('deletes exactly the undone review’s row', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seed(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
      });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
      });
      const before = await getHistory(t);
      expect(before).toHaveLength(2);
      const newest = before.reduce((a, b) =>
        a.reviewedAt >= b.reviewedAt ? a : b,
      );

      const res = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        { timezone: 'UTC' },
      );
      expect(res.status).toBe('undone');
      const after = await getHistory(t);
      expect(after).toHaveLength(1);
      expect(after.find((r) => r._id === newest._id)).toBeUndefined();
    });

    it('keeps the row when the card was deleted since the review', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seed(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
      });
      await t.run((ctx) => ctx.db.delete(cardId));

      const res = await asUser.mutation(
        api.features.scheduling.undoLastReview,
        { timezone: 'UTC' },
      );
      expect(res.status).toBe('nothing_to_undo');
      expect(await getLogs(t)).toHaveLength(0); // log discarded
      expect(await getHistory(t)).toHaveLength(1); // history stands
    });
  });

  describe('cards.reviewTimeStats running averages', () => {
    it('folds timed reviews into a per-mode cumulative mean', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seed(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
        timeSpentMs: 4000,
      });
      let card = await getCard(t, cardId);
      expect(card.reviewTimeStats).toEqual({
        audio: { avgMs: 4000, count: 1 },
      });

      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
        timeSpentMs: 8000,
      });
      card = await getCard(t, cardId);
      expect(card.reviewTimeStats?.audio?.count).toBe(2);
      expect(card.reviewTimeStats?.audio?.avgMs).toBeCloseTo(6000, 6);
    });

    it('keeps modes separate and clamps outlier samples', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seed(t, {
        card: {
          schedulingPhase: 'review',
          preReviewCount: 5,
          fsrsState: makeFsrsState(),
        },
      });
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'audio',
        timeSpentMs: 2000,
      });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'good',
        timezone: 'UTC',
        reviewMode: 'full',
        // Way above the clamp: an abandoned open card must not skew the mean.
        timeSpentMs: REVIEW_TIME_CLAMP_MAX_MS * 10,
      });
      const card = await getCard(t, cardId);
      expect(card.reviewTimeStats?.audio).toEqual({ avgMs: 2000, count: 1 });
      expect(card.reviewTimeStats?.full).toEqual({
        avgMs: REVIEW_TIME_CLAMP_MAX_MS,
        count: 1,
      });
    });

    it('a review without timeSpentMs records no sample', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seed(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
      });
      const card = await getCard(t, cardId);
      expect(card.reviewTimeStats).toBeUndefined();
    });

    it('undo reverses the mean exactly, removing the entry at count 1', async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seed(t);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
        timeSpentMs: 4000,
      });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: 'stillLearning',
        timezone: 'UTC',
        timeSpentMs: 8000,
      });

      await asUser.mutation(api.features.scheduling.undoLastReview, {
        timezone: 'UTC',
      });
      let card = await getCard(t, cardId);
      expect(card.reviewTimeStats?.audio?.count).toBe(1);
      expect(card.reviewTimeStats?.audio?.avgMs).toBeCloseTo(4000, 6);

      await asUser.mutation(api.features.scheduling.undoLastReview, {
        timezone: 'UTC',
      });
      card = await getCard(t, cardId);
      expect(card.reviewTimeStats?.audio).toBeUndefined();
    });
  });
});
