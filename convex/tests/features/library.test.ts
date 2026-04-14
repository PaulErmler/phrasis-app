/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

describe("features/library", () => {
  it("returns empty for unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const res = await t.query(api.features.library.getLibraryCards, {});
    expect(res).toEqual([]);
  });

  it("returns empty when user has no active course", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.query(api.features.library.getLibraryCards, {});
    expect(res).toEqual([]);
  });

  it("returns non-hidden cards for the active deck", async () => {
    const t = convexTest(schema, modules);
    const { textId, deckId } = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "A1",
        textCount: 0,
      });
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
        name: "deck",
        cardCount: 0,
      });
      const textId = await ctx.db.insert("texts", {
        text: "Hola",
        language: "es",
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      await ctx.db.insert("cards", {
        deckId,
        textId,
        collectionId,
        dueDate: Date.now(),
        isMastered: false,
        isHidden: false,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
      return { textId, deckId };
    });

    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.query(api.features.library.getLibraryCards, {});
    expect(res).toHaveLength(1);
    expect(res[0].textId).toBe(textId);
    expect(res[0].sourceText).toBe("Hola");
    expect(deckId).toBeDefined();
  });

  it("filter=hidden returns only hidden cards", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "A1",
        textCount: 0,
      });
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
      const textVisible = await ctx.db.insert("texts", {
        text: "visible",
        language: "es",
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      const textHidden = await ctx.db.insert("texts", {
        text: "hidden",
        language: "es",
        userCreated: false,
        collectionId,
        collectionRank: 2,
      });
      await ctx.db.insert("cards", {
        deckId,
        textId: textVisible,
        dueDate: 0,
        isMastered: false,
        isHidden: false,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
      await ctx.db.insert("cards", {
        deckId,
        textId: textHidden,
        dueDate: 0,
        isMastered: false,
        isHidden: true,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
    });

    const asUser = t.withIdentity({ subject: "user_A" });
    const hiddenOnly = await asUser.query(
      api.features.library.getLibraryCards,
      { activeFilter: "hidden" },
    );
    expect(hiddenOnly).toHaveLength(1);
    expect(hiddenOnly[0].sourceText).toBe("hidden");
  });
});
