/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

vi.mock("@convex-dev/aggregate", () => {
  class TableAggregate {
    constructor(_component: unknown, _opts: unknown) {}
    async insertIfDoesNotExist(): Promise<void> {}
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async count(): Promise<number> {
      return 0;
    }
  }
  return { TableAggregate };
});

import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

const modules = import.meta.glob("/convex/**/*.ts");

type CardSeed = {
  collectionId: Id<"collections">;
  isMastered: boolean;
  isHidden?: boolean;
};

async function seedCourseDeck(
  t: ReturnType<typeof convexTest>,
  cards: CardSeed[],
) {
  return t.run(async (ctx) => {
    const courseId: Id<"courses"> = await ctx.db.insert("courses", {
      userId: "user_A",
      baseLanguages: ["en"],
      targetLanguages: ["es"],
    });
    const deckId: Id<"decks"> = await ctx.db.insert("decks", {
      courseId,
      name: "d",
      cardCount: cards.length,
    });
    for (const c of cards) {
      const textId = await ctx.db.insert("texts", {
        text: "t",
        language: "es",
        userCreated: true,
        userId: "user_A",
        collectionId: c.collectionId,
        collectionRank: 1,
      });
      await ctx.db.insert("cards", {
        deckId,
        textId,
        collectionId: c.collectionId,
        dueDate: Date.now(),
        isMastered: c.isMastered,
        isHidden: c.isHidden ?? false,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
    }
    return { courseId, deckId };
  });
}

async function seedCollection(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<"collections">> {
  return t.run((ctx) =>
    ctx.db.insert("collections", { name, textCount: 0 }),
  );
}

async function seedProgress(
  t: ReturnType<typeof convexTest>,
  args: {
    courseId: Id<"courses">;
    collectionId: Id<"collections">;
    cardsAdded: number;
    cardsMastered?: number;
  },
): Promise<Id<"collectionProgress">> {
  return t.run((ctx) =>
    ctx.db.insert("collectionProgress", {
      userId: "user_A",
      courseId: args.courseId,
      collectionId: args.collectionId,
      cardsAdded: args.cardsAdded,
      cardsLearned: 0,
      ...(args.cardsMastered !== undefined
        ? { cardsMastered: args.cardsMastered }
        : {}),
    }),
  );
}

describe("datasetMigration_backfillCardsMastered.processBatch", () => {
  it("writes the live mastered count for a progress row that predates the backfill", async () => {
    const t = convexTest(schema, modules);
    const a1 = await seedCollection(t, "A1");
    const { courseId } = await seedCourseDeck(t, [
      { collectionId: a1, isMastered: true },
      { collectionId: a1, isMastered: true },
      { collectionId: a1, isMastered: true },
      { collectionId: a1, isMastered: false },
    ]);
    const progressId = await seedProgress(t, {
      courseId,
      collectionId: a1,
      cardsAdded: 4,
      // cardsMastered intentionally omitted (undefined → backfill candidate)
    });

    await t.mutation(
      internal.migrations.datasetMigration_backfillCardsMastered.processBatch,
      {},
    );

    const progress = await t.run((ctx) => ctx.db.get(progressId));
    expect(progress?.cardsMastered).toBe(3);
  });

  it("skips rows where cardsMastered is already defined (idempotency)", async () => {
    const t = convexTest(schema, modules);
    const a1 = await seedCollection(t, "A1");
    const { courseId } = await seedCourseDeck(t, [
      { collectionId: a1, isMastered: true },
      { collectionId: a1, isMastered: true },
    ]);
    const progressId = await seedProgress(t, {
      courseId,
      collectionId: a1,
      cardsAdded: 2,
      cardsMastered: 99, // intentionally wrong — proves we don't recompute
    });

    await t.mutation(
      internal.migrations.datasetMigration_backfillCardsMastered.processBatch,
      {},
    );

    const progress = await t.run((ctx) => ctx.db.get(progressId));
    expect(progress?.cardsMastered).toBe(99);
  });

  it("groups counts per collection when one deck has cards across multiple legacy collections", async () => {
    const t = convexTest(schema, modules);
    const a1 = await seedCollection(t, "A1");
    const a2 = await seedCollection(t, "A2");
    const { courseId } = await seedCourseDeck(t, [
      { collectionId: a1, isMastered: true },
      { collectionId: a1, isMastered: true },
      { collectionId: a2, isMastered: true },
      { collectionId: a2, isMastered: false },
    ]);
    const a1Progress = await seedProgress(t, {
      courseId,
      collectionId: a1,
      cardsAdded: 2,
    });
    const a2Progress = await seedProgress(t, {
      courseId,
      collectionId: a2,
      cardsAdded: 2,
    });

    await t.mutation(
      internal.migrations.datasetMigration_backfillCardsMastered.processBatch,
      {},
    );

    const a1Row = await t.run((ctx) => ctx.db.get(a1Progress));
    const a2Row = await t.run((ctx) => ctx.db.get(a2Progress));
    expect(a1Row?.cardsMastered).toBe(2);
    expect(a2Row?.cardsMastered).toBe(1);
  });

  it("excludes hidden cards from the count", async () => {
    const t = convexTest(schema, modules);
    const a1 = await seedCollection(t, "A1");
    const { courseId } = await seedCourseDeck(t, [
      { collectionId: a1, isMastered: true },
      { collectionId: a1, isMastered: true, isHidden: true }, // hidden — excluded
    ]);
    const progressId = await seedProgress(t, {
      courseId,
      collectionId: a1,
      cardsAdded: 2,
    });

    await t.mutation(
      internal.migrations.datasetMigration_backfillCardsMastered.processBatch,
      {},
    );

    const progress = await t.run((ctx) => ctx.db.get(progressId));
    expect(progress?.cardsMastered).toBe(1);
  });

  it("writes 0 when no cards in the collection are mastered", async () => {
    const t = convexTest(schema, modules);
    const a1 = await seedCollection(t, "A1");
    const { courseId } = await seedCourseDeck(t, [
      { collectionId: a1, isMastered: false },
      { collectionId: a1, isMastered: false },
    ]);
    const progressId = await seedProgress(t, {
      courseId,
      collectionId: a1,
      cardsAdded: 2,
    });

    await t.mutation(
      internal.migrations.datasetMigration_backfillCardsMastered.processBatch,
      {},
    );

    const progress = await t.run((ctx) => ctx.db.get(progressId));
    // Defined (no longer undefined), and equal to the live count of 0.
    expect(progress?.cardsMastered).toBe(0);
  });
});
