/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, afterEach } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';
import {
  ADD_SCAN_CAP,
  flipBatchBetweenSources,
} from '../../features/collectionCardAdding';
import type { Id } from '../../_generated/dataModel';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * Auto-add draws half its cards from the premade level collection and half
 * from the user's custom collections, by a fair coin flip per card. Premade
 * cards spend SENTENCES credits and custom ones don't, so an empty balance
 * has to send every flip to the custom side rather than cutting the batch
 * short — that fallback is what most of this file pins.
 */

describe('flipBatchBetweenSources', () => {
  /** Drives Math.random through a fixed cycle of values. */
  function withCoin<T>(values: number[], fn: () => T): T {
    let i = 0;
    const spy = vi
      .spyOn(Math, 'random')
      .mockImplementation(() => values[i++ % values.length]);
    try {
      return fn();
    } finally {
      spy.mockRestore();
    }
  }

  const HEADS = 0.1; // < 0.5 → custom
  const TAILS = 0.9; // >= 0.5 → premade

  it('splits an alternating coin down the middle', () => {
    const split = withCoin([HEADS, TAILS], () =>
      flipBatchBetweenSources(10, 10, 10),
    );
    expect(split).toEqual({ customBudget: 5, premadeBudget: 5 });
  });

  it('honours the coin when both sources have room', () => {
    expect(withCoin([HEADS], () => flipBatchBetweenSources(6, 6, 6))).toEqual({
      customBudget: 6,
      premadeBudget: 0,
    });
    expect(withCoin([TAILS], () => flipBatchBetweenSources(6, 6, 6))).toEqual({
      customBudget: 0,
      premadeBudget: 6,
    });
  });

  it('sends every slot to custom once the credits run out', () => {
    // The requested behaviour: out of credits, custom cards left → add those.
    const split = withCoin([HEADS, TAILS], () =>
      flipBatchBetweenSources(8, 20, 0),
    );
    expect(split).toEqual({ customBudget: 8, premadeBudget: 0 });
  });

  it('sends every slot to premade when no custom texts are pending', () => {
    const split = withCoin([HEADS, TAILS], () =>
      flipBatchBetweenSources(8, 0, 20),
    );
    expect(split).toEqual({ customBudget: 0, premadeBudget: 8 });
  });

  it('spills past a cap instead of leaving the batch short', () => {
    // Only 2 custom texts pending, but the coin asks for custom every time:
    // the remaining 6 slots go to premade.
    const split = withCoin([HEADS], () => flipBatchBetweenSources(8, 2, 20));
    expect(split).toEqual({ customBudget: 2, premadeBudget: 6 });
  });

  it('never allocates more than either side can supply', () => {
    const split = withCoin([HEADS, TAILS], () =>
      flipBatchBetweenSources(10, 2, 3),
    );
    expect(split).toEqual({ customBudget: 2, premadeBudget: 3 });
  });

  it('allocates nothing when neither source can supply', () => {
    expect(
      withCoin([HEADS, TAILS], () => flipBatchBetweenSources(10, 0, 0)),
    ).toEqual({ customBudget: 0, premadeBudget: 0 });
  });

  it('stays fair over many flips with real randomness', () => {
    const { customBudget, premadeBudget } = flipBatchBetweenSources(
      2000,
      2000,
      2000,
    );
    expect(customBudget + premadeBudget).toBe(2000);
    // ±5σ on a fair coin over 2000 flips is ~112; anything outside that is a
    // broken coin, not bad luck.
    expect(Math.abs(customBudget - premadeBudget)).toBeLessThan(224);
  });
});

/**
 * A course with a premade level collection ("A1") and one custom collection,
 * both stocked with texts, plus a SENTENCES balance.
 */
async function seedBothSources(
  t: TestConvex<typeof schema>,
  opts: {
    premadeTexts?: number;
    customTexts?: number;
    quotaBalance?: number;
    studyContentFilter?: 'both' | 'course' | 'custom';
  } = {},
) {
  const {
    premadeTexts = 20,
    customTexts = 20,
    quotaBalance = 100,
    studyContentFilter,
  } = opts;
  return t.run(async (ctx) => {
    const premadeColl = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: premadeTexts,
    });
    const customColl = await ctx.db.insert('collections', {
      name: 'custom-abc',
      origin: 'custom',
      textCount: customTexts,
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
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 0,
    });
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: 3,
      activeCollectionId: premadeColl,
      activeCustomCollectionIds: [customColl],
      ...(studyContentFilter ? { studyContentFilter } : {}),
    });
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        sentences: {
          balance: quotaBalance,
          included: 100,
          used: 0,
          unlimited: false,
        },
      },
      lastSyncedAt: Date.now(),
    });
    for (let i = 1; i <= premadeTexts; i++) {
      await ctx.db.insert('texts', {
        text: `Premade ${i}`,
        language: 'es',
        userCreated: false,
        collectionId: premadeColl,
        collectionRank: i,
      });
    }
    for (let i = 1; i <= customTexts; i++) {
      await ctx.db.insert('texts', {
        text: `Custom ${i}`,
        language: 'es',
        userCreated: true,
        // The custom scan is scoped by owner (`forUserId`), so these have to
        // carry the user id or they're invisible to the add path.
        userId: 'user_A',
        collectionId: customColl,
        collectionRank: i,
      });
    }
    return { premadeColl, customColl, courseId, deckId };
  });
}

/** Cards in the deck grouped by the collection they came from. */
async function cardCounts(
  t: TestConvex<typeof schema>,
  deckId: Id<'decks'>,
  premadeColl: Id<'collections'>,
  customColl: Id<'collections'>,
) {
  const cards = await t.run(async (ctx) =>
    ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
      .collect(),
  );
  return {
    premade: cards.filter((c) => c.collectionId === premadeColl).length,
    custom: cards.filter((c) => c.collectionId === customColl).length,
    total: cards.length,
  };
}

function sentencesBalance(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
      .unique();
    return doc?.features.sentences?.balance ?? null;
  });
}

/**
 * The add path schedules `prepareCardContent` per text. Nothing here drains
 * it (these tests only care about which cards got inserted), so the mutation
 * runs under fake timers and `drainSchedulerAfterEach` clears the queue.
 */
function useFakeTimersForScheduler() {
  vi.useFakeTimers();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('auto-add: splitting the batch between premade and custom', () => {
  it('draws from both sources on a fair coin', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    // Alternating coin: 5 custom, 5 premade. The pool pick inside the custom
    // drain also reads Math.random, but with a single custom collection every
    // value floors to index 0.
    let i = 0;
    const spy = vi
      .spyOn(Math, 'random')
      .mockImplementation(() => (i++ % 2 === 0 ? 0.1 : 0.9));
    try {
      const res = await asUser.mutation(
        api.features.decks.addCardsFromCollection,
        { collectionId: premadeColl, batchSize: 10 },
      );
      expect(res.cardsAdded).toBe(10);
    } finally {
      spy.mockRestore();
    }

    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts).toEqual({ premade: 5, custom: 5, total: 10 });
    // Only the premade half is billed.
    expect(await sentencesBalance(t)).toBe(95);
  });

  it('adds custom cards only, and bills nothing, when the credits are gone', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t, {
      quotaBalance: 0,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: premadeColl, batchSize: 10 },
    );

    // The whole batch, not the leftovers of a half batch.
    expect(res.cardsAdded).toBe(10);
    // Reported so the client can tell "out of credits" (retry on refill)
    // apart from "collection drained" (don't).
    expect(res.quotaLimited).toBe(true);
    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts).toEqual({ premade: 0, custom: 10, total: 10 });
    expect(await sentencesBalance(t)).toBe(0);
  });

  it('adds what custom has left when the credits are gone and custom is short', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t, {
      quotaBalance: 0,
      customTexts: 3,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: premadeColl, batchSize: 10 },
    );

    expect(res.cardsAdded).toBe(3);
    expect(res.quotaLimited).toBe(true);
    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts).toEqual({ premade: 0, custom: 3, total: 3 });
  });

  it('adds nothing and reports the quota when neither source can supply', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl } = await seedBothSources(t, {
      quotaBalance: 0,
      customTexts: 0,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: premadeColl, batchSize: 10 },
    );

    expect(res.cardsAdded).toBe(0);
    expect(res.quotaLimited).toBe(true);
  });

  it('clamps the premade half to the balance and gives the rest to custom', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t, {
      quotaBalance: 2,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: premadeColl, batchSize: 10 },
    );

    expect(res.cardsAdded).toBe(10);
    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts.premade).toBeLessThanOrEqual(2);
    expect(counts.total).toBe(10);
    expect(await sentencesBalance(t)).toBe(2 - counts.premade);
  });

  it('tops the batch up from custom when the premade collection runs dry', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t, {
      premadeTexts: 2,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: premadeColl, batchSize: 10 },
    );

    expect(res.cardsAdded).toBe(10);
    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts.premade).toBe(2);
    expect(counts.custom).toBe(8);
  });

  it('tops the batch up from premade when custom runs dry', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t, {
      customTexts: 2,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: premadeColl, batchSize: 10 },
    );

    expect(res.cardsAdded).toBe(10);
    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts.custom).toBe(2);
    expect(counts.premade).toBe(8);
  });

  it("filter 'course' still takes the whole batch from the premade source", async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t, {
      studyContentFilter: 'course',
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.decks.addCardsFromCollection, {
      collectionId: premadeColl,
      batchSize: 10,
    });

    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts).toEqual({ premade: 10, custom: 0, total: 10 });
  });

  it("filter 'custom' still takes the whole batch from the custom source", async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t, {
      studyContentFilter: 'custom',
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.decks.addCardsFromCollection, {
      collectionId: premadeColl,
      batchSize: 10,
    });

    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts).toEqual({ premade: 0, custom: 10, total: 10 });
    expect(await sentencesBalance(t)).toBe(100);
  });

  it('a capped custom scan still gets its slots back in the top-up pass', async () => {
    // The regression this pins: the custom pass spends `pendingCount` when it
    // ALLOCATES slots, before it knows how many texts it can find. A scan that
    // hits ADD_SCAN_CAP mid-streak fills none of them, and if those slots stay
    // spent the collection reads as drained — so the Phase 3 top-up, the very
    // thing that exists to rescue a short premade half, skips it and the batch
    // ends short.
    //
    // Shape: custom has an ignored streak one scan-cap long with 5 addable
    // texts just past it; premade has only 3 texts, so the top-up genuinely
    // has 7 slots to hand out.
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const ignoredCount = ADD_SCAN_CAP + 5;
    const { premadeColl, customColl, courseId, deckId } = await seedBothSources(
      t,
      { premadeTexts: 3, customTexts: ignoredCount + 5 },
    );

    // Chunked: one transaction for 1500+ marks is needlessly slow.
    const customTextIds = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('texts')
          .withIndex('by_collection_and_rank', (q) =>
            q.eq('collectionId', customColl),
          )
          .collect()
      ).map((doc) => doc._id),
    );
    const CHUNK = 500;
    for (let start = 0; start < ignoredCount; start += CHUNK) {
      const end = Math.min(start + CHUNK, ignoredCount);
      await t.run(async (ctx) => {
        for (let i = start; i < end; i++) {
          await ctx.db.insert('collectionTextMarks', {
            userId: 'user_A',
            courseId,
            collectionId: customColl,
            textId: customTextIds[i],
            mark: 'ignored',
            collectionRank: i + 1,
          });
        }
      });
    }
    await t.run(async (ctx) => {
      await ctx.db.insert('collectionProgress', {
        userId: 'user_A',
        courseId,
        collectionId: customColl,
        cardsAdded: 0,
        ignoredCount,
      });
    });

    const asUser = t.withIdentity({ subject: 'user_A' });
    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: premadeColl, batchSize: 10 },
    );

    // 3 premade (all it has) + the 5 addable custom texts the top-up reached
    // past the streak. Before the fix this was 3.
    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts).toEqual({ premade: 3, custom: 5, total: 8 });
    expect(res.cardsAdded).toBe(8);
    // Still short of 10, and the cap is why — the client re-calls on this.
    expect(res.scanIncomplete).toBe(true);
    // 1500+ inserts: ~1.3 s alone, 8 s+ under coverage instrumentation.
  }, 30_000);

  it('an exclusive add from one collection is not split', async () => {
    // The collection-detail "add" button targets one collection; the coin
    // flip must not pull in the other source.
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl, deckId } = await seedBothSources(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.decks.addCardsFromCollection, {
      collectionId: customColl,
      batchSize: 6,
      exclusive: true,
    });

    const counts = await cardCounts(t, deckId, premadeColl, customColl);
    expect(counts).toEqual({ premade: 0, custom: 6, total: 6 });
    expect(await sentencesBalance(t)).toBe(100);
  });
});

describe('hasPendingCustomCards', () => {
  it('is true while a custom collection still has texts, false once drained', async () => {
    useFakeTimersForScheduler();
    const t = convexTest(schema, modules);
    const { premadeColl, customColl } = await seedBothSources(t, {
      customTexts: 2,
      quotaBalance: 0,
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    expect(
      await asUser.query(api.features.decks.hasPendingCustomCards, {}),
    ).toBe(true);

    await asUser.mutation(api.features.decks.addCardsFromCollection, {
      collectionId: premadeColl,
      batchSize: 10,
    });

    expect(
      await asUser.query(api.features.decks.hasPendingCustomCards, {}),
    ).toBe(false);
    expect(customColl).toBeDefined();
  });

  it("is false under the 'course' filter, however many texts are waiting", async () => {
    // The regression: the add path sets `skipCustomSources` for this filter,
    // so a true here promises a run that adds nothing. The learn view keeps
    // its seamless-loading card up on that promise and never clears it —
    // `quotaLimited` sets the empty-credits ref, not the exhausted one.
    const t = convexTest(schema, modules);
    await seedBothSources(t, {
      customTexts: 5,
      quotaBalance: 0,
      studyContentFilter: 'course',
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    expect(
      await asUser.query(api.features.decks.hasPendingCustomCards, {}),
    ).toBe(false);
  });

  it("still reports pending texts under the 'custom' filter", async () => {
    const t = convexTest(schema, modules);
    await seedBothSources(t, {
      customTexts: 5,
      quotaBalance: 0,
      studyContentFilter: 'custom',
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    expect(
      await asUser.query(api.features.decks.hasPendingCustomCards, {}),
    ).toBe(true);
  });

  it('is false for a user with no custom collections', async () => {
    const t = convexTest(schema, modules);
    await seedBothSources(t, { customTexts: 0 });
    await t.run(async (ctx) => {
      const settings = await ctx.db.query('courseSettings').unique();
      await ctx.db.patch(settings!._id, { activeCustomCollectionIds: [] });
    });
    const asUser = t.withIdentity({ subject: 'user_A' });
    expect(
      await asUser.query(api.features.decks.hasPendingCustomCards, {}),
    ).toBe(false);
  });

  it('is false for an unauthenticated caller', async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.features.decks.hasPendingCustomCards, {})).toBe(
      false,
    );
  });
});
