/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";

import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedCourse(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const courseId = await ctx.db.insert("courses", {
      userId: "user_A",
      baseLanguages: ["en"],
      targetLanguages: ["es"],
    });
    await ctx.db.insert("userSettings", {
      userId: "user_A",
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    return { courseId };
  });
}

describe("features/home", () => {
  describe("getHomeSummary", () => {
    it("returns null for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.home.getHomeSummary, {});
      expect(res).toBeNull();
    });

    it("returns null when the user has no active course", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.home.getHomeSummary, {});
      expect(res).toBeNull();
    });

    it("with an active dataset returns its levels in index order plus custom collections, by value", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      const ids = await t.run(async (ctx) => {
        const datasetId = await ctx.db.insert("datasets", {
          slug: "ogte-curated",
          version: "1.0.0",
          publishedAt: 1,
          isActive: true,
        });
        // L02 inserted BEFORE L01. Output order must come from the
        // by_datasetId_and_order index, not insertion order. L02 has no
        // displayName so the `displayName ?? name` fallback is pinned on the
        // dataset branch too.
        const l02 = await ctx.db.insert("collections", {
          name: "L02",
          textCount: 40,
          datasetId,
          code: "L02",
          cefrTier: "A1",
          order: 2,
          origin: "premade",
        });
        const l01 = await ctx.db.insert("collections", {
          name: "L01",
          textCount: 30,
          datasetId,
          code: "L01",
          cefrTier: "Pre-A1",
          order: 1,
          displayName: "Level 1",
          origin: "premade",
        });
        // Legacy row without datasetId. Must not leak into the dataset branch.
        await ctx.db.insert("collections", { name: "A1", textCount: 99 });
        const chat = await ctx.db.insert("collections", {
          name: "Chat",
          textCount: 5,
          origin: "chat",
        });
        const custom = await ctx.db.insert("collections", {
          name: "Custom",
          textCount: 7,
          origin: "custom",
        });
        const extra = await ctx.db.insert("collections", {
          name: "Imported",
          textCount: 2,
          origin: "custom",
        });
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 2,
          activeCollectionId: l01,
          chatCollectionId: chat,
          customCollectionId: custom,
          // `custom` repeated here on purpose. The Set in the handler must
          // dedupe it so the collection appears once.
          activeCustomCollectionIds: [custom, extra],
        });
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: l01,
          cardsAdded: 12,
          cardsLearned: 8,
          cardsMastered: 3,
          legacyCarryAdded: 100,
          lastRankProcessed: 12,
          prioritizedCount: 2,
          ignoredCount: 1,
        });
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: extra,
          cardsAdded: 2,
          cardsMastered: 1,
          lastRankProcessed: 2,
        });
        return { datasetId, l01, l02, chat, custom, extra };
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.home.getHomeSummary, {});
      expect(res).toEqual({
        datasetId: ids.datasetId,
        activeCollectionId: ids.l01,
        levels: [
          {
            collectionId: ids.l01,
            code: "L01",
            cefrTier: "Pre-A1",
            order: 1,
            displayName: "Level 1",
            // legacyCarryAdded widens the denominator: 30 + 100.
            totalTexts: 130,
            cardsAdded: 12,
            ignoredCount: 1,
            prioritizedCount: 2,
            browseAnchor: 12,
            cardsLearned: 8,
            cardsMastered: 3,
          },
          {
            collectionId: ids.l02,
            code: "L02",
            cefrTier: "A1",
            order: 2,
            displayName: "L02",
            totalTexts: 40,
            cardsAdded: 0,
            ignoredCount: 0,
            prioritizedCount: 0,
            browseAnchor: 0,
            cardsLearned: 0,
            cardsMastered: 0,
          },
        ],
        // Set insertion order: chat, custom, then activeCustomCollectionIds.
        customCollections: [
          {
            collectionId: ids.chat,
            name: "Chat",
            totalTexts: 5,
            cardsAdded: 0,
            ignoredCount: 0,
            prioritizedCount: 0,
            browseAnchor: 0,
            cardsMastered: 0,
            isChat: true,
            isCustom: false,
          },
          {
            collectionId: ids.custom,
            name: "Custom",
            totalTexts: 7,
            cardsAdded: 0,
            ignoredCount: 0,
            prioritizedCount: 0,
            browseAnchor: 0,
            cardsMastered: 0,
            isChat: false,
            isCustom: true,
          },
          {
            collectionId: ids.extra,
            name: "Imported",
            totalTexts: 2,
            cardsAdded: 2,
            ignoredCount: 0,
            prioritizedCount: 0,
            browseAnchor: 2,
            cardsMastered: 1,
            isChat: false,
            isCustom: false,
          },
        ],
      });
    });

    it("without an active dataset falls back to legacy CEFR collections in LEGACY_LEVEL_ORDER", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      const ids = await t.run(async (ctx) => {
        // An INACTIVE dataset must not switch branches. getActiveDataset
        // filters on isActive, so the legacy by_name fallback still runs.
        await ctx.db.insert("datasets", {
          slug: "ogte-curated",
          version: "0.9.0",
          publishedAt: 1,
          isActive: false,
        });
        // Shuffled insertion order + only a subset of LEGACY_LEVEL_ORDER:
        // output must be Essential, A1, B2 with the missing names dropped.
        const b2 = await ctx.db.insert("collections", {
          name: "B2",
          textCount: 20,
        });
        const essential = await ctx.db.insert("collections", {
          name: "Essential",
          textCount: 10,
        });
        const a1 = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 15,
        });
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 2,
        });
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: essential,
          cardsAdded: 4,
          lastRankProcessed: 4,
        });
        return { b2, essential, a1 };
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.home.getHomeSummary, {});
      expect(res).toEqual({
        datasetId: null,
        activeCollectionId: null,
        levels: [
          {
            collectionId: ids.essential,
            code: "Essential",
            // deriveLegacyCefrTier: "Essential" maps to Pre-A1.
            cefrTier: "Pre-A1",
            order: 0,
            displayName: "Essential",
            totalTexts: 10,
            cardsAdded: 4,
            ignoredCount: 0,
            prioritizedCount: 0,
            browseAnchor: 4,
            cardsLearned: 0,
            cardsMastered: 0,
          },
          {
            collectionId: ids.a1,
            code: "A1",
            // deriveLegacyCefrTier: other legacy names ARE the tier.
            cefrTier: "A1",
            order: 0,
            displayName: "A1",
            totalTexts: 15,
            cardsAdded: 0,
            ignoredCount: 0,
            prioritizedCount: 0,
            browseAnchor: 0,
            cardsLearned: 0,
            cardsMastered: 0,
          },
          {
            collectionId: ids.b2,
            code: "B2",
            cefrTier: "B2",
            order: 0,
            displayName: "B2",
            totalTexts: 20,
            cardsAdded: 0,
            ignoredCount: 0,
            prioritizedCount: 0,
            browseAnchor: 0,
            cardsLearned: 0,
            cardsMastered: 0,
          },
        ],
        customCollections: [],
      });
    });

    it("drops dangling activeCustomCollectionIds pointing at deleted collections", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      const ids = await t.run(async (ctx) => {
        await ctx.db.insert("collections", {
          name: "Essential",
          textCount: 10,
        });
        const kept = await ctx.db.insert("collections", {
          name: "Kept",
          textCount: 1,
          origin: "custom",
        });
        const deleted = await ctx.db.insert("collections", {
          name: "Gone",
          textCount: 1,
          origin: "custom",
        });
        await ctx.db.delete(deleted);
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 2,
          activeCustomCollectionIds: [deleted, kept],
        });
        return { kept };
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.home.getHomeSummary, {});
      expect(res?.customCollections).toEqual([
        {
          collectionId: ids.kept,
          name: "Kept",
          totalTexts: 1,
          cardsAdded: 0,
          ignoredCount: 0,
          prioritizedCount: 0,
          browseAnchor: 0,
          cardsMastered: 0,
          isChat: false,
          isCustom: false,
        },
      ]);
    });
  });
});
