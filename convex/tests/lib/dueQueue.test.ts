/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import { fetchTrackDueCards } from '../../lib/dueQueue';
import type {
  SchedulingMode,
  SchedulingTrack,
  StudyContentFilter,
} from '../../types';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * Unit tests for `fetchTrackDueCards`, the one selector both scheduling
 * tracks' due queues draw from (serving path, empty-reason probe, and the
 * content warmer all route through it). The suite pins:
 *
 *   - the merge-sort ordering (due date asc, `_creationTime` tiebreak) and
 *     the `take` cap, for mixed sets of new / learning / overdue cards;
 *   - the available-now boundary: due exactly at `now` is served, one
 *     millisecond later ("later today") is not;
 *   - learn_new mode serving only ungraduated cards on each track;
 *   - the writing-track rule that cards never seeded into the writing
 *     schedule (undefined `writingDueDate`) are NOT served as overdue
 *     backlog, even though undefined sorts before every number in the index;
 *   - the content-source filter semantics ('both' / 'course' /
 *     'custom'-merges-custom+chat) including truncation safety across the
 *     per-origin fan-out.
 */

/** Fixed reference clock. Cards are seeded relative to this. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function seedDeck(t: TestConvex<typeof schema>) {
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
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 0,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hola',
      language: 'es',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    return { deckId, textId, collectionId };
  });
}

type CardSeed = {
  dueDate: number;
  /** Default false (new/learning card). */
  isGraduated?: boolean;
  /** Omit for a card with no collectionOrigin (the 'none' bucket). */
  origin?: 'premade' | 'custom' | 'chat';
  isHidden?: boolean;
  isMastered?: boolean;
  writingDueDate?: number;
  writingIsGraduated?: boolean;
};

async function insertCard(
  t: TestConvex<typeof schema>,
  base: {
    deckId: Id<'decks'>;
    textId: Id<'texts'>;
    collectionId: Id<'collections'>;
  },
  seed: CardSeed,
): Promise<Id<'cards'>> {
  return t.run((ctx) =>
    ctx.db.insert('cards', {
      deckId: base.deckId,
      textId: base.textId,
      collectionId: base.collectionId,
      ...(seed.origin ? { collectionOrigin: seed.origin } : {}),
      dueDate: seed.dueDate,
      isGraduated: seed.isGraduated ?? false,
      isMastered: seed.isMastered ?? false,
      isHidden: seed.isHidden ?? false,
      schedulingPhase: seed.isGraduated ? 'review' : 'preReview',
      preReviewCount: 0,
      ...(seed.writingDueDate !== undefined
        ? { writingDueDate: seed.writingDueDate }
        : {}),
      ...(seed.writingIsGraduated !== undefined
        ? { writingIsGraduated: seed.writingIsGraduated }
        : {}),
    }),
  );
}

async function fetchDue(
  t: TestConvex<typeof schema>,
  deckId: Id<'decks'>,
  opts: {
    mode?: SchedulingMode;
    filter?: StudyContentFilter;
    track?: SchedulingTrack;
    now?: number;
    take?: number;
  } = {},
): Promise<Id<'cards'>[]> {
  const cards = await t.run((ctx) =>
    fetchTrackDueCards(
      ctx,
      deckId,
      opts.mode ?? 'learnAndReview',
      opts.filter ?? 'both',
      opts.track ?? 'shared',
      opts.now ?? NOW,
      opts.take ?? 10,
    ),
  );
  return cards.map((c) => c._id);
}

describe('lib/dueQueue fetchTrackDueCards', () => {
  describe('shared track', () => {
    it('orders a mixed new/learning/overdue set by due date and caps at take', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);

      // Insert in scrambled order so the result order can only come from the
      // index/merge sort, not insertion order.
      const youngLearning = await insertCard(t, base, {
        dueDate: NOW - 1 * HOUR, // learning card that came back due
        isGraduated: false,
      });
      const overdueReview = await insertCard(t, base, {
        dueDate: NOW - 3 * DAY, // graduated review card, days of backlog
        isGraduated: true,
      });
      const brandNew = await insertCard(t, base, {
        dueDate: NOW, // just-added card, due immediately
        isGraduated: false,
      });
      await insertCard(t, base, {
        dueDate: NOW + 1 * HOUR, // later today — not available now
        isGraduated: true,
      });

      expect(await fetchDue(t, base.deckId)).toEqual([
        overdueReview,
        youngLearning,
        brandNew,
      ]);

      // The cap truncates from the tail: the most-overdue cards win.
      expect(await fetchDue(t, base.deckId, { take: 2 })).toEqual([
        overdueReview,
        youngLearning,
      ]);
    });

    it('serves a card due exactly at now but not one due a millisecond later', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      const atNow = await insertCard(t, base, { dueDate: NOW });
      await insertCard(t, base, { dueDate: NOW + 1 });

      expect(await fetchDue(t, base.deckId)).toEqual([atNow]);
      // The same card crosses the boundary as `now` advances.
      expect(await fetchDue(t, base.deckId, { now: NOW + 1 })).toHaveLength(2);
    });

    it('learn_new serves only ungraduated cards — review backlog is not new material', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      const graduatedBacklog = await insertCard(t, base, {
        dueDate: NOW - 5 * DAY,
        isGraduated: true,
      });
      const ungraduated = await insertCard(t, base, {
        dueDate: NOW - 1 * HOUR,
        isGraduated: false,
      });

      expect(await fetchDue(t, base.deckId, { mode: 'learn_new' })).toEqual([
        ungraduated,
      ]);
      // …while learnAndReview serves both, backlog first.
      expect(await fetchDue(t, base.deckId)).toEqual([
        graduatedBacklog,
        ungraduated,
      ]);
    });

    it('never serves hidden or mastered cards', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      await insertCard(t, base, { dueDate: NOW - DAY, isHidden: true });
      await insertCard(t, base, { dueDate: NOW - DAY, isMastered: true });
      const visible = await insertCard(t, base, { dueDate: NOW - DAY });

      expect(await fetchDue(t, base.deckId)).toEqual([visible]);
      expect(await fetchDue(t, base.deckId, { mode: 'learn_new' })).toEqual([
        visible,
      ]);
    });

    it('returns [] when nothing is due yet', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      await insertCard(t, base, { dueDate: NOW + 5 * HOUR });
      expect(await fetchDue(t, base.deckId)).toEqual([]);
    });
  });

  describe('content-source filter', () => {
    it("'course' serves only premade-origin cards", async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      const premade = await insertCard(t, base, {
        dueDate: NOW - 2 * HOUR,
        origin: 'premade',
      });
      await insertCard(t, base, { dueDate: NOW - 3 * HOUR, origin: 'custom' });
      await insertCard(t, base, { dueDate: NOW - 4 * HOUR, origin: 'chat' });

      expect(await fetchDue(t, base.deckId, { filter: 'course' })).toEqual([
        premade,
      ]);
    });

    it("'custom' merges custom and chat origins by due date and truncates safely", async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      // Interleave the two origins so a correct global order can only come
      // from the post-fan-out merge, not from either origin's own order.
      const chatOld = await insertCard(t, base, {
        dueDate: NOW - 3 * HOUR,
        origin: 'chat',
      });
      const customMid = await insertCard(t, base, {
        dueDate: NOW - 2 * HOUR,
        origin: 'custom',
      });
      const chatYoung = await insertCard(t, base, {
        dueDate: NOW - 1 * HOUR,
        origin: 'chat',
      });
      await insertCard(t, base, { dueDate: NOW - 4 * HOUR, origin: 'premade' });

      expect(await fetchDue(t, base.deckId, { filter: 'custom' })).toEqual([
        chatOld,
        customMid,
        chatYoung,
      ]);
      // Truncation across the fan-out: the global top-2 spans both origins.
      expect(
        await fetchDue(t, base.deckId, { filter: 'custom', take: 2 }),
      ).toEqual([chatOld, customMid]);
    });

    it('breaks due-date ties by creation time, matching the unfiltered index order', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      // Same due instant, different origins → only the explicit
      // `_creationTime` tiebreak in the merge decides the order.
      const first = await insertCard(t, base, {
        dueDate: NOW - HOUR,
        origin: 'chat',
      });
      const second = await insertCard(t, base, {
        dueDate: NOW - HOUR,
        origin: 'custom',
      });

      expect(await fetchDue(t, base.deckId, { filter: 'custom' })).toEqual([
        first,
        second,
      ]);
      // And the unfiltered path agrees.
      expect(await fetchDue(t, base.deckId, { filter: 'both' })).toEqual([
        first,
        second,
      ]);
    });

    it("cards without a collectionOrigin are served only by the unfiltered 'both' path", async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      const originless = await insertCard(t, base, { dueDate: NOW - HOUR });

      expect(await fetchDue(t, base.deckId, { filter: 'both' })).toEqual([
        originless,
      ]);
      expect(await fetchDue(t, base.deckId, { filter: 'course' })).toEqual([]);
      expect(await fetchDue(t, base.deckId, { filter: 'custom' })).toEqual([]);
    });

    it('filtered learn_new combines the origin fan-out with the graduation gate', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      await insertCard(t, base, {
        dueDate: NOW - 3 * HOUR,
        origin: 'chat',
        isGraduated: true, // review backlog — excluded from learn_new
      });
      const newCustom = await insertCard(t, base, {
        dueDate: NOW - 2 * HOUR,
        origin: 'custom',
        isGraduated: false,
      });
      await insertCard(t, base, {
        dueDate: NOW - 4 * HOUR,
        origin: 'premade',
        isGraduated: false, // wrong origin for the filter
      });

      expect(
        await fetchDue(t, base.deckId, { filter: 'custom', mode: 'learn_new' }),
      ).toEqual([newCustom]);
    });
  });

  describe('writing track', () => {
    it('orders by writingDueDate, ignoring the shared dueDate entirely', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      // Shared and writing schedules deliberately disagree.
      const writingFirst = await insertCard(t, base, {
        dueDate: NOW + 5 * DAY, // not due on the shared track for days
        writingDueDate: NOW - 2 * HOUR,
        writingIsGraduated: false,
      });
      const writingSecond = await insertCard(t, base, {
        dueDate: NOW - 5 * DAY, // deep shared-track backlog
        writingDueDate: NOW - 1 * HOUR,
        writingIsGraduated: false,
      });

      expect(await fetchDue(t, base.deckId, { track: 'writing' })).toEqual([
        writingFirst,
        writingSecond,
      ]);
      // The shared track sees the opposite picture.
      expect(await fetchDue(t, base.deckId, { track: 'shared' })).toEqual([
        writingSecond,
      ]);
    });

    it('never serves cards not yet seeded into the writing schedule as backlog', async () => {
      // A card with undefined writingDueDate is NEW to the writing track. In
      // the index undefined sorts BEFORE every number, so without the
      // `.gte('writingDueDate', 0)` lower bound it would surface as the
      // most-overdue card in the deck. It must not be served at all until
      // the enable-time seeding sweep stamps it.
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      await insertCard(t, base, {
        dueDate: NOW - 10 * DAY, // ancient shared due date, no writing seed
        isGraduated: true,
      });
      const seeded = await insertCard(t, base, {
        dueDate: NOW - 1 * HOUR,
        writingDueDate: NOW - 1 * HOUR,
        writingIsGraduated: false,
      });

      expect(await fetchDue(t, base.deckId, { track: 'writing' })).toEqual([
        seeded,
      ]);
      expect(
        await fetchDue(t, base.deckId, { track: 'writing', mode: 'learn_new' }),
      ).toEqual([seeded]);
    });

    it('applies the available-now boundary to writingDueDate', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      const atNow = await insertCard(t, base, {
        dueDate: NOW - DAY,
        writingDueDate: NOW,
        writingIsGraduated: false,
      });
      await insertCard(t, base, {
        dueDate: NOW - DAY,
        writingDueDate: NOW + 1, // later today on the writing track
        writingIsGraduated: false,
      });

      expect(await fetchDue(t, base.deckId, { track: 'writing' })).toEqual([
        atNow,
      ]);
    });

    it('learn_new on the writing track gates on writingIsGraduated, not isGraduated', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      // Graduated on the shared track but still new to writing: learn_new
      // writing must serve it.
      const newToWriting = await insertCard(t, base, {
        dueDate: NOW - HOUR,
        isGraduated: true,
        writingDueDate: NOW - HOUR,
        writingIsGraduated: false,
      });
      // Graduated on the writing track: excluded from learn_new there.
      await insertCard(t, base, {
        dueDate: NOW - 2 * HOUR,
        isGraduated: false,
        writingDueDate: NOW - 2 * HOUR,
        writingIsGraduated: true,
      });

      expect(
        await fetchDue(t, base.deckId, { track: 'writing', mode: 'learn_new' }),
      ).toEqual([newToWriting]);
    });

    it('merges origins by writingDueDate under the custom filter', async () => {
      const t = convexTest(schema, modules);
      const base = await seedDeck(t);
      const chatCard = await insertCard(t, base, {
        dueDate: NOW + DAY,
        origin: 'chat',
        writingDueDate: NOW - 2 * HOUR,
        writingIsGraduated: false,
      });
      const customCard = await insertCard(t, base, {
        dueDate: NOW - DAY,
        origin: 'custom',
        writingDueDate: NOW - 1 * HOUR,
        writingIsGraduated: false,
      });
      await insertCard(t, base, {
        dueDate: NOW - DAY,
        origin: 'custom',
        // Unseeded writing schedule: excluded even under the origin filter.
      });

      expect(
        await fetchDue(t, base.deckId, { track: 'writing', filter: 'custom' }),
      ).toEqual([chatCard, customCard]);
    });
  });
});
