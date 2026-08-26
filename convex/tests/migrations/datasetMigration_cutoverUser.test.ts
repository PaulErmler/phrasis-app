/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";

import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

const modules = import.meta.glob("/convex/**/*.ts");

type SeedOptions = {
  cardsAdded?: number;
  cardsLearned?: number;
  cardsMasteredOnProgress?: number | undefined;
  masteredCardCount?: number;
  unmasteredCardCount?: number;
};

async function seedCourseWithLegacyA1(
  t: TestConvex<typeof schema>,
  opts: SeedOptions = {},
) {
  const {
    cardsAdded = 5,
    cardsLearned = 0,
    cardsMasteredOnProgress,
    masteredCardCount = 0,
    unmasteredCardCount = 0,
  } = opts;

  return t.run(async (ctx) => {
    const legacyA1: Id<"collections"> = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 0,
    });
    const datasetId: Id<"datasets"> = await ctx.db.insert("datasets", {
      slug: "ogte-curated",
      version: "1.0.0",
      publishedAt: Date.now(),
      isActive: true,
    });
    const newL02: Id<"collections"> = await ctx.db.insert("collections", {
      name: "L02",
      textCount: 0,
      datasetId,
      code: "L02",
      cefrTier: "A1",
      order: 2,
      displayName: "A1.1",
    });
    const courseId: Id<"courses"> = await ctx.db.insert("courses", {
      userId: "user_A",
      baseLanguages: ["en"],
      targetLanguages: ["es"],
    });
    const deckId: Id<"decks"> = await ctx.db.insert("decks", {
      courseId,
      name: "d",
      cardCount: masteredCardCount + unmasteredCardCount,
    });
    // Seed cards in the legacy A1 collection.
    for (let i = 0; i < masteredCardCount; i++) {
      const textId = await ctx.db.insert("texts", {
        text: `t${i}`,
        language: "es",
        userCreated: true,
        userId: "user_A",
        collectionId: legacyA1,
        collectionRank: i + 1,
      });
      await ctx.db.insert("cards", {
        deckId,
        textId,
        collectionId: legacyA1,
        collectionOrigin: "premade",
        dueDate: Date.now(),
        isMastered: true,
        isHidden: false,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
    }
    for (let i = 0; i < unmasteredCardCount; i++) {
      const textId = await ctx.db.insert("texts", {
        text: `u${i}`,
        language: "es",
        userCreated: true,
        userId: "user_A",
        collectionId: legacyA1,
        collectionRank: 100 + i,
      });
      await ctx.db.insert("cards", {
        deckId,
        textId,
        collectionId: legacyA1,
        collectionOrigin: "premade",
        dueDate: Date.now(),
        isMastered: false,
        isHidden: false,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
    }
    const legacyProgressId = await ctx.db.insert("collectionProgress", {
      userId: "user_A",
      courseId,
      collectionId: legacyA1,
      cardsAdded,
      cardsLearned,
      ...(cardsMasteredOnProgress !== undefined
        ? { cardsMastered: cardsMasteredOnProgress }
        : {}),
    });
    return { courseId, deckId, legacyA1, newL02, datasetId, legacyProgressId };
  });
}

async function readDestProgress(
  t: TestConvex<typeof schema>,
  userId: string,
  courseId: Id<"courses">,
  collectionId: Id<"collections">,
) {
  return t.run((ctx) =>
    ctx.db
      .query("collectionProgress")
      .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
        q
          .eq("userId", userId)
          .eq("courseId", courseId)
          .eq("collectionId", collectionId),
      )
      .first(),
  );
}

describe("datasetMigration_cutoverUser", () => {
  it("rolls forward cardsMastered using a live count when the legacy row predates the backfill", async () => {
    // The P0 hazard: cardsMastered on the legacy row is still undefined
    // (backfill hasn't run). Naive `?? 0` would lose the credit forever.
    const t = convexTest(schema, modules);
    const { courseId, newL02, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 5,
      cardsMasteredOnProgress: undefined,
      masteredCardCount: 3,
      unmasteredCardCount: 2,
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    const dest = await readDestProgress(t, "user_A", courseId, newL02);
    expect(dest).not.toBeNull();
    expect(dest?.cardsMastered).toBe(3);
    expect(dest?.cardsAdded).toBe(5);
  });

  it("uses the backfilled cardsMastered value when present (does not double-count)", async () => {
    const t = convexTest(schema, modules);
    const { courseId, newL02, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 5,
      cardsMasteredOnProgress: 7,
      // Cards table only has 3 mastered cards. Proves we don't recompute.
      masteredCardCount: 3,
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    const dest = await readDestProgress(t, "user_A", courseId, newL02);
    expect(dest?.cardsMastered).toBe(7);
  });

  it("inserts a destination row when none exists yet", async () => {
    const t = convexTest(schema, modules);
    const { courseId, newL02, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 4,
      cardsMasteredOnProgress: undefined,
      masteredCardCount: 2,
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    const dest = await readDestProgress(t, "user_A", courseId, newL02);
    expect(dest).not.toBeNull();
    expect(dest?.cardsAdded).toBe(4);
    expect(dest?.cardsMastered).toBe(2);
  });

  it("is idempotent, second run is a no-op once reconciledDatasetId matches", async () => {
    const t = convexTest(schema, modules);
    const { courseId, newL02, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 5,
      cardsMasteredOnProgress: undefined,
      masteredCardCount: 3,
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );
    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    const dest = await readDestProgress(t, "user_A", courseId, newL02);
    expect(dest?.cardsMastered).toBe(3);
    expect(dest?.cardsAdded).toBe(5);
  });

  it("sets reconciledDatasetId on courseSettings (creating the row if needed)", async () => {
    const t = convexTest(schema, modules);
    const { courseId, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 1,
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    const settings = await t.run((ctx) =>
      ctx.db
        .query("courseSettings")
        .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
        .first(),
    );
    expect(settings?.reconciledDatasetId).toBe(datasetId);
  });

  it("rolls multiple legacy collections forward in one cutover", async () => {
    // A realistic cutover hits many legacy collections at once. Verifies the
    // LEGACY_TO_NEW_CODE map is honored across rows (Essential→L01, A1→L02,
    // B1→L08) and counters merge into the right destinations.
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const essential = await ctx.db.insert("collections", {
        name: "Essential",
        textCount: 0,
      });
      const a1 = await ctx.db.insert("collections", { name: "A1", textCount: 0 });
      const b1 = await ctx.db.insert("collections", { name: "B1", textCount: 0 });
      const datasetId = await ctx.db.insert("datasets", {
        slug: "ogte-curated",
        version: "1.0.0",
        publishedAt: Date.now(),
        isActive: true,
      });
      const newCollections: Record<string, Id<"collections">> = {};
      for (const [code, order] of [
        ["L01", 1],
        ["L02", 2],
        ["L08", 8],
      ] as const) {
        newCollections[code] = await ctx.db.insert("collections", {
          name: code,
          textCount: 0,
          datasetId,
          code,
          cefrTier: "X",
          order,
          displayName: code,
        });
      }
      const courseId = await ctx.db.insert("courses", {
        userId: "user_A",
        baseLanguages: ["en"],
        targetLanguages: ["es"],
      });
      await ctx.db.insert("decks", { courseId, name: "d", cardCount: 0 });
      await ctx.db.insert("collectionProgress", {
        userId: "user_A",
        courseId,
        collectionId: essential,
        cardsAdded: 10,
        cardsLearned: 0,
        cardsMastered: 0,
      });
      await ctx.db.insert("collectionProgress", {
        userId: "user_A",
        courseId,
        collectionId: a1,
        cardsAdded: 20,
        cardsLearned: 0,
        cardsMastered: 0,
      });
      await ctx.db.insert("collectionProgress", {
        userId: "user_A",
        courseId,
        collectionId: b1,
        cardsAdded: 30,
        cardsLearned: 0,
        cardsMastered: 0,
      });
      return { courseId, datasetId, newCollections };
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId: fixture.courseId, datasetId: fixture.datasetId },
    );

    const l01 = await readDestProgress(t, "user_A", fixture.courseId, fixture.newCollections.L01);
    const l02 = await readDestProgress(t, "user_A", fixture.courseId, fixture.newCollections.L02);
    const l08 = await readDestProgress(t, "user_A", fixture.courseId, fixture.newCollections.L08);
    expect(l01?.cardsAdded).toBe(10);
    expect(l02?.cardsAdded).toBe(20);
    expect(l08?.cardsAdded).toBe(30);
  });

  it("remaps activeCollectionId from a legacy collection to its new equivalent", async () => {
    const t = convexTest(schema, modules);
    const { courseId, datasetId, newL02 } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 1,
    });
    // Seed courseSettings with activeCollectionId pointing at the legacy A1.
    const legacyA1 = await t.run((ctx) =>
      ctx.db
        .query("collections")
        .withIndex("by_name", (q) => q.eq("name", "A1"))
        .first(),
    );
    const settingsId = await t.run((ctx) =>
      ctx.db.insert("courseSettings", {
        courseId,
        initialReviewCount: 0,
        activeCollectionId: legacyA1!._id,
      }),
    );

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    const settings = await t.run((ctx) => ctx.db.get(settingsId));
    expect(settings?.activeCollectionId).toBe(newL02);
  });

  it("short-circuits as 'already-reconciled' when reconciledDatasetId matches", async () => {
    const t = convexTest(schema, modules);
    const { courseId, newL02, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 5,
      cardsMasteredOnProgress: undefined,
      masteredCardCount: 3,
    });

    // First run reconciles the course.
    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    // Tamper with the destination row so we can detect any spurious second-run write.
    const dest = await readDestProgress(t, "user_A", courseId, newL02);
    await t.run((ctx) =>
      ctx.db.patch(dest!._id, { cardsMastered: 999 }),
    );

    const result = await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    expect(result).toEqual({ skipped: true, reason: "already-reconciled" });
    const destAfter = await readDestProgress(t, "user_A", courseId, newL02);
    // Untouched sentinel proves no write happened.
    expect(destAfter?.cardsMastered).toBe(999);
  });

  it("mirrors legacy cardsAdded into legacyCarryAdded so the home view can widen the denominator", async () => {
    // The destination row's `cardsAdded` numerator inflates by the rolled
    // amount; `legacyCarryAdded` lets the home view inflate the denominator
    // by the same amount so the displayed ratio doesn't appear collapsed.
    const t = convexTest(schema, modules);
    const { courseId, newL02, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 100,
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    const dest = await readDestProgress(t, "user_A", courseId, newL02);
    expect(dest?.cardsAdded).toBe(100);
    expect(dest?.legacyCarryAdded).toBe(100);
  });

  it("skips a legacy collection whose counters are all zero", async () => {
    const t = convexTest(schema, modules);
    const { courseId, newL02, datasetId } = await seedCourseWithLegacyA1(t, {
      cardsAdded: 0,
      cardsLearned: 0,
      cardsMasteredOnProgress: 0,
      masteredCardCount: 0,
    });

    await t.mutation(
      internal.migrations.datasetMigration_cutoverUser.cutoverUser,
      { userId: "user_A", courseId, datasetId },
    );

    // No destination row should have been created for L02.
    const dest = await readDestProgress(t, "user_A", courseId, newL02);
    expect(dest).toBeNull();
  });
});
