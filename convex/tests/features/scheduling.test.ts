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
import { PROGRESS_DISPLAY_INTERVAL } from "../../../lib/constants/learning";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedCardWithCourseAndStats(t: ReturnType<typeof convexTest>) {
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
    await ctx.db.insert("courseStats", {
      userId: "user_A",
      courseId,
      totalRepetitions: 0,
      totalTimeMs: 0,
      totalCards: 0,
      currentStreak: 0,
    });
    const deckId = await ctx.db.insert("decks", {
      courseId,
      name: "d",
      cardCount: 1,
    });
    const textId = await ctx.db.insert("texts", {
      text: "Hola mundo",
      language: "es",
      userCreated: true,
      userId: "user_A",
      collectionId,
      collectionRank: 1,
    });
    await ctx.db.insert("translations", {
      textId,
      targetLanguage: "en",
      translatedText: "Hello world",
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
          targetLanguages: ["sv"],
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
          text: "Hej",
          language: "sv",
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
          language: "sv",
          voiceName: "elevenlabs-voice-abc",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "elevenlabs",
          voiceGender: "female",
          speed: 0.9,
          wordTimings: [{ word: "Hej", start: 0, end: 0.5 }],
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

      // Change only the English translation. Source "sv" is untouched, so its
      // audio row must be copied onto the new textId with all fields intact.
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          { language: "sv", text: "Hej" },
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
            q.eq("textId", newTextId).eq("language", "sv"),
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
      expect(audio?.wordTimings).toEqual([{ word: "Hej", start: 0, end: 0.5 }]);
    });
  });

  describe("reviewCard — progress display plumbing", () => {
    it("returns today's review/time/new-words counts after a review", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourseAndStats(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: "understood",
        timezone: "UTC",
        timeSpentMs: 4_000,
        sessionId: "session_X",
      });
      expect(result.dailyReviewsToday).toBe(1);
      expect(result.dailyTimeMsToday).toBe(4_000);
      // `dailyNewWordsToday` only counts target-language words — the seed
      // card has "hola" and "mundo" in `es` (target). The base-language
      // translation ("Hello", "world") tracks userWords but doesn't bump
      // this count.
      expect(result.dailyNewWordsToday).toBe(2);
      // First review only triggers a celebration if INTERVAL divides 1.
      expect(result.triggerCelebration).toBe(1 % PROGRESS_DISPLAY_INTERVAL === 0);
    });

    it("triggers a celebration on the Nth review where N % INTERVAL === 0", async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      // Pre-seed today's reviews so the next one lands exactly on the
      // milestone boundary. UTC matches the timezone arg below.
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: today,
          reps: PROGRESS_DISPLAY_INTERVAL - 1,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: PROGRESS_DISPLAY_INTERVAL - 1,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: "understood",
        timezone: "UTC",
        sessionId: "session_X",
      });
      expect(result.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
      expect(result.triggerCelebration).toBe(true);
    });

    it("does not trigger a celebration when progressDisplayEnabled is false, even on a milestone", async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: today,
          reps: PROGRESS_DISPLAY_INTERVAL - 1,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: PROGRESS_DISPLAY_INTERVAL - 1,
        });
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          progressDisplayEnabled: false,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: "understood",
        timezone: "UTC",
        sessionId: "session_X",
      });
      expect(result.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
      expect(result.triggerCelebration).toBe(false);
    });

    it("stamps sessionId on userWords inserted during the review", async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: "understood",
        timezone: "UTC",
        sessionId: "session_X",
      });
      const stamped = await t.run(async (ctx) =>
        ctx.db
          .query("userWords")
          .withIndex("by_userId_and_courseId_and_language", (q) =>
            q.eq("userId", "user_A").eq("courseId", courseId),
          )
          .filter((q) => q.eq(q.field("sessionId"), "session_X"))
          .collect(),
      );
      expect(stamped.length).toBeGreaterThan(0);
      // Every stamped row should carry the session id we passed.
      for (const row of stamped) {
        expect(row.sessionId).toBe("session_X");
      }
      // The target-language words ("hola", "mundo") should be among them.
      const esWords = stamped.filter((r) => r.language === "es").map((r) => r.word);
      expect(esWords.sort()).toEqual(["hola", "mundo"]);
    });

    it("does not stamp a sessionId when the review is sent without one", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedCardWithCourseAndStats(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: "understood",
        timezone: "UTC",
      });
      const allWords = await t.run(async (ctx) =>
        ctx.db
          .query("userWords")
          .withIndex("by_userId_and_courseId_and_language", (q) =>
            q.eq("userId", "user_A"),
          )
          .collect(),
      );
      expect(allWords.length).toBeGreaterThan(0);
      for (const row of allWords) {
        expect(row.sessionId).toBeUndefined();
      }
    });

    it("accumulates dailyReviewsToday across multiple cards reviewed today", async () => {
      const t = convexTest(schema, modules);
      const { cardId, deckId } = await seedCardWithCourseAndStats(t);

      // Add two more brand-new preReview cards in the same deck so we can
      // do three reviews without any one card transitioning out of preReview.
      const moreCardIds = await t.run(async (ctx) => {
        const collectionId = (await ctx.db.get(cardId))!.collectionId!;
        const ids: string[] = [];
        for (const text of ["Adios", "Casa"]) {
          const newTextId = await ctx.db.insert("texts", {
            text,
            language: "es",
            userCreated: true,
            userId: "user_A",
            collectionId,
            collectionRank: 2,
          });
          const id = await ctx.db.insert("cards", {
            deckId,
            textId: newTextId,
            collectionId,
            dueDate: Date.now() - 1000,
            isMastered: false,
            isHidden: false,
            schedulingPhase: "preReview",
            preReviewCount: 0,
          });
          ids.push(id);
        }
        return ids;
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const all = [cardId, ...moreCardIds];
      const counts: number[] = [];
      for (const id of all) {
        const r = await asUser.mutation(api.features.scheduling.reviewCard, {
          cardId: id as typeof cardId,
          rating: "understood",
          timezone: "UTC",
          sessionId: "session_X",
        });
        counts.push(r.dailyReviewsToday);
      }
      expect(counts).toEqual([1, 2, 3]);
    });
  });
});
