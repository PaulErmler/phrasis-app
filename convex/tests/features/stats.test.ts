/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";

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

  describe("getNewWordsForCelebration", () => {
    it("buckets rows by sessionId match: matching → session, different or missing → today", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await t.run(async (ctx) => {
        // Matching sessionId → session bucket
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "hola",
          sessionId: "session-current",
        });
        // Different sessionId → today bucket (earlier session today)
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "adios",
          displayWord: "adios",
          sessionId: "session-earlier",
        });
        // No sessionId field → today bucket. Strict semantics: an orphaned
        // row stays orphaned so a regression that re-introduces missing
        // sessionIds is visible on the celebration screen, not masked.
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "gracias",
          displayWord: "gracias",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.stats.getNewWordsForCelebration,
        { sessionId: "session-current", timezone: "UTC" },
      );

      expect(res.session.map((w) => w.display)).toEqual(["hola"]);
      expect(res.today.map((w) => w.display).sort()).toEqual([
        "adios",
        "gracias",
      ]);
    });

    it("dedupes by (language, word) and promotes today → session when a session row exists for the same word", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await t.run(async (ctx) => {
        // Two rows for the same (language, word) — different sessionIds.
        // The session row must win regardless of insertion order.
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "hola",
          sessionId: "session-earlier",
        });
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "hola",
          sessionId: "session-current",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.stats.getNewWordsForCelebration,
        { sessionId: "session-current", timezone: "UTC" },
      );

      expect(res.session.map((w) => w.display)).toEqual(["hola"]);
      expect(res.today).toEqual([]);
    });
  });
});
