/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// File-level aggregate mock (same precedent as features/stats.test.ts and
// migrations/recalcUserCardAggregates.test.ts). We only care about the
// namespace-affecting calls, so `replaceOrInsert` records the origin it moved
// the entry FROM and TO.
const replaceCalls: Array<{ from?: string; to?: string }> = [];
const insertCalls: Array<{ origin?: string }> = [];

vi.mock('@convex-dev/aggregate', () => {
  class TableAggregate {
    constructor(
      _component: unknown,
      private opts: { namespace: (doc: unknown) => string },
    ) {}
    async insertIfDoesNotExist(_ctx: unknown, doc: unknown): Promise<void> {
      insertCalls.push({ origin: this.opts.namespace(doc) });
    }
    async replaceOrInsert(
      _ctx: unknown,
      oldDoc: unknown,
      newDoc: unknown,
    ): Promise<void> {
      replaceCalls.push({
        from: this.opts.namespace(oldDoc),
        to: this.opts.namespace(newDoc),
      });
    }
    async deleteIfExists(): Promise<void> {}
    async count(): Promise<number> {
      return 0;
    }
    async clear(): Promise<void> {}
  }
  return { TableAggregate };
});

import schema from '../../schema';
import { cardCollectionBackfillOne } from '../../migrations';
import type { Doc, Id } from '../../_generated/dataModel';

const modules = import.meta.glob('/convex/**/*.ts');

beforeEach(() => {
  replaceCalls.length = 0;
  insertCalls.length = 0;
});

type SeedOpts = {
  collectionName?: string;
  collectionOriginField?: Doc<'collections'>['origin'];
  withWritingTrack?: boolean;
};

/** The pre-backfill doc value `runOne` reconstructs for the migration. */
type LegacyView = {
  /** collectionOrigin the migration sees. Default: stripped (undefined). */
  collectionOrigin?: Doc<'cards'>['collectionOrigin'];
  /** false = strip collectionId off the doc value too. */
  withCollectionId?: boolean;
  /** Pass the stored doc through unchanged (post-backfill re-run). */
  asStored?: boolean;
};

async function seedCard(t: TestConvex<typeof schema>, opts: SeedOpts = {}) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: opts.collectionName ?? 'A1',
      textCount: 1,
      ...(opts.collectionOriginField
        ? { origin: opts.collectionOriginField }
        : {}),
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'deck',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hello.',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    // The narrowed schema can no longer PERSIST a pre-backfill card, so the
    // stored row is fully valid; `runOne` strips the fields back off the doc
    // in memory (per SeedOpts) before handing it to the migration, exactly
    // the value shape a prod row written before the backfill presents.
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate: 0,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
      // Seeded writing track (separateModeTracking), membership marker for
      // the writing origin aggregate is `writingDueDate !== undefined`.
      ...(opts.withWritingTrack
        ? { writingDueDate: 0, writingIsGraduated: false }
        : {}),
    });
    return { cardId, deckId, collectionId };
  });
}

async function runOne(
  t: TestConvex<typeof schema>,
  cardId: Id<'cards'>,
  view: LegacyView = {},
) {
  return t.run(async (ctx) => {
    const doc = (await ctx.db.get(cardId))!;
    // Reconstruct the legacy (pre-backfill) doc value the migration sees.
    const legacyDoc = view.asStored
      ? doc
      : ({
          ...doc,
          collectionId:
            view.withCollectionId === false ? undefined : doc.collectionId,
          collectionOrigin: view.collectionOrigin,
        } as unknown as Doc<'cards'>);
    const patch = await cardCollectionBackfillOne(ctx, legacyDoc);
    if (patch) await ctx.db.patch(cardId, patch);
    // `t.run` serializes the result, turning `undefined` into `null`.
    return patch ?? null;
  });
}

describe('cardCollectionBackfill: origin-aggregate consistency', () => {
  it('moves the origin-aggregate entry when it stamps collectionOrigin', async () => {
    const t = convexTest(schema, modules);
    // A legacy CEFR collection with no `origin` field. Resolves to 'premade'.
    const { cardId, deckId } = await seedCard(t);

    const patch = await runOne(t, cardId);

    expect(patch).toEqual({ collectionOrigin: 'premade' });
    // The entry must move OUT of the 'none' namespace it would have been
    // aggregated under during the deploy window, and INTO the final origin.
    // Without this the old entry is orphaned forever: `deleteCard` looks it up
    // under the new origin and never finds it.
    expect(replaceCalls).toEqual([
      {
        from: `${deckId}:none:new`,
        to: `${deckId}:premade:new`,
      },
    ]);
  });

  it('moves the WRITING origin-aggregate entry too when the card has a writing track', async () => {
    const t = convexTest(schema, modules);
    const { cardId, deckId } = await seedCard(t, { withWritingTrack: true });

    await runOne(t, cardId);

    // Both origin-keyed aggregates namespace on collectionOrigin, so both
    // entries must move. Without the second move the writing entry is
    // stranded under ':none:' forever (patchCard/deleteCard address the new
    // origin from then on) and filtered Writing due counts stay wrong.
    expect(replaceCalls).toEqual([
      { from: `${deckId}:none:new`, to: `${deckId}:premade:new` },
      { from: `${deckId}:none:new`, to: `${deckId}:premade:new` },
    ]);
  });

  it('does not touch the writing aggregate for cards without a writing track', async () => {
    const t = convexTest(schema, modules);
    const { cardId, deckId } = await seedCard(t);

    await runOne(t, cardId);

    // Exactly one move. The shared origin aggregate. A second call would
    // insert a phantom entry into the writing aggregate for a card that is
    // not a member of it.
    expect(replaceCalls).toEqual([
      { from: `${deckId}:none:new`, to: `${deckId}:premade:new` },
    ]);
  });

  it('moves the entry for a custom collection too', async () => {
    const t = convexTest(schema, modules);
    const { cardId, deckId } = await seedCard(t, {
      collectionName: 'My cards',
      collectionOriginField: 'custom',
    });

    await runOne(t, cardId);

    expect(replaceCalls).toEqual([
      { from: `${deckId}:none:new`, to: `${deckId}:custom:new` },
    ]);
  });

  it('touches no aggregate when the card already has both fields', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedCard(t);

    const patch = await runOne(t, cardId, { collectionOrigin: 'premade' });

    expect(patch).toBeNull();
    expect(replaceCalls).toEqual([]);
  });

  it('touches no aggregate when only collectionId is backfilled', async () => {
    const t = convexTest(schema, modules);
    // Origin already set, id missing. The patch must not carry an origin, so
    // the aggregate namespace is unchanged and nothing needs moving.
    const { cardId, collectionId } = await seedCard(t);

    const patch = await runOne(t, cardId, {
      withCollectionId: false,
      collectionOrigin: 'chat',
    });

    expect(patch).toEqual({ collectionId });
    expect(replaceCalls).toEqual([]);
  });

  it('is idempotent, a second pass over the patched row is a no-op', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedCard(t);

    await runOne(t, cardId);
    replaceCalls.length = 0;
    // The first pass patched the row, so a re-run sees the stored doc with
    // both fields present and must do nothing.
    const second = await runOne(t, cardId, { asStored: true });

    expect(second).toBeNull();
    expect(replaceCalls).toEqual([]);
  });

  it('patches zero docs on a dataset written under the narrowed schema', async () => {
    // Deploy-safety pin for the `v.optional()` removal on cards.collectionId /
    // cards.collectionOrigin: every row the current schema can persist already
    // carries both fields, so the runAll-chained safety net must be a pure
    // no-op over all of them (and the narrowing deploy itself only validates).
    const t = convexTest(schema, modules);
    await seedCard(t);
    await seedCard(t, {
      collectionName: 'My cards',
      collectionOriginField: 'custom',
    });
    await seedCard(t, { withWritingTrack: true });

    const patches = await t.run(async (ctx) => {
      const all = await ctx.db.query('cards').collect();
      const results = [];
      for (const doc of all) {
        // `t.run` serializes the return value; map `undefined` to `null`.
        results.push((await cardCollectionBackfillOne(ctx, doc)) ?? null);
      }
      return results;
    });

    expect(patches).toHaveLength(3);
    expect(patches.every((p) => p === null)).toBe(true);
    expect(replaceCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });
});

describe('runAll deploy chain', () => {
  it('no longer schedules a blanket per-deck aggregate rebuild', async () => {
    const mod = await import('../../migrations');
    // `recalcCardAggregatesAfterBackfills` cleared cardsByStateAndDueDate,
    // already correct, for EVERY deck, so users mid-session saw zeroed due
    // counts while their deck rebuilt. It is unnecessary now that cardCollectionBackfill moves the one
    // namespaced entry itself. `migrations/recalcUserCardAggregates.ts` stays
    // as the per-user repair tool.
    expect('recalcCardAggregatesAfterBackfills' in mod).toBe(false);
  });

  it('backfills the origin aggregate before the full-table searchable rebuild', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../migrations.ts', import.meta.url), 'utf8'),
    );
    const chain = src.slice(src.indexOf('export const runAll'));
    const originAt = chain.indexOf('cardOriginAggregateBackfill');
    const collectionAt = chain.indexOf('cardCollectionBackfill');
    const rebuildAt = chain.indexOf('rebuildCardSearchableText');
    // Origins must be final before they are aggregated...
    expect(collectionAt).toBeLessThan(originAt);
    // ...and the aggregate, which is what un-zeroes getFilteredCardCounts.
    // Must not sit behind the most expensive step in the chain.
    expect(originAt).toBeLessThan(rebuildAt);
  });
});
