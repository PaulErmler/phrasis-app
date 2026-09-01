/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * The E2E hooks behind `features/customSourceTesting.ts` and
 * `deckTesting:cardCountsBySource`, which `e2e/auto-add-sources.spec.ts`
 * drives. The e2e spec never runs in CI, and a seeding hook that quietly
 * miscounts would make it assert nothing — so the bookkeeping is pinned
 * here: ranks continue past the frontier, `textCount` moves both ways, and
 * cleanup gives back exactly the progress the cards booked.
 */

const EMAIL = 'user-a@e2e.test';
const USER_ID = 'user_A';

async function seedUser(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    await ctx.db.insert('userProfiles', {
      userId: USER_ID,
      email: EMAIL,
      name: 'Test User',
      createdAt: Date.now(),
      searchText: `${EMAIL} test user`,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: USER_ID,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: USER_ID,
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 0,
    });
    await ctx.db.insert('courseSettings', { courseId, initialReviewCount: 3 });
    return { courseId, deckId };
  });
}

function customCollection(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('collections')
      .filter((q) => q.eq(q.field('origin'), 'custom'))
      .first(),
  );
}

describe('customSourceTesting hooks', () => {
  describe('without E2E_TEST_HOOKS', () => {
    beforeEach(() => {
      delete process.env.E2E_TEST_HOOKS;
    });

    it('refuses to seed', async () => {
      const t = convexTest(schema, modules);
      await seedUser(t);
      await expect(
        t.mutation(internal.features.customSourceTesting.seedCustomTexts, {
          email: EMAIL,
          count: 3,
          marker: 'm',
        }),
      ).rejects.toThrow(/E2E test hooks are disabled/);
    });

    it('refuses to defer due cards', async () => {
      const t = convexTest(schema, modules);
      await seedUser(t);
      await expect(
        t.mutation(internal.features.customSourceTesting.deferDueCards, {
          email: EMAIL,
        }),
      ).rejects.toThrow(/E2E test hooks are disabled/);
    });
  });

  describe('with E2E_TEST_HOOKS=1', () => {
    beforeEach(() => {
      process.env.E2E_TEST_HOOKS = '1';
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      delete process.env.E2E_TEST_HOOKS;
    });

    it('creates the custom collection, ranks the texts, and counts them', async () => {
      const t = convexTest(schema, modules);
      await seedUser(t);

      const first = await t.mutation(
        internal.features.customSourceTesting.seedCustomTexts,
        { email: EMAIL, count: 4, marker: 'alpha' },
      );
      expect(first.textIds).toHaveLength(4);

      const coll = await customCollection(t);
      expect(coll?.textCount).toBe(4);
      // Appended to the settings list, or the add path never looks at it.
      const settings = await t.run(async (ctx) =>
        ctx.db.query('courseSettings').unique(),
      );
      expect(settings?.activeCustomCollectionIds).toEqual([coll!._id]);

      // A second seed continues past the first, rather than colliding on the
      // ranks the add scan walks.
      const second = await t.mutation(
        internal.features.customSourceTesting.seedCustomTexts,
        { email: EMAIL, count: 3, marker: 'beta' },
      );
      const ranks = await t.run(async (ctx) =>
        Promise.all(
          [...first.textIds, ...second.textIds].map(async (id) => {
            const doc = await ctx.db.get(id);
            return doc?.collectionRank;
          }),
        ),
      );
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect((await customCollection(t))?.textCount).toBe(7);
    });

    it('rejects a count outside the seeding cap', async () => {
      const t = convexTest(schema, modules);
      await seedUser(t);
      await expect(
        t.mutation(internal.features.customSourceTesting.seedCustomTexts, {
          email: EMAIL,
          count: 0,
          marker: 'm',
        }),
      ).rejects.toThrow(/count must be/);
    });

    it('cleanup removes the texts, their cards, and the progress they booked', async () => {
      const t = convexTest(schema, modules);
      await seedUser(t);
      const seeded = await t.mutation(
        internal.features.customSourceTesting.seedCustomTexts,
        { email: EMAIL, count: 5, marker: 'gamma' },
      );
      const asUser = t.withIdentity({ subject: USER_ID });

      // Turn three of them into cards through the real add path, so the
      // progress row and the card rows are the ones the app would write.
      const added = await asUser.mutation(
        api.features.decks.addCardsFromCollection,
        {
          collectionId: seeded.collectionId,
          batchSize: 3,
          exclusive: true,
        },
      );
      expect(added.cardsAdded).toBe(3);

      const counts = await t.query(
        internal.features.deckTesting.cardCountsBySource,
        { email: EMAIL },
      );
      expect(counts).toEqual({ premade: 0, custom: 3, total: 3 });

      const cleaned = await t.mutation(
        internal.features.customSourceTesting.cleanupSeededTexts,
        { email: EMAIL, textIds: seeded.textIds },
      );
      expect(cleaned).toEqual({ textsDeleted: 5, cardsDeleted: 3 });

      expect(
        await t.query(internal.features.deckTesting.cardCountsBySource, {
          email: EMAIL,
        }),
      ).toEqual({ premade: 0, custom: 0, total: 0 });
      expect((await customCollection(t))?.textCount).toBe(0);
      // The progress row must come back down with the cards, or the next run
      // finds a Custom collection that reports itself complete.
      const progress = await t.run(async (ctx) =>
        ctx.db.query('collectionProgress').first(),
      );
      expect(progress?.cardsAdded ?? 0).toBe(0);
    });

    it('rewinds the add frontier so leftover unadded texts stay reachable', async () => {
      const t = convexTest(schema, modules);
      await seedUser(t);
      const first = await t.mutation(
        internal.features.customSourceTesting.seedCustomTexts,
        { email: EMAIL, count: 5, marker: 'frontier' },
      );
      const asUser = t.withIdentity({ subject: USER_ID });
      await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: first.collectionId,
        batchSize: 3,
        exclusive: true,
      });

      await t.mutation(
        internal.features.customSourceTesting.cleanupSeededTexts,
        { email: EMAIL, textIds: first.textIds },
      );

      const leftover = await t.mutation(
        internal.features.customSourceTesting.seedCustomTexts,
        { email: EMAIL, count: 1, marker: 'afterCleanup' },
      );
      const added = await asUser.mutation(
        api.features.decks.addCardsFromCollection,
        {
          collectionId: leftover.collectionId,
          batchSize: 1,
          exclusive: true,
        },
      );
      expect(added.cardsAdded).toBe(1);
    });

    it('pushes due cards out of the queue without deleting them', async () => {
      const t = convexTest(schema, modules);
      const { deckId } = await seedUser(t);
      const seeded = await t.mutation(
        internal.features.customSourceTesting.seedCustomTexts,
        { email: EMAIL, count: 3, marker: 'defer' },
      );
      const asUser = t.withIdentity({ subject: USER_ID });
      await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: seeded.collectionId,
        batchSize: 3,
        exclusive: true,
      });

      const dueBefore = await t.run(async (ctx) => {
        const cards = await ctx.db
          .query('cards')
          .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
          .take(10);
        return cards.map((c) => c.dueDate);
      });
      expect(dueBefore).toHaveLength(3);
      expect(dueBefore.every((d) => d <= Date.now())).toBe(true);

      const result = await t.mutation(
        internal.features.customSourceTesting.deferDueCards,
        { email: EMAIL },
      );
      expect(result.deferred).toBe(3);

      const after = await t.run(async (ctx) => {
        const cards = await ctx.db
          .query('cards')
          .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
          .take(10);
        return cards.map((c) => ({
          dueDate: c.dueDate,
          writingDueDate: c.writingDueDate,
        }));
      });
      expect(after).toHaveLength(3);
      expect(after.every((c) => c.dueDate > Date.now())).toBe(true);
      // Unseeded writing tracks stay unseeded — a due-date bump is not a seed.
      expect(after.every((c) => c.writingDueDate === undefined)).toBe(true);

      const second = await t.mutation(
        internal.features.customSourceTesting.deferDueCards,
        { email: EMAIL },
      );
      expect(second.deferred).toBe(0);
    });

    it('cleanup tolerates ids whose texts are already gone', async () => {
      const t = convexTest(schema, modules);
      await seedUser(t);
      const seeded = await t.mutation(
        internal.features.customSourceTesting.seedCustomTexts,
        { email: EMAIL, count: 2, marker: 'delta' },
      );
      await t.run(async (ctx) => {
        await ctx.db.delete(seeded.textIds[0] as Id<'texts'>);
      });
      const cleaned = await t.mutation(
        internal.features.customSourceTesting.cleanupSeededTexts,
        { email: EMAIL, textIds: seeded.textIds },
      );
      expect(cleaned.textsDeleted).toBe(1);
    });
  });
});
