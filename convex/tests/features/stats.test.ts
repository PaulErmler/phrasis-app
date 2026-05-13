/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

// Stub the aggregate component — production code instantiates `TableAggregate`
// at module load. Without this, `cardsByState.count(...)` would throw.
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
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedActiveCourse(t: ReturnType<typeof convexTest>) {
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
    const deckId = await ctx.db.insert("decks", {
      courseId,
      name: "d",
      cardCount: 0,
    });
    return { courseId, deckId };
  });
}

describe("features/stats", () => {
  describe("getRecentWords", () => {
    it("returns [] unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getRecentWords, {});
      expect(res).toEqual([]);
    });

    it("returns recent words for target language", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "Hola",
        });
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "mundo",
          displayWord: "mundo",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getRecentWords, {});
      expect(res).toHaveLength(1);
      expect(res[0].language).toBe("es");
      expect(res[0].words.sort()).toEqual(["Hola", "mundo"]);
    });
  });

  describe("getRecentWordsForLanguage", () => {
    it("rejects a non-target language", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.stats.getRecentWordsForLanguage,
        { language: "fr" },
      );
      expect(res).toEqual([]);
    });
  });

  describe("searchWords", () => {
    it("returns [] on empty query", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.searchWords, {
        searchQuery: "   ",
      });
      expect(res).toEqual([]);
    });
  });

  describe("getSentencesForWord", () => {
    it("returns empty page for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getSentencesForWord, {
        word: "hola",
        language: "es",
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(res.page).toEqual([]);
      expect(res.isDone).toBe(true);
    });
  });

  describe("getCardCounts", () => {
    it("returns null when unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getCardCounts, {});
      expect(res).toBeNull();
    });

    it("returns null when there is no active course", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getCardCounts, {});
      expect(res).toBeNull();
    });

    it("returns the four-state shape (new, learning, relearning, review)", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getCardCounts, {});
      // Aggregate is mocked → all zero, but the shape must include relearning
      // separately so the progress display can color it independently.
      expect(res).toEqual({ new: 0, learning: 0, relearning: 0, review: 0 });
    });
  });

  describe("getTodayReviewCount", () => {
    it("returns 0 when unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getTodayReviewCount, {
        timezone: "UTC",
      });
      expect(res).toBe(0);
    });

    it("returns 0 when there is no active course", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getTodayReviewCount, {
        timezone: "UTC",
      });
      expect(res).toBe(0);
    });

    it("returns 0 when no dailyStats row exists for today", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getTodayReviewCount, {
        timezone: "UTC",
      });
      expect(res).toBe(0);
    });

    it("returns the reps from today's dailyStats row", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      // Compute today the same way the query does (UTC).
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: today,
          reps: 7,
          newCards: 3,
          timeMs: 60_000,
          cardsReviewed: 7,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getTodayReviewCount, {
        timezone: "UTC",
      });
      expect(res).toBe(7);
    });

    it("ignores other dates and other users' dailyStats", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        // Yesterday — must be ignored.
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: "2000-01-01",
          reps: 999,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 999,
        });
        // Different user, today — must be ignored.
        await ctx.db.insert("dailyStats", {
          userId: "user_B",
          courseId,
          date: today,
          reps: 999,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 999,
        });
        // Today, this user — should be returned.
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: today,
          reps: 4,
          newCards: 1,
          timeMs: 30_000,
          cardsReviewed: 4,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getTodayReviewCount, {
        timezone: "UTC",
      });
      expect(res).toBe(4);
    });
  });
});
