/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

// Stub the aggregate component — production code instantiates
// `new TableAggregate(components.cardsByState, ...)` at module-load, and
// the aggregate component is not registered with convex-test here.
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

async function seedCardWithCourse(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
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
      cardCount: 1,
    });
    const textId = await ctx.db.insert("texts", {
      text: "Hola",
      language: "es",
      userCreated: true,
      userId: "user_A",
      collectionId,
      collectionRank: 1,
    });
    const cardId = await ctx.db.insert("cards", {
      deckId,
      textId,
      collectionId,
      dueDate: Date.now() - 1000,
      isMastered: false,
      isHidden: false,
      schedulingPhase: "preReview",
      preReviewCount: 0,
    });
    return { cardId, courseId, deckId, textId };
  });
}

describe("features/scheduling", () => {
  describe("getCardForReview", () => {
    it("returns null unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.scheduling.getCardForReview, {});
      expect(res).toBeNull();
    });

    it("returns null with no active course", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {});
      expect(res).toBeNull();
    });

    it("returns due card for user's active deck", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {});
      expect(res?._id).toBe(cardId);
      expect(res?.sourceText).toBe("Hola");
    });
  });

  describe("masterCard / hideCard / toggleFavoriteCard", () => {
    it("rejects unauthenticated masterCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.masterCard, { cardId }),
      ).rejects.toThrow();
    });

    it("marks a card as mastered", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.masterCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isMastered).toBe(true);
    });

    it("hides a card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.hideCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isHidden).toBe(true);
    });

    it("toggles favorite", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.toggleFavoriteCard, {
        cardId,
      });
      const after = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(after?.isFavorite).toBe(true);
      await asUser.mutation(api.features.scheduling.toggleFavoriteCard, {
        cardId,
      });
      const after2 = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(after2?.isFavorite).toBe(false);
    });

    it("rejects access to another user's card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: "user_B" });
      await expect(
        asOther.mutation(api.features.scheduling.hideCard, { cardId }),
      ).rejects.toThrow();
    });
  });
});
