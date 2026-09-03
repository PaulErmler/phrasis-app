/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, afterEach } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();
afterEach(() => {
  vi.useRealTimers();
});

/**
 * The learn view adds the next batch while the LAST due card is still on
 * screen. New cards are stamped due two minutes in the past so minute-
 * quantized readers see them at once, and that backdate sorted the batch
 * AHEAD of a card rescheduled within the last two minutes, so the reactive
 * due query swapped the card out mid-read. With `afterCardId` the batch is
 * placed just after the card on screen instead.
 */

const USER = 'user_A';

async function seedCourseWithTexts(
  t: TestConvex<typeof schema>,
  count: number,
) {
  return t.run(async (ctx) => {
    const collId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: count,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: USER,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: USER,
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 0,
    });
    await ctx.db.insert('usageQuotas', {
      userId: USER,
      features: {
        sentences: { balance: 100, included: 100, used: 0, unlimited: false },
      },
      lastSyncedAt: Date.now(),
    });
    const textIds: Id<'texts'>[] = [];
    for (let i = 1; i <= count; i++) {
      textIds.push(
        await ctx.db.insert('texts', {
          text: `Hola ${i}`,
          language: 'es',
          userCreated: false,
          collectionId: collId,
          collectionRank: i,
        }),
      );
    }
    return { collId, courseId, deckId, textIds };
  });
}

/** A card that was rescheduled a moment ago and is due now. */
async function seedRecentlyDueCard(
  t: TestConvex<typeof schema>,
  deckId: Id<'decks'>,
  textId: Id<'texts'>,
  collectionId: Id<'collections'>,
  dueDate: number,
) {
  return t.run((ctx) =>
    ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 1,
    }),
  );
}

async function dueDatesOfOtherCards(
  t: TestConvex<typeof schema>,
  deckId: Id<'decks'>,
  except: Id<'cards'>,
) {
  return t.run(async (ctx) => {
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
      .collect();
    return cards.filter((c) => c._id !== except).map((c) => c.dueDate);
  });
}

describe('addCardsFromCollection: batch added behind the card on screen', () => {
  it('places every new card after the shown card in the due order', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { collId, deckId, textIds } = await seedCourseWithTexts(t, 4);
    // Rescheduled 30s ago: inside the two-minute backdate window.
    const shownDue = Date.now() - 30_000;
    const shownCard = await seedRecentlyDueCard(
      t,
      deckId,
      textIds[0],
      collId,
      shownDue,
    );
    const asUser = t.withIdentity({ subject: USER });

    const res = await asUser.mutation(
      api.features.decks.addCardsFromCollection,
      { collectionId: collId, batchSize: 3, afterCardId: shownCard },
    );
    expect(res.cardsAdded).toBe(3);

    const dues = await dueDatesOfOtherCards(t, deckId, shownCard);
    expect(dues).toHaveLength(3);
    for (const due of dues) {
      expect(due).toBeGreaterThan(shownDue);
      // ...and still due right now for the client that asked.
      expect(due).toBeLessThanOrEqual(Date.now());
    }
    // In-batch FIFO is kept.
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);
  });

  it('keeps the backdated stamp when no card is on screen (empty-deck auto-add)', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { collId, deckId, textIds } = await seedCourseWithTexts(t, 4);
    const shownDue = Date.now() - 30_000;
    const shownCard = await seedRecentlyDueCard(
      t,
      deckId,
      textIds[0],
      collId,
      shownDue,
    );
    const asUser = t.withIdentity({ subject: USER });

    await asUser.mutation(api.features.decks.addCardsFromCollection, {
      collectionId: collId,
      batchSize: 3,
    });

    const dues = await dueDatesOfOtherCards(t, deckId, shownCard);
    for (const due of dues) {
      expect(due).toBeLessThan(shownDue);
    }
  });

  it('custom cards that top up a drained premade half queue behind the shown card too', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    // The level collection's only text is the shown card itself, so the
    // premade half has nothing left to add.
    const { collId, courseId, deckId, textIds } = await seedCourseWithTexts(
      t,
      1,
    );
    const customColl = await t.run(async (ctx) => {
      const customColl = await ctx.db.insert('collections', {
        name: 'custom-abc',
        origin: 'custom',
        textCount: 5,
      });
      await ctx.db.insert('courseSettings', {
        courseId,
        initialReviewCount: 3,
        activeCollectionId: collId,
        activeCustomCollectionIds: [customColl],
      });
      for (let i = 1; i <= 5; i++) {
        await ctx.db.insert('texts', {
          text: `Custom ${i}`,
          language: 'es',
          userCreated: true,
          // The custom scan is scoped by owner (`forUserId`).
          userId: USER,
          collectionId: customColl,
          collectionRank: i,
        });
      }
      return customColl;
    });
    const shownDue = Date.now() - 30_000;
    const shownCard = await seedRecentlyDueCard(
      t,
      deckId,
      textIds[0],
      collId,
      shownDue,
    );
    const asUser = t.withIdentity({ subject: USER });

    // Every coin lands on premade, which comes up empty, so the whole batch
    // arrives through the custom top-up pass (Phase 3), the path that used
    // to drop the floor.
    const coin = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const res = await asUser.mutation(
        api.features.decks.addCardsFromCollection,
        { collectionId: collId, batchSize: 3, afterCardId: shownCard },
      );
      expect(res.cardsAdded).toBe(3);
    } finally {
      coin.mockRestore();
    }

    const added = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('cards')
          .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
          .collect()
      ).filter((c) => c._id !== shownCard),
    );
    expect(added).toHaveLength(3);
    for (const card of added) {
      expect(card.collectionId).toBe(customColl);
      expect(card.dueDate).toBeGreaterThan(shownDue);
      expect(card.dueDate).toBeLessThanOrEqual(Date.now());
    }
  });

  it('ignores an afterCardId from another deck', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { collId, deckId, textIds } = await seedCourseWithTexts(t, 4);
    const foreignDeck = await t.run(async (ctx) => {
      const otherCourse = await ctx.db.insert('courses', {
        userId: 'user_B',
        baseLanguages: ['en'],
        targetLanguages: ['es'],
      });
      return ctx.db.insert('decks', {
        courseId: otherCourse,
        name: 'other',
        cardCount: 0,
      });
    });
    const foreignCard = await seedRecentlyDueCard(
      t,
      foreignDeck,
      textIds[0],
      collId,
      Date.now() - 30_000,
    );
    const asUser = t.withIdentity({ subject: USER });

    await asUser.mutation(api.features.decks.addCardsFromCollection, {
      collectionId: collId,
      batchSize: 2,
      afterCardId: foreignCard,
    });

    const dues = await dueDatesOfOtherCards(t, deckId, foreignCard);
    expect(dues).toHaveLength(2);
    for (const due of dues) {
      expect(due).toBeLessThan(Date.now() - 60_000);
    }
  });
});
