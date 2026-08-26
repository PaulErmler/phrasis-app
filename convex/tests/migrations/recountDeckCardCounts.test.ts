/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi } from 'vitest';

import schema from '../../schema';
import {
  recountDeckCardCountOne,
  DECK_RECOUNT_PAGE,
} from '../../migrations';
import type { Id } from '../../_generated/dataModel';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * Seed one deck whose stored `cardCount` disagrees with its actual card rows
 * — the historical drift shape this migration repairs (increments without
 * decrements inflated the counter on every permanent delete).
 */
async function seedDeck(
  t: TestConvex<typeof schema>,
  opts: { storedCount: number; actualCards: number },
): Promise<Id<'decks'>> {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: opts.actualCards,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: opts.storedCount,
    });
    for (let i = 0; i < opts.actualCards; i++) {
      const textId = await ctx.db.insert('texts', {
        text: `t${i}`,
        language: 'es',
        userCreated: false,
        collectionId,
        collectionRank: i + 1,
      });
      await ctx.db.insert('cards', {
        deckId,
        textId,
        collectionId,
        collectionOrigin: 'premade',
        dueDate: i,
        isMastered: false,
        isHidden: false,
        schedulingPhase: 'preReview',
        preReviewCount: 0,
      });
    }
    return deckId;
  });
}

/**
 * Run `migrateOne` the way the migrations component does: apply the returned
 * patch (if any) in the same transaction. Same extracted-body approach as the
 * other migration suites (the component itself isn't registered here).
 */
async function runOne(t: TestConvex<typeof schema>, deckId: Id<'decks'>) {
  return t.run(async (ctx) => {
    const deck = (await ctx.db.get(deckId))!;
    const patch = await recountDeckCardCountOne(ctx, deck);
    if (patch) await ctx.db.patch(deckId, patch);
    // `t.run` serializes the result, turning `undefined` into `null`.
    return patch ?? null;
  });
}

async function storedCount(t: TestConvex<typeof schema>, deckId: Id<'decks'>) {
  return t.run(async (ctx) => (await ctx.db.get(deckId))?.cardCount);
}

describe('recountDeckCardCounts', () => {
  it('repairs an inflated counter from the actual card rows', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t, { storedCount: 7, actualCards: 3 });

    const patch = await runOne(t, deckId);

    expect(patch).toEqual({ cardCount: 3 });
    expect(await storedCount(t, deckId)).toBe(3);
  });

  it('also repairs a drifted-LOW counter', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t, { storedCount: 1, actualCards: 4 });

    await runOne(t, deckId);

    expect(await storedCount(t, deckId)).toBe(4);
  });

  it('returns no patch for a deck whose counter is already correct', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t, { storedCount: 2, actualCards: 2 });

    expect(await runOne(t, deckId)).toBeNull();
    expect(await storedCount(t, deckId)).toBe(2);
  });

  it('counts an empty deck down to 0', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t, { storedCount: 5, actualCards: 0 });

    const patch = await runOne(t, deckId);

    expect(patch).toEqual({ cardCount: 0 });
    expect(await storedCount(t, deckId)).toBe(0);
  });

  it('finishes an over-one-page deck via the scheduled continuation', async () => {
    const t = convexTest(schema, modules);
    const total = DECK_RECOUNT_PAGE + 3;
    const deckId = await seedDeck(t, { storedCount: 1, actualCards: total });

    // Fake timers so the 0ms continuation timers are pumped at a controlled
    // point by `finishAllScheduledFunctions` (recalcUserCardAggregates
    // precedent).
    vi.useFakeTimers();
    try {
      // First page doesn't exhaust the index range → migrateOne hands off to
      // the self-continuing chain instead of patching a partial count.
      const patch = await runOne(t, deckId);
      expect(patch).toBeNull();
      expect(await storedCount(t, deckId)).toBe(1); // untouched so far

      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await storedCount(t, deckId)).toBe(total);
    } finally {
      vi.useRealTimers();
    }
  });
});
