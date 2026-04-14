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
  });
});
