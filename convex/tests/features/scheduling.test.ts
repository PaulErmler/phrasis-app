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

    it("returns dailyReviewsToday = 0 when timezone is omitted (opt-out)", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCardWithCourse(t);
      // Even if today's row has plenty of active reviews, omitting `timezone`
      // makes the caller opt out of the count side-channel — the field must
      // be 0 so test callers (and the layout warm-up) don't accidentally
      // depend on it.
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: today,
          reps: 7,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 7,
          reviewsByMode: { audio: 5, full: 2, radio: 0 },
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {});
      expect(res?.dailyReviewsToday).toBe(0);
    });

    it("returns audio + full from today's dailyStats when timezone is provided (excludes radio)", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCardWithCourse(t);
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: today,
          reps: 12,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: 12,
          reviewsByMode: { audio: 4, full: 3, radio: 5 },
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {
        timezone: "UTC",
      });
      expect(res?.dailyReviewsToday).toBe(7);
    });

    it("returns dailyReviewsToday = 0 when no dailyStats row exists yet today", async () => {
      const t = convexTest(schema, modules);
      await seedCardWithCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.scheduling.getCardForReview, {
        timezone: "UTC",
      });
      expect(res?.dailyReviewsToday).toBe(0);
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
          // Use the current Swedish provider so the row survives the
          // precedence sweep on the copied textId. The test's intent is to
          // verify copy preserves all fields, not the regen logic.
          voiceName: "sv-SE-SofieNeural",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "azure",
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
      expect(audio?.voiceName).toBe("sv-SE-SofieNeural");
      expect(audio?.ttsQuality).toBe("validated");
      expect(audio?.ttsProvider).toBe("azure");
      expect(audio?.voiceGender).toBe("female");
      expect(audio?.speed).toBe(0.9);
      expect(audio?.wordTimings).toEqual([{ word: "Hej", start: 0, end: 0.5 }]);
    });

    it("carries translationSource on unchanged rows and tags edited rows as user-provided", async () => {
      // Seed a Path-B card whose existing en translation was produced by an
      // LLM stage. Editing the source `sv` (not `en`) keeps `en` unchanged,
      // so the logical-copy must carry the existing tag onto the new
      // textId. Add a second target (`de`) and edit it inline to prove the
      // edited branch overwrites to `'user-provided'`.
      const ORIGINAL_EN_SOURCE =
        "google/gemini-3.1-flash-lite-preview-none";
      const t = convexTest(schema, modules);
      const { cardId, textId: oldTextId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const courseId = await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["sv", "de"],
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
          text: "Hej",
          language: "sv",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "en",
          translatedText: "Hello",
          translationSource: ORIGINAL_EN_SOURCE,
        });
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "de",
          translatedText: "Hallo",
          translationSource: ORIGINAL_EN_SOURCE,
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
        return { cardId, textId };
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.scheduling.editCard, {
        cardId,
        translations: [
          // sv (source) changes → forces Path B (new textId).
          { language: "sv", text: "Hejsan" },
          // en unchanged → logical-copy must carry the existing tag over.
          { language: "en", text: "Hello" },
          // de edited → must be retagged as user-provided.
          { language: "de", text: "Hallöchen" },
        ],
        timezone: "UTC",
      });

      const allCards = await t.run(async (ctx) =>
        ctx.db.query("cards").collect(),
      );
      const replacement = allCards.find((c) => c.textId !== oldTextId);
      expect(replacement, "Path B should produce a replacement card").toBeTruthy();
      const newTextId = replacement!.textId;

      const newTranslations = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", newTextId))
          .collect(),
      );
      const byLang = Object.fromEntries(
        newTranslations.map((tr) => [tr.targetLanguage, tr.translationSource]),
      );
      expect(byLang.en).toBe(ORIGINAL_EN_SOURCE);
      expect(byLang.de).toBe("user-provided");
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
      // `reviewsByMode.audio` must mirror `reps` here — the milestone trigger
      // counts non-radio reviews (audio + full), and the next review will
      // bump audio from INTERVAL-1 → INTERVAL.
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
          reviewsByMode: { audio: PROGRESS_DISPLAY_INTERVAL - 1, full: 0, radio: 0 },
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
          reviewsByMode: { audio: PROGRESS_DISPLAY_INTERVAL - 1, full: 0, radio: 0 },
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

    it("excludes radio plays from dailyReviewsToday so the milestone fires on the Nth active review", async () => {
      const t = convexTest(schema, modules);
      const { cardId, courseId } = await seedCardWithCourseAndStats(t);
      // Pre-seed today's dailyStats with INTERVAL-1 audio reviews PLUS a few
      // radio plays. Total `reps` already exceeds the milestone — but only the
      // audio count drives the celebration trigger.
      const today = new Date().toISOString().slice(0, 10);
      await t.run(async (ctx) => {
        await ctx.db.insert("dailyStats", {
          userId: "user_A",
          courseId,
          date: today,
          reps: PROGRESS_DISPLAY_INTERVAL + 4,
          newCards: 0,
          timeMs: 0,
          cardsReviewed: PROGRESS_DISPLAY_INTERVAL + 4,
          reviewsByMode: {
            audio: PROGRESS_DISPLAY_INTERVAL - 1,
            full: 0,
            radio: 5,
          },
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const result = await asUser.mutation(api.features.scheduling.reviewCard, {
        cardId,
        rating: "understood",
        timezone: "UTC",
        sessionId: "session_X",
      });
      // dailyReviewsToday is the active count (audio + full), not total reps.
      expect(result.dailyReviewsToday).toBe(PROGRESS_DISPLAY_INTERVAL);
      expect(result.triggerCelebration).toBe(true);
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

  // ============================================================================
  // Radio mode
  // ============================================================================
  //
  // Radio mode bypasses FSRS entirely. Cards are picked by `radioRoundCounter`
  // (lowest first), and `advanceRadioCard` only patches `radioRoundCounter` +
  // `lastReviewedAt` — it must NOT touch FSRS state, dueDate, schedulingPhase,
  // or daily stats. The catch-up rule keeps a freshly-added card (counter 0)
  // from monopolizing the queue when other cards are at a high counter.
  describe("radio mode", () => {
    /**
     * Seed a deck with `cards.length` cards, each with the supplied
     * `radioRoundCounter` value (or 0 if unspecified). All cards are
     * non-mastered, non-hidden. courseSettings.schedulingMode is set to
     * 'radio'. Returns ids in insertion order.
     */
    async function seedRadioDeck(
      t: ReturnType<typeof convexTest>,
      cards: Array<{ counter?: number; text?: string; orderKey?: number; dueDate?: number }>,
    ) {
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
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          schedulingMode: "radio",
        });
        // recordRadioPlayStats requires a courseStats row (radio plays bump
        // totalRepetitions, totalTimeMs, totalReviewsByMode.radio, streak).
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
          cardCount: cards.length,
        });
        const cardIds = [];
        for (let i = 0; i < cards.length; i++) {
          const { counter = 0, text = `card-${i}`, orderKey, dueDate } = cards[i];
          const textId = await ctx.db.insert("texts", {
            text,
            language: "es",
            userCreated: true,
            userId: "user_A",
            collectionId,
            collectionRank: i + 1,
          });
          await ctx.db.insert("translations", {
            textId,
            targetLanguage: "en",
            translatedText: `EN ${text}`,
          });
          const cardId = await ctx.db.insert("cards", {
            deckId,
            textId,
            collectionId,
            // dueDate is irrelevant for radio picking. Default is a distinct
            // past value so rows insert cleanly; tests that exercise the
            // "plays even when not due" guarantee pass an explicit future
            // value.
            dueDate: dueDate ?? Date.now() - 1000 - i,
            isMastered: false,
            isHidden: false,
            schedulingPhase: "preReview",
            preReviewCount: 0,
            radioRoundCounter: counter,
            // Default to a deterministic orderKey when the test doesn't care,
            // so the first-pick assertion is stable. Tests that exercise the
            // shuffle behavior pass an explicit value.
            radioOrderKey: orderKey ?? i,
          });
          cardIds.push(cardId);
        }
        return { courseId, deckId, cardIds };
      });
    }

    // ------------------------------------------------------------------------
    // getCardForReview (radio scheduling)
    // ------------------------------------------------------------------------
    describe("getCardForReview", () => {
      it("picks the card with the lowest radioRoundCounter", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 5, text: "high" },
          { counter: 0, text: "low" },
          { counter: 3, text: "mid" },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(api.features.scheduling.getCardForReview, {});
        // The "low" card (counter 0) should win.
        expect(res?._id).toBe(cardIds[1]);
        expect(res?.sourceText).toBe("low");
      });

      it("ignores dueDate in radio mode (plays cards even when nothing is due)", async () => {
        // Every card here is dated *in the future* — under learnAndReview the
        // query would return null. Radio must still pick by counter so the
        // user can listen at any time, not just when reviews are due.
        const t = convexTest(schema, modules);
        const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000; // +30d
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 10, dueDate: farFuture + 1 },
          { counter: 0, dueDate: farFuture },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(api.features.scheduling.getCardForReview, {});
        expect(res?._id).toBe(cardIds[1]);
      });

      it("a freshly inserted card (counter 0) plays before cards at counter 100", async () => {
        // This is the headline behavior: new cards jump to the front of the
        // radio queue regardless of how many times the existing deck has
        // looped. Mirrors the "new card joins after 100 plays" scenario.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 100, text: "old-A" },
          { counter: 100, text: "old-B" },
          { counter: 0, text: "fresh" },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(api.features.scheduling.getCardForReview, {});
        expect(res?._id).toBe(cardIds[2]);
        expect(res?.sourceText).toBe("fresh");
      });

      it("returns null when the deck is empty", async () => {
        const t = convexTest(schema, modules);
        await seedRadioDeck(t, []);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(api.features.scheduling.getCardForReview, {});
        expect(res).toBeNull();
      });

      it("skips mastered and hidden cards", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 0, text: "should-be-skipped" },
          { counter: 5, text: "playable" },
        ]);
        // Master the lowest-counter card so it falls out of the radio queue.
        await t.run(async (ctx) => {
          await ctx.db.patch(cardIds[0], { isMastered: true });
        });
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(api.features.scheduling.getCardForReview, {});
        expect(res?._id).toBe(cardIds[1]);
      });
    });

    // ------------------------------------------------------------------------
    // advanceRadioCard
    // ------------------------------------------------------------------------
    describe("advanceRadioCard", () => {
      it("rejects unauthenticated callers", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        await expect(
          t.mutation(api.features.scheduling.advanceRadioCard, {
            cardId: cardIds[0],
            timezone: "UTC",
          }),
        ).rejects.toThrow();
      });

      it("rejects access to another user's card", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asOther = t.withIdentity({ subject: "user_B" });
        await expect(
          asOther.mutation(api.features.scheduling.advanceRadioCard, {
            cardId: cardIds[0],
            timezone: "UTC",
          }),
        ).rejects.toThrow();
      });

      it("increments by 1 when the card is the only one in the deck", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 4 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const result = await asUser.mutation(
          api.features.scheduling.advanceRadioCard,
          { cardId: cardIds[0], timezone: "UTC" },
        );
        expect(result.nextRadioRoundCounter).toBe(5);
        const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        expect(card?.radioRoundCounter).toBe(5);
      });

      it("increments by 1 when all cards share the same counter", async () => {
        // Picked card is at 5, floor (next-lowest) is also 5.
        // newCounter = max(5+1, 5) = 6.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 5 },
          { counter: 5 },
          { counter: 5 },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const result = await asUser.mutation(
          api.features.scheduling.advanceRadioCard,
          { cardId: cardIds[0], timezone: "UTC" },
        );
        expect(result.nextRadioRoundCounter).toBe(6);
      });

      it("catches a fresh card up to one past the floor instead of incrementing by 1", async () => {
        // Headline catch-up rule: picked card at 0, floor at 100.
        // newCounter = max(0, 100) + 1 = 101. The picked card lands one step
        // PAST the rest of the deck — strictly above every other playable
        // card — so it doesn't replay 99 more times in a row AND so it cannot
        // be immediately re-picked when the random `radioOrderKey` tiebreak
        // would otherwise put it first within a tie.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 100, text: "old-A" },
          { counter: 100, text: "old-B" },
          { counter: 0, text: "fresh" },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const result = await asUser.mutation(
          api.features.scheduling.advanceRadioCard,
          { cardId: cardIds[2], timezone: "UTC" },
        );
        expect(result.nextRadioRoundCounter).toBe(101);
        const card = await t.run(async (ctx) => ctx.db.get(cardIds[2]));
        expect(card?.radioRoundCounter).toBe(101);
      });

      it("does not modify FSRS state, dueDate, schedulingPhase, or preReviewCount", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const before = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
        });
        const after = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        // FSRS-related fields are untouched.
        expect(after?.fsrsState).toEqual(before?.fsrsState);
        expect(after?.dueDate).toBe(before?.dueDate);
        expect(after?.schedulingPhase).toBe(before?.schedulingPhase);
        expect(after?.preReviewCount).toBe(before?.preReviewCount);
        expect(after?.isGraduated ?? false).toBe(before?.isGraduated ?? false);
      });

      it("stamps lastReviewedAt", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const before = Date.now();
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
        });
        const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
        expect(card?.lastReviewedAt).toBeGreaterThanOrEqual(before);
      });

      it("plays a full round-robin pass and only revisits the fresh card after each peer plays once", async () => {
        // End-to-end: 3 old cards at counter 100 + 1 fresh card at counter 0.
        // After D plays once and catches up to 100, the next 3 plays should
        // each pick a different one of A/B/C before D could come up again.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 100, text: "A" },
          { counter: 100, text: "B" },
          { counter: 100, text: "C" },
          { counter: 0, text: "D-fresh" },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });

        const playOrder: string[] = [];
        for (let i = 0; i < 4; i++) {
          const next = await asUser.query(
            api.features.scheduling.getCardForReview,
            {},
          );
          if (!next) break;
          playOrder.push(next.sourceText);
          await asUser.mutation(api.features.scheduling.advanceRadioCard, {
            cardId: next._id,
            timezone: "UTC",
          });
        }

        // D plays first (counter 0 wins). Then A, B, C all play in some
        // (now random — see ordering tests below) order before D could be
        // picked again.
        expect(playOrder.length).toBe(4);
        expect(playOrder[0]).toBe("D-fresh");
        expect(playOrder.slice(1).sort()).toEqual(["A", "B", "C"]);
      });

      it("sequential plays of a single-card deck increment monotonically", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const counters: number[] = [];
        for (let i = 0; i < 4; i++) {
          const r = await asUser.mutation(
            api.features.scheduling.advanceRadioCard,
            { cardId: cardIds[0], timezone: "UTC" },
          );
          counters.push(r.nextRadioRoundCounter);
        }
        expect(counters).toEqual([1, 2, 3, 4]);
      });
    });

    // ------------------------------------------------------------------------
    // advanceRadioCard — stats tracking
    // ------------------------------------------------------------------------
    //
    // Radio plays write LIGHT stats: dailyStats reps/timeMs/reviewsByMode.radio
    // /timeMsByMode.radio + courseStats totals + weekly/monthly/yearly rollups
    // + streak. Word tracking, accuracy, ratings, hour buckets, card-state
    // breakdown, and collection progress are intentionally skipped.
    describe("advanceRadioCard — stats", () => {
      it("writes dailyStats with reviewsByMode.radio + timeMsByMode.radio", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
          timeSpentMs: 7500,
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query("dailyStats")
            .withIndex("by_userId_and_courseId_and_date", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first(),
        );
        expect(daily).not.toBeNull();
        expect(daily?.reps).toBe(1);
        expect(daily?.timeMs).toBe(7500);
        expect(daily?.reviewsByMode?.radio).toBe(1);
        expect(daily?.reviewsByMode?.audio).toBe(0);
        expect(daily?.reviewsByMode?.full).toBe(0);
        expect(daily?.timeMsByMode?.radio).toBe(7500);
        expect(daily?.timeMsByMode?.audio).toBe(0);
        // Skipped fields stay at their no-op defaults.
        expect(daily?.newCards).toBe(0);
        expect(daily?.accuracySum).toBeUndefined();
      });

      it("accumulates radio reps + time across multiple plays the same day", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        for (const ms of [1000, 2000, 3000]) {
          await asUser.mutation(api.features.scheduling.advanceRadioCard, {
            cardId: cardIds[0],
            timezone: "UTC",
            timeSpentMs: ms,
          });
        }
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query("dailyStats")
            .withIndex("by_userId_and_courseId_and_date", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first(),
        );
        expect(daily?.reps).toBe(3);
        expect(daily?.timeMs).toBe(6000);
        expect(daily?.reviewsByMode?.radio).toBe(3);
        expect(daily?.timeMsByMode?.radio).toBe(6000);
      });

      it("clamps absurd timeSpentMs to MAX_TIME_PER_PLAY_MS (3 minutes)", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
          // 1 hour of "background" time should not all credit as study.
          timeSpentMs: 60 * 60 * 1000,
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query("dailyStats")
            .withIndex("by_userId_and_courseId_and_date", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first(),
        );
        expect(daily?.timeMs).toBe(180_000);
      });

      it("treats missing timeSpentMs as zero (no fake time credit)", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query("dailyStats")
            .withIndex("by_userId_and_courseId_and_date", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first(),
        );
        expect(daily?.reps).toBe(1);
        expect(daily?.timeMs).toBe(0);
      });

      it("updates courseStats totals + radio counter, but not totalCards", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
          timeSpentMs: 4000,
        });
        const stats = await t.run(async (ctx) =>
          ctx.db
            .query("courseStats")
            .withIndex("by_userId_and_courseId", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first(),
        );
        expect(stats?.totalRepetitions).toBe(1);
        expect(stats?.totalTimeMs).toBe(4000);
        expect(stats?.totalReviewsByMode?.radio).toBe(1);
        // Radio doesn't graduate cards or count "first review" — totalCards
        // should stay at the seeded value (0).
        expect(stats?.totalCards).toBe(0);
        expect(stats?.totalWordCount ?? 0).toBe(0);
      });

      it("counts radio activity toward the streak", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
        });
        const stats = await t.run(async (ctx) =>
          ctx.db
            .query("courseStats")
            .withIndex("by_userId_and_courseId", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first(),
        );
        // currentStreak transitions 0 → 1 on first activity of a fresh course.
        expect(stats?.currentStreak).toBe(1);
        expect(stats?.lastActivityDate).toBeDefined();
      });

      it("populates weekly / monthly / yearly rollups with reviewsByMode.radio", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
          timeSpentMs: 2500,
        });
        const [weekly, monthly, yearly] = await t.run(async (ctx) => {
          const w = await ctx.db
            .query("weeklyStats")
            .withIndex("by_userId_and_courseId", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first();
          const m = await ctx.db
            .query("monthlyStats")
            .withIndex("by_userId_and_courseId", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first();
          const y = await ctx.db
            .query("yearlyStats")
            .withIndex("by_userId_and_courseId", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first();
          return [w, m, y];
        });
        for (const row of [weekly, monthly, yearly]) {
          expect(row).not.toBeNull();
          expect(row?.totalRepetitions).toBe(1);
          expect(row?.totalTimeMs).toBe(2500);
          expect(row?.totalNewCards).toBe(0);
          expect(row?.reviewsByMode?.radio).toBe(1);
          expect(row?.reviewsByMode?.audio).toBe(0);
          expect(row?.reviewsByMode?.full).toBe(0);
        }
      });

      it("does not write per-language stats or word tracking", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
          timeSpentMs: 5000,
        });
        const [dailyLang, langTotals, words] = await t.run(async (ctx) => {
          const dl = await ctx.db
            .query("dailyLanguageStats")
            .withIndex("by_userId_and_courseId_and_date", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .collect();
          const lt = await ctx.db
            .query("languageStats")
            .withIndex("by_userId_and_courseId", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .collect();
          const uw = await ctx.db
            .query("userWords")
            .withIndex("by_userId_and_courseId_and_language", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .collect();
          return [dl, lt, uw];
        });
        expect(dailyLang).toEqual([]);
        expect(langTotals).toEqual([]);
        expect(words).toEqual([]);
      });

      it("does not record a rating, accuracy, or hour bucket", async () => {
        const t = convexTest(schema, modules);
        const { cardIds, courseId } = await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        await asUser.mutation(api.features.scheduling.advanceRadioCard, {
          cardId: cardIds[0],
          timezone: "UTC",
          timeSpentMs: 5000,
        });
        const daily = await t.run(async (ctx) =>
          ctx.db
            .query("dailyStats")
            .withIndex("by_userId_and_courseId_and_date", (q) =>
              q.eq("userId", "user_A").eq("courseId", courseId),
            )
            .first(),
        );
        // Per-rating counters stay at their default zeros.
        expect(daily?.ratingCounts?.again ?? 0).toBe(0);
        expect(daily?.ratingCounts?.understood ?? 0).toBe(0);
        // Hour buckets weren't passed through, so they stay all-zero.
        expect((daily?.hourBuckets ?? []).every((n) => n === 0)).toBe(true);
        expect(daily?.accuracySum).toBeUndefined();
      });
    });

    // ------------------------------------------------------------------------
    // Random tiebreak via radioOrderKey
    // ------------------------------------------------------------------------
    //
    // The radio queue is sorted by `[deckId, isHidden, isMastered,
    // radioRoundCounter, radioOrderKey]`. Within ties on the counter, the
    // random `radioOrderKey` decides — and gets re-rolled on every play so
    // every loop visits cards in a different order.
    describe("radio tiebreak (radioOrderKey)", () => {
      it("when counters tie, the lower radioOrderKey plays first", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          // All same counter; orderKey decides.
          { counter: 5, text: "high-key", orderKey: 1000 },
          { counter: 5, text: "low-key", orderKey: 10 },
          { counter: 5, text: "mid-key", orderKey: 500 },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(
          api.features.scheduling.getCardForReview,
          {},
        );
        expect(res?._id).toBe(cardIds[1]);
        expect(res?.sourceText).toBe("low-key");
      });

      it("regenerates radioOrderKey on advance (typically changes the value)", async () => {
        // Run several plays and confirm the orderKey actually moves around
        // rather than staying constant. With a 32-bit random space, hitting
        // the same value twice in a row is astronomically unlikely.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 0, orderKey: 42 },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const seen: number[] = [42];
        for (let i = 0; i < 5; i++) {
          await asUser.mutation(api.features.scheduling.advanceRadioCard, {
            cardId: cardIds[0],
            timezone: "UTC",
          });
          const card = await t.run(async (ctx) => ctx.db.get(cardIds[0]));
          seen.push(card!.radioOrderKey!);
        }
        // All values are integers within the 32-bit positive range.
        for (const k of seen) {
          expect(Number.isInteger(k)).toBe(true);
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThan(0x7fffffff);
        }
        // At least 5 distinct values across 6 reads (1 initial + 5 plays) —
        // collisions are vanishingly rare in a 32-bit space.
        expect(new Set(seen).size).toBeGreaterThanOrEqual(5);
      });

      it("over a full loop, orderKeys after each play are all distinct", async () => {
        // End-to-end shuffle check: 4 cards all at counter 100 with explicit
        // initial orderKeys. After one full pass, every card's orderKey has
        // been re-rolled, so the next loop's order is pseudo-random.
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 100, text: "A", orderKey: 1 },
          { counter: 100, text: "B", orderKey: 2 },
          { counter: 100, text: "C", orderKey: 3 },
          { counter: 100, text: "D", orderKey: 4 },
        ]);
        const asUser = t.withIdentity({ subject: "user_A" });
        for (let i = 0; i < 4; i++) {
          const next = await asUser.query(
            api.features.scheduling.getCardForReview,
            {},
          );
          if (!next) break;
          await asUser.mutation(api.features.scheduling.advanceRadioCard, {
            cardId: next._id,
            timezone: "UTC",
          });
        }
        const cards = await t.run(async (ctx) =>
          Promise.all(cardIds.map((id) => ctx.db.get(id))),
        );
        const newKeys = cards.map((c) => c!.radioOrderKey!);
        // Every card's key was replaced (none of the seeded values 1..4 stayed).
        for (const k of newKeys) {
          expect([1, 2, 3, 4]).not.toContain(k);
        }
      });
    });

    // ------------------------------------------------------------------------
    // hasPlayableCards
    // ------------------------------------------------------------------------
    describe("hasPlayableCards", () => {
      it("returns false unauthenticated", async () => {
        const t = convexTest(schema, modules);
        const res = await t.query(api.features.scheduling.hasPlayableCards, {});
        expect(res).toBe(false);
      });

      it("returns false with no active course", async () => {
        const t = convexTest(schema, modules);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(false);
      });

      it("returns true when the deck has at least one playable card", async () => {
        const t = convexTest(schema, modules);
        await seedRadioDeck(t, [{ counter: 0 }]);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(true);
      });

      it("returns false when every card is mastered or hidden", async () => {
        const t = convexTest(schema, modules);
        const { cardIds } = await seedRadioDeck(t, [
          { counter: 0 },
          { counter: 0 },
        ]);
        await t.run(async (ctx) => {
          await ctx.db.patch(cardIds[0], { isMastered: true });
          await ctx.db.patch(cardIds[1], { isHidden: true });
        });
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(false);
      });

      it("returns false when the deck is empty", async () => {
        const t = convexTest(schema, modules);
        await seedRadioDeck(t, []);
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.query(
          api.features.scheduling.hasPlayableCards,
          {},
        );
        expect(res).toBe(false);
      });
    });
  });

  describe("flagTranslation", () => {
    // Seeds: course en→es with a card; translation row for `en`; audio row
    // for `en`; usage quota with translation_flags balance > 0.
    async function seedFlaggableCard(
      t: ReturnType<typeof convexTest>,
      opts: { flagsBalance?: number; flagCount?: number } = {},
    ) {
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
          text: "Hola mundo",
          language: "es",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert("translations", {
          textId,
          targetLanguage: "en",
          translatedText: "Hello world",
          ...(opts.flagCount != null ? { flagCount: opts.flagCount } : {}),
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const audioId = await ctx.db.insert("audioRecordings", {
          textId,
          language: "en",
          voiceName: "en-US-test",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "google",
          voiceGender: "female",
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
        const flagsBalance = opts.flagsBalance ?? 10;
        await ctx.db.insert("usageQuotas", {
          userId: "user_A",
          features: {
            translation_flags: {
              balance: flagsBalance,
              included: 10,
              used: 10 - flagsBalance,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, translationId, audioId };
      });
    }

    it("first flag increments count, enqueues retranslation_high, deletes audio, charges quota", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedFlaggableCard(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      const res = await asUser.mutation(api.features.scheduling.flagTranslation, {
        cardId,
        language: "en",
      });
      expect(res).toEqual({ flagCount: 1, retranslated: true });

      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount).toBe(1);

      // Audio row for the flagged language was wiped.
      const audioRows = await t.run(async (ctx) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "en"),
          )
          .collect(),
      );
      expect(audioRows).toHaveLength(0);

      // Queue row inserted with the retranslation_high override + priority 1.
      const queueRows = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      expect(queueRows).toHaveLength(1);
      expect(queueRows[0].args.ruleOverride).toBe("retranslation_high");
      expect(queueRows[0].args.targetLanguage).toBe("en");
      expect(queueRows[0].priority).toBe(1);

      // Quota debited by exactly 1.
      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.translation_flags.balance).toBe(9);
    });

    it("over-cap flag only increments counter — no enqueue, no charge", async () => {
      // Pre-seed flagCount=2 (the cap). Next flag bumps it to 3, which is
      // past FLAG_RETRANSLATION_MAX, so the short-circuit returns before
      // claiming, enqueuing, or charging quota.
      const t = convexTest(schema, modules);
      const { cardId, translationId } = await seedFlaggableCard(t, {
        flagCount: 2,
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      const res = await asUser.mutation(api.features.scheduling.flagTranslation, {
        cardId,
        language: "en",
      });
      expect(res).toEqual({ flagCount: 3, retranslated: false });

      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount).toBe(3);

      const queueRows = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      expect(queueRows).toHaveLength(0);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      // Balance untouched — the over-cap path doesn't bill.
      expect(quota?.features.translation_flags.balance).toBe(10);
    });

    it("refuses to flag the source language", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedFlaggableCard(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      // The seeded text has `language: 'es'` — flagging "es" must reject.
      await expect(
        asUser.mutation(api.features.scheduling.flagTranslation, {
          cardId,
          language: "es",
        }),
      ).rejects.toThrow(/source language/i);
    });

    it("refuses to flag a language that isn't in the course", async () => {
      const t = convexTest(schema, modules);
      const { cardId } = await seedFlaggableCard(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.scheduling.flagTranslation, {
          cardId,
          language: "fr",
        }),
      ).rejects.toThrow(/not part of the active course/i);
    });

    it("when claim is already held, increments counter but skips enqueue and charge", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedFlaggableCard(t);
      // Pre-insert a fresh claim row → `claimLlmTranslationIfAvailable` will
      // return false on the flag path.
      await t.run(async (ctx) => {
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "en",
          claimedAt: Date.now(),
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      const res = await asUser.mutation(api.features.scheduling.flagTranslation, {
        cardId,
        language: "en",
      });
      expect(res).toEqual({ flagCount: 1, retranslated: false });

      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount).toBe(1);

      const queueRows = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      expect(queueRows).toHaveLength(0);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.translation_flags.balance).toBe(10);
    });

    it("rolls back the flagCount patch when quota is depleted", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId, translationId } = await seedFlaggableCard(t, {
        flagsBalance: 0,
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      await expect(
        asUser.mutation(api.features.scheduling.flagTranslation, {
          cardId,
          language: "en",
        }),
      ).rejects.toThrow();

      // Transaction-level rollback: flagCount stays unset, no claim row
      // remains, no queue row was inserted.
      const translation = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(translation?.flagCount ?? 0).toBe(0);

      const claims = await t.run(async (ctx) =>
        ctx.db
          .query("llmTranslationClaims")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "en"),
          )
          .collect(),
      );
      expect(claims).toHaveLength(0);

      const queueRows = await t.run(async (ctx) =>
        ctx.db.query("llmTranslationQueue").collect(),
      );
      expect(queueRows).toHaveLength(0);
    });
  });

  describe("regenerateCardAudio", () => {
    async function seedCardWithAudioForAllLanguages(
      t: ReturnType<typeof convexTest>,
      opts: { audioBalance?: number } = {},
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const courseId = await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["es", "fr"],
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
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        // Translations for both `en` (base) and `fr` (extra target). Source
        // language `es` doesn't need a translation row.
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "en",
          translatedText: "Hello",
        });
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "fr",
          translatedText: "Bonjour",
        });
        // Seed an audio row for each language so we can assert wipe.
        const audioIds: Record<string, unknown> = {};
        for (const lang of ["en", "es", "fr"] as const) {
          const storageId = await ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])]),
          );
          audioIds[lang] = await ctx.db.insert("audioRecordings", {
            textId,
            language: lang,
            voiceName: `${lang}-test`,
            storageId,
            ttsQuality: "validated",
            ttsProvider: "google",
            voiceGender: "female",
          });
        }
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
        const balance = opts.audioBalance ?? 5;
        await ctx.db.insert("usageQuotas", {
          userId: "user_A",
          features: {
            audio_regenerations: {
              balance,
              included: 5,
              used: 5 - balance,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, textId, audioIds };
      });
    }

    it("deletes every audio row for the card and debits one audio_regenerations unit", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCardWithAudioForAllLanguages(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      await asUser.mutation(api.features.scheduling.regenerateCardAudio, {
        cardId,
        timezone: "UTC",
      });

      // All audio rows for the card's text are gone (across base + target langs).
      const remaining = await t.run(async (ctx) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_textId", (q) => q.eq("textId", textId))
          .collect(),
      );
      expect(remaining).toHaveLength(0);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.audio_regenerations.balance).toBe(4);
    });

    it("rejects when audio_regenerations quota is depleted", async () => {
      const t = convexTest(schema, modules);
      const { cardId, textId } = await seedCardWithAudioForAllLanguages(t, {
        audioBalance: 0,
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      await expect(
        asUser.mutation(api.features.scheduling.regenerateCardAudio, {
          cardId,
          timezone: "UTC",
        }),
      ).rejects.toThrow();

      // Audio rows survive the rollback.
      const remaining = await t.run(async (ctx) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_textId", (q) => q.eq("textId", textId))
          .collect(),
      );
      expect(remaining.length).toBeGreaterThan(0);
    });
  });
});
