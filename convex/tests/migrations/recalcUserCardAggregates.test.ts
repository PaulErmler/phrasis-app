/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Track calls to the aggregate component across all instances so we can
// assert the migration touched every card for every aggregate, without
// pulling in the real component (which would need its own configuration).
const calls = {
  insert: [] as Array<{ docId: string }>,
  clear: [] as Array<{ namespace: string }>,
};

vi.mock("@convex-dev/aggregate", () => {
  class TableAggregate {
    constructor(_component: unknown, _opts: unknown) {}
    async insertIfDoesNotExist(_ctx: unknown, doc: { _id: string }): Promise<void> {
      calls.insert.push({ docId: doc._id });
    }
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async clear(_ctx: unknown, opts: { namespace: string }): Promise<void> {
      calls.clear.push({ namespace: opts.namespace });
    }
    async count(): Promise<number> {
      return 0;
    }
  }
  return { TableAggregate };
});

import schema from "../../schema";
import { internal } from "../../_generated/api";
import { EXTENDED_STATE_LABELS } from "../../lib/fsrsStates";
import { ORIGIN_BUCKETS } from "../../db/stats/cardAggregates";
import type { Id } from "../../_generated/dataModel";

const modules = import.meta.glob("/convex/**/*.ts");

beforeEach(() => {
  calls.insert = [];
  calls.clear = [];
});

async function seedUserWithDecksAndCards(
  t: TestConvex<typeof schema>,
  userId: string,
  decks: { cards: number }[],
): Promise<{ deckIds: Id<"decks">[]; cardIds: Id<"cards">[] }> {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "c",
      textCount: 0,
    });
    const courseId = await ctx.db.insert("courses", {
      userId,
      baseLanguages: ["en"],
      targetLanguages: ["es"],
    });
    const deckIds: Id<"decks">[] = [];
    const cardIds: Id<"cards">[] = [];
    for (const d of decks) {
      const deckId = await ctx.db.insert("decks", {
        courseId,
        name: "d",
        cardCount: d.cards,
      });
      deckIds.push(deckId);
      for (let i = 0; i < d.cards; i++) {
        const textId = await ctx.db.insert("texts", {
          text: "t",
          language: "es",
          userCreated: true,
          userId,
          collectionId,
          collectionRank: 1,
        });
        const cardId = await ctx.db.insert("cards", {
          deckId,
          textId,
          collectionId,
          dueDate: Date.now(),
          isMastered: false,
          isHidden: false,
          schedulingPhase: "preReview",
          preReviewCount: 0,
        });
        cardIds.push(cardId);
      }
    }
    return { deckIds, cardIds };
  });
}

describe("migrations/recalcUserCardAggregates", () => {
  it("clears all aggregate namespaces for every deck, one deck per scheduled mutation", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { deckIds } = await seedUserWithDecksAndCards(t, "user_A", [
        { cards: 1 },
        { cards: 1 },
      ]);

      await t.mutation(internal.migrations.recalcUserCardAggregates.run, {
        userId: "user_A",
      });

      // `run` only enumerates decks — a single deck's clear is 32 aggregate
      // calls (states × origin buckets), so clearing every deck in the entry
      // mutation could blow the mutation limits and fail half-cleared. The
      // clears happen one deck per scheduled continuation instead.
      expect(calls.clear).toHaveLength(0);

      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Each deck triggers: 1 cardsByState.clear + 1 cardsByDueDate.clear +
      // per state label: 1 cardsByStateAndDueDate.clear + one
      // cardsByOriginStateAndDueDate.clear per origin bucket.
      const perDeck =
        2 + EXTENDED_STATE_LABELS.length * (1 + ORIGIN_BUCKETS.length);
      expect(calls.clear).toHaveLength(deckIds.length * perDeck);

      // The two deckId-only namespaces show up once per deck.
      for (const deckId of deckIds) {
        const hits = calls.clear.filter((c) => c.namespace === deckId);
        expect(hits).toHaveLength(2);
      }

      // Each `${deckId}:${state}` namespace is cleared once, and each
      // `${deckId}:${origin}:${state}` namespace once.
      for (const deckId of deckIds) {
        for (const state of EXTENDED_STATE_LABELS) {
          const ns = `${deckId}:${state}`;
          const hits = calls.clear.filter((c) => c.namespace === ns);
          expect(hits).toHaveLength(1);
          for (const origin of ORIGIN_BUCKETS) {
            const originNs = `${deckId}:${origin}:${state}`;
            const originHits = calls.clear.filter(
              (c) => c.namespace === originNs,
            );
            expect(originHits).toHaveLength(1);
          }
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-inserts every card on all four aggregates after draining the scheduler", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { cardIds } = await seedUserWithDecksAndCards(t, "user_A", [
        { cards: 3 },
        { cards: 2 },
      ]);

      await t.mutation(internal.migrations.recalcUserCardAggregates.run, {
        userId: "user_A",
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Each card should be inserted into all 4 aggregates exactly once.
      expect(calls.insert).toHaveLength(cardIds.length * 4);
      for (const cardId of cardIds) {
        const hits = calls.insert.filter((c) => c.docId === cardId);
        expect(hits).toHaveLength(4);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not touch cards owned by other users", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { cardIds: aCards } = await seedUserWithDecksAndCards(t, "user_A", [
        { cards: 2 },
      ]);
      const { cardIds: bCards } = await seedUserWithDecksAndCards(t, "user_B", [
        { cards: 4 },
      ]);

      await t.mutation(internal.migrations.recalcUserCardAggregates.run, {
        userId: "user_A",
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Only user_A's cards should appear in insert calls.
      const touchedIds = new Set(calls.insert.map((c) => c.docId));
      for (const id of aCards) expect(touchedIds.has(id)).toBe(true);
      for (const id of bCards) expect(touchedIds.has(id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no-ops cleanly for a user with no courses", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(
      internal.migrations.recalcUserCardAggregates.run,
      { userId: "user_with_nothing" },
    );
    expect(res).toEqual({ status: "started", deckCount: 0 });
    expect(calls.clear).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });
});
