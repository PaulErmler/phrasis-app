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

    it("unmasters a previously mastered card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.masterCard, { cardId });
      await asUser.mutation(api.features.scheduling.unmasterCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isMastered).toBe(false);
    });

    it("rejects unauthenticated unmasterCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.unmasterCard, { cardId }),
      ).rejects.toThrow();
    });

    it("rejects access to another user's card on unmasterCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: "user_B" });
      await expect(
        asOther.mutation(api.features.scheduling.unmasterCard, { cardId }),
      ).rejects.toThrow();
    });

    it("hides a card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.hideCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isHidden).toBe(true);
    });

    it("unhides a previously hidden card", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.hideCard, { cardId });
      await asUser.mutation(api.features.scheduling.unhideCard, { cardId });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card?.isHidden).toBe(false);
    });

    it("rejects unauthenticated unhideCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.unhideCard, { cardId }),
      ).rejects.toThrow();
    });

    it("rejects access to another user's card on unhideCard", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: "user_B" });
      await expect(
        asOther.mutation(api.features.scheduling.unhideCard, { cardId }),
      ).rejects.toThrow();
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

  describe("deleteCardPermanently", () => {
    it("rejects unauthenticated deleteCardPermanently", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      await expect(
        t.mutation(api.features.scheduling.deleteCardPermanently, { cardId }),
      ).rejects.toThrow();
    });

    it("rejects access to another user's card on deleteCardPermanently", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asOther = t.withIdentity({ subject: "user_B" });
      await expect(
        asOther.mutation(api.features.scheduling.deleteCardPermanently, {
          cardId,
        }),
      ).rejects.toThrow();
      // Card row survives the rejected attempt.
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card).not.toBeNull();
    });

    it("permanently removes the card row", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });
      const card = await t.run(async (ctx) => ctx.db.get(cardId));
      expect(card).toBeNull();
      // Shared text survives — other cards may reference it.
      const text = await t.run(async (ctx) => ctx.db.get(textId));
      expect(text).not.toBeNull();
    });

    it("getCardForReview skips a deleted card and returns null when nothing is left", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.deleteCardPermanently, {
        cardId,
      });
      const res = await asUser.query(
        api.features.scheduling.getCardForReview,
        {},
      );
      expect(res).toBeNull();
    });
  });

  describe("editCard — Path B (shared/dataset text)", () => {
    /**
     * Seed a card backed by a *shared* (not user-owned) text so editCard
     * takes the "create new textId, copy unchanged content" branch. Includes
     * a pre-existing audioRecordings row for the source language with every
     * schema field populated so we can assert they all survive the copy.
     */
    async function seedSharedCardWithAudio(t: ReturnType<typeof convexTest>) {
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
        // Shared dataset text (NOT user-owned) → editCard takes Path B.
        const textId = await ctx.db.insert("texts", {
          text: "Hola",
          language: "es",
          userCreated: false,
          audioSpeakerGender: "female",
          collectionId,
          collectionRank: 1,
        });
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "en",
          translatedText: "Hello",
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const audioId = await ctx.db.insert("audioRecordings", {
          textId,
          language: "es",
          voiceName: "elevenlabs-voice-abc",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "elevenlabs",
          voiceGender: "female",
          speed: 0.9,
          wordTimings: [{ word: "Hola", start: 0, end: 0.5 }],
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
        await ctx.db.insert("usageQuotas", {
          userId: "user_A",
          features: {
            card_edits: {
              balance: 100,
              included: 100,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, audioId, storageId };
      });
    }

    it("copies all audio fields for unchanged languages when Path B creates a new textId", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await seedSharedCardWithAudio(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      // Change only the English translation. Source "es" is untouched, so its
      // audio row must be copied onto the new textId with all fields intact.
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: "es", text: "Hola" },
          { language: "en", text: "Hi there" },
        ],
        timezone: "UTC",
      });

      // Path B creates a new card pointing at a new textId. Find it by
      // scanning cards and picking the one whose textId changed.
      const allCards = await t.run(async (ctx) =>
        ctx.db.query("cards").collect(),
      );
      const replacement = allCards.find((c) => c.textId !== oldTextId);
      expect(replacement, "a replacement card should exist").toBeTruthy();
      const newTextId = replacement!.textId;
      const audio = await t.run(async (ctx) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", newTextId).eq("language", "es"),
          )
          .first(),
      );
      // Every field from the source row must be preserved on the copy.
      expect(audio, "audio row was not copied for unchanged language").toBeTruthy();
      expect(audio?.voiceName).toBe("elevenlabs-voice-abc");
      expect(audio?.ttsQuality).toBe("validated");
      expect(audio?.ttsProvider).toBe("elevenlabs");
      expect(audio?.voiceGender).toBe("female");
      expect(audio?.speed).toBe(0.9);
      expect(audio?.wordTimings).toEqual([{ word: "Hola", start: 0, end: 0.5 }]);
    });
  });
});
