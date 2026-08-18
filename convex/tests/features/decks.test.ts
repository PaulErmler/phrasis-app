/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";

import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  scheduleMissingContent,
  scheduleAudioForLanguage,
} from "../../features/decks";
import {
  findNextIncompleteCollection,
  getActiveDataset,
} from "../../db/collections";
import { USER_PROVIDED_TRANSLATION_SOURCE } from "../../../lib/translationProvenance";
// The workpools are module-mocked globally (tests/convexTestSetup.ts):
// `enqueueAction` is a vi.fn() resolving to unique fake workIds
// ('test-tts-work-N'), so tests can assert the enqueue payload directly.
import { ttsPool } from "../../lib/workpools";

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

// Partial module mock: every real language's voice pickers only ever return
// curated apiCodes, so `scheduleAudioForLanguage`'s "not in the curated voice
// list" throw is unreachable with real data. Route a sentinel language to an
// uncurated voice name; every real code passes through to the actual picker.
vi.mock("@/lib/voices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voices")>();
  return {
    ...actual,
    getVoiceForLanguage: (code: string, speakerGender?: string) =>
      code === "zz_uncurated"
        ? "zz-uncurated-voice"
        : actual.getVoiceForLanguage(code, speakerGender),
  };
});

const mockEnqueueTts = vi.mocked(ttsPool.enqueueAction);

const modules = import.meta.glob("/convex/**/*.ts");

// Tests here schedule content work on 0ms timers - drain it inside the test
// context so its logs don't race vitest teardown.
drainSchedulerAfterEach();

async function seedCourse(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collA1 = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 3,
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
    for (let i = 1; i <= 3; i++) {
      await ctx.db.insert("texts", {
        text: `Hola ${i}`,
        language: "es",
        userCreated: false,
        collectionId: collA1,
        collectionRank: i,
      });
    }
    return { collA1, courseId, deckId };
  });
}

describe("features/decks", () => {
  describe("getDeckCards", () => {
    it("returns [] for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.decks.getDeckCards, {});
      expect(res).toEqual([]);
    });

    it("returns deck cards for active course", async () => {
      const t = convexTest(schema, modules);
      const { collA1, courseId, deckId } = await seedCourse(t);
      await t.run(async (ctx) => {
        const text = await ctx.db
          .query("texts")
          .withIndex("by_collection_and_rank", (q) =>
            q.eq("collectionId", collA1).eq("collectionRank", 1),
          )
          .unique();
        await ctx.db.insert("cards", {
          deckId,
          textId: text!._id,
          collectionId: collA1,
          dueDate: Date.now(),
          isMastered: false,
          isHidden: false,
          schedulingPhase: "preReview",
          preReviewCount: 0,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const cards = await asUser.query(api.features.decks.getDeckCards, {});
      expect(cards).toHaveLength(1);
      expect(cards[0].sourceText).toBe("Hola 1");
      expect(courseId).toBeDefined();
    });
  });

  describe("getCollectionProgress", () => {
    it("returns [] for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.decks.getCollectionProgress, {});
      expect(res).toEqual([]);
    });

    it("returns level-order collections with progress", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await t.run(async (ctx) => {
        // Extra non-level collection that should be excluded
        await ctx.db.insert("collections", {
          name: "custom-xyz",
          textCount: 0,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.decks.getCollectionProgress,
        {},
      );
      expect(res.map((c) => c.collectionName)).toContain("A1");
      expect(res.every((c) => c.collectionName !== "custom-xyz")).toBe(true);
    });

    it("widens totalTexts by the cutover carry", async () => {
      // The carry credit is baked into cardsAdded (numerator), so the
      // denominator must widen by the same amount or the UI reads the level
      // as complete while its own texts are unstudied.
      const t = convexTest(schema, modules);
      const { collA1, courseId } = await seedCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: collA1,
          cardsAdded: 4,
          legacyCarryAdded: 4,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.decks.getCollectionProgress,
        {},
      );
      const a1 = res.find((c) => c.collectionName === "A1");
      expect(a1?.totalTexts).toBe(3 + 4); // textCount + legacyCarryAdded
      expect(a1?.cardsAdded).toBe(4);
    });
  });

  describe("getNextTextsFromCollection", () => {
    it("returns next texts for an accessible level collection", async () => {
      const t = convexTest(schema, modules);
      const { collA1 } = await seedCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const texts = await asUser.query(
        api.features.decks.getNextTextsFromCollection,
        { collectionId: collA1, limit: 2 },
      );
      expect(texts).toHaveLength(2);
      expect(texts[0].collectionRank).toBe(1);
      expect(texts[1].collectionRank).toBe(2);
    });

    it("returns [] for non-accessible collection", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      const unrelated = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "random-xyz", textCount: 0 }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const texts = await asUser.query(
        api.features.decks.getNextTextsFromCollection,
        { collectionId: unrelated },
      );
      expect(texts).toEqual([]);
    });
  });

  describe("setActiveCollection", () => {
    it("rejects when no active course", async () => {
      const t = convexTest(schema, modules);
      const collId = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "A1", textCount: 5 }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.decks.setActiveCollection, {
          collectionId: collId,
        }),
      ).rejects.toThrow();
    });

    it("rejects a genuinely complete collection", async () => {
      const t = convexTest(schema, modules);
      const { collA1, courseId } = await seedCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: collA1,
          cardsAdded: 2,
          ignoredCount: 1, // 2 + 1 === textCount 3
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.decks.setActiveCollection, {
          collectionId: collA1,
        }),
      ).rejects.toThrow(/complete/i);
    });

    it("allows a collection whose cardsAdded is inflated by cutover carry", async () => {
      // Regression: `legacyCarryAdded` is baked into `cardsAdded`, so the raw
      // textCount comparison called this complete while the home view (which
      // widens the denominator by the carry) still offered the Select button.
      const t = convexTest(schema, modules);
      const { collA1, courseId } = await seedCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: collA1,
          cardsAdded: 4, // all carry — none of this collection's 3 texts added
          legacyCarryAdded: 4,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.decks.setActiveCollection, {
        collectionId: collA1,
      });
      const settings = await t.run(async (ctx) =>
        ctx.db
          .query("courseSettings")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .first(),
      );
      expect(settings?.activeCollectionId).toBe(collA1);
    });

    it("no-ops when the collection is already active, even if complete", async () => {
      // Ignoring texts completes a collection without running auto-advance,
      // so the active collection can be complete — re-selecting it changes
      // nothing and must not error.
      const t = convexTest(schema, modules);
      const { collA1, courseId } = await seedCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: collA1,
        });
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: collA1,
          cardsAdded: 0,
          ignoredCount: 3, // every text ignored → complete
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.decks.setActiveCollection, {
          collectionId: collA1,
        }),
      ).resolves.toBeNull();
    });

    it("accepts non-level collections referenced by the course settings, rejects others", async () => {
      // The accessibility gate compares document ids directly (chat
      // collection ===, custom collections .includes) — cover both accept
      // paths and the reject path.
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      const { chatColl, customColl, foreignColl } = await t.run(async (ctx) => {
        const chatColl = await ctx.db.insert("collections", {
          name: "chat-abc",
          textCount: 2,
        });
        const customColl = await ctx.db.insert("collections", {
          name: "custom-def",
          textCount: 2,
        });
        const foreignColl = await ctx.db.insert("collections", {
          name: "custom-other",
          textCount: 2,
        });
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          chatCollectionId: chatColl,
          activeCustomCollectionIds: [customColl],
        });
        return { chatColl, customColl, foreignColl };
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      await expect(
        asUser.mutation(api.features.decks.setActiveCollection, {
          collectionId: chatColl,
        }),
      ).resolves.toBeNull();
      await expect(
        asUser.mutation(api.features.decks.setActiveCollection, {
          collectionId: customColl,
        }),
      ).resolves.toBeNull();
      await expect(
        asUser.mutation(api.features.decks.setActiveCollection, {
          collectionId: foreignColl,
        }),
      ).rejects.toThrow(/not accessible/i);
    });
  });

  describe("setActiveCollectionByLevel / getActiveDifficultyLevel", () => {
    /** Active dataset with L05 + L07 level collections (2 texts each). */
    async function seedDatasetLevels(
      t: TestConvex<typeof schema>,
    ): Promise<Record<string, Id<"collections">>> {
      return t.run(async (ctx) => {
        const datasetId = await ctx.db.insert("datasets", {
          slug: "ogte-test",
          version: "1.0.0",
          publishedAt: Date.now(),
          isActive: true,
        });
        const byCode: Record<string, Id<"collections">> = {};
        for (const code of ["L05", "L07"]) {
          byCode[code] = await ctx.db.insert("collections", {
            name: code,
            code,
            datasetId,
            order: Number(code.slice(1)),
            textCount: 2,
            origin: "premade",
          });
        }
        return byCode;
      });
    }

    it("switches the active collection to the dataset level for the slid OGTE level", async () => {
      const t = convexTest(schema, modules);
      const { courseId, collA1 } = await seedCourse(t);
      const levels = await seedDatasetLevels(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: collA1,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      await asUser.mutation(api.features.decks.setActiveCollectionByLevel, {
        ogteLevel: 7,
      });

      const settings = await t.run(async (ctx) =>
        ctx.db
          .query("courseSettings")
          .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
          .first(),
      );
      expect(settings?.activeCollectionId).toBe(levels.L07);

      // The difficulty query now reads the level back off the collection code.
      const level = await asUser.query(
        api.features.decks.getActiveDifficultyLevel,
        {},
      );
      expect(level).toBe(7);
    });

    it("rejects an out-of-range level and a level with no collection", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await seedDatasetLevels(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      await expect(
        asUser.mutation(api.features.decks.setActiveCollectionByLevel, {
          ogteLevel: 42,
        }),
      ).rejects.toThrow(/invalid level/i);
      await expect(
        asUser.mutation(api.features.decks.setActiveCollectionByLevel, {
          ogteLevel: 9, // L09 not seeded
        }),
      ).rejects.toThrow(/not found/i);
    });

    it("refuses a level the user already completed, no-ops on the active one", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      const levels = await seedDatasetLevels(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: levels.L05,
        });
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: levels.L07,
          cardsAdded: 2, // === textCount → complete
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      await expect(
        asUser.mutation(api.features.decks.setActiveCollectionByLevel, {
          ogteLevel: 7,
        }),
      ).rejects.toThrow(/complete/i);
      await expect(
        asUser.mutation(api.features.decks.setActiveCollectionByLevel, {
          ogteLevel: 5,
        }),
      ).resolves.toBeNull();
    });

    it("getUpcomingSentencesForLevel starts past the user's frontier and resolves target translations", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      const levels = await seedDatasetLevels(t);
      await t.run(async (ctx) => {
        for (let rank = 1; rank <= 4; rank++) {
          const textId = await ctx.db.insert("texts", {
            text: `level five ${rank}`,
            language: "en",
            userCreated: false,
            collectionId: levels.L05,
            collectionRank: rank,
          });
          // Only rank 3 has a target translation — rank 4's row must still
          // appear, with the target side absent (still generating).
          if (rank === 3) {
            await ctx.db.insert("translations", {
              textId,
              targetLanguage: "es",
              translatedText: `nivel cinco ${rank}`,
            });
          }
        }
        // Keep textCount honest with the 4 texts just inserted — the
        // switchable check compares progress against it, so a stale 2 would
        // read this level as already complete.
        await ctx.db.patch(levels.L05, { textCount: 4 });
        // The user already consumed ranks 1-2 of this level.
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: levels.L05,
          cardsAdded: 2,
          lastRankProcessed: 2,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      const page = await asUser.query(
        api.features.decks.getUpcomingSentencesForLevel,
        { ogteLevel: 5 },
      );
      expect(page.exists).toBe(true);
      expect(page.switchable).toBe(true);
      expect(page.sentences.map((r) => r.sourceText)).toEqual([
        "level five 3",
        "level five 4",
      ]);
      expect(page.sentences[0].targetText).toBe("nivel cinco 3");
      expect(page.sentences[1].targetText).toBeUndefined();
    });

    it("getUpcomingSentencesForLevel reports a missing level and an already-completed one as not switchable", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t);
      const levels = await seedDatasetLevels(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: levels.L05,
        });
        // L07 fully consumed → the switch mutation would reject it, so the
        // pager must be able to disable that step instead of dead-ending.
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: levels.L07,
          cardsAdded: 2, // === textCount
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      const complete = await asUser.query(
        api.features.decks.getUpcomingSentencesForLevel,
        { ogteLevel: 7 },
      );
      expect(complete.exists).toBe(true);
      expect(complete.switchable).toBe(false);

      const missing = await asUser.query(
        api.features.decks.getUpcomingSentencesForLevel,
        { ogteLevel: 9 }, // L09 not seeded
      );
      expect(missing).toEqual({
        exists: false,
        switchable: false,
        sentences: [],
      });
    });

    it("getActiveDifficultyLevel returns null for non-level active collections", async () => {
      const t = convexTest(schema, modules);
      const { courseId, collA1 } = await seedCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: collA1, // legacy "A1" — no L-code
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const level = await asUser.query(
        api.features.decks.getActiveDifficultyLevel,
        {},
      );
      expect(level).toBeNull();
    });
  });

  describe("findNextIncompleteCollection", () => {
    it("does not skip a level whose progress is all cutover carry", async () => {
      const t = convexTest(schema, modules);
      const { collA1, courseId } = await seedCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: collA1,
          cardsAdded: 4,
          legacyCarryAdded: 4,
        });
      });
      const next = await t.run(async (ctx) => {
        const collection = (await ctx.db.get(collA1))!;
        return findNextIncompleteCollection(ctx, collection, "user_A", courseId);
      });
      expect(next?._id).toBe(collA1);
    });
  });

  describe("addCardsFromCollection", () => {
    it("happy path: inserts cards from the level collection", async () => {
      const t = convexTest(schema, modules);
      const { collA1, deckId } = await seedCourse(t);
      // Seed quota so consumeQuota(SENTENCES) succeeds.
      await t.run(async (ctx) => {
        await ctx.db.insert("usageQuotas", {
          userId: "user_A",
          features: {
            sentences: {
              balance: 100,
              included: 100,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
      });

      // addCardsFromCollection schedules prepareCardContent for each text,
      // which in turn fans out into translation + TTS + Scribe actions. We
      // drain that chain at the end of the test to avoid post-teardown
      // setTimeout firings hitting a null db state. Fake timers keep those
      // setTimeouts from firing mid-mutation; `finishAllScheduledFunctions`
      // pumps them at a controlled point. Stub every host the chain can
      // reach — unknown hosts throw so the test fails loudly if the chain
      // wanders into unmocked territory.
      vi.useFakeTimers();
      vi.stubEnv("GOOGLE_TTS_API_KEY", "dummy");
      vi.stubEnv("GOOGLE_TRANSLATE_API_KEY", "dummy");
      vi.stubEnv("AZURE_SPEECH_API_KEY", "dummy");
      vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");

      const translateBody = JSON.stringify({
        data: { translations: [{ translatedText: "translated" }] },
      });
      const azureSttBody = JSON.stringify({
        combinedPhrases: [{ text: "translated" }],
        phrases: [
          {
            offsetMilliseconds: 0,
            durationMilliseconds: 500,
            text: "translated",
            locale: "en-US",
            words: [
              { text: "translated", offsetMilliseconds: 0, durationMilliseconds: 500 },
            ],
          },
        ],
      });
      const googleTtsBody = JSON.stringify({
        audioContent: Buffer.from("fake-mp3-bytes").toString("base64"),
      });

      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("translation.googleapis.com/language/translate/v2")) {
          return new Response(translateBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("speechtotext/transcriptions:transcribe")) {
          return new Response(azureSttBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("texttospeech.googleapis.com")) {
          return new Response(googleTtsBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      try {
        const asUser = t.withIdentity({ subject: "user_A" });
        const res = await asUser.mutation(
          api.features.decks.addCardsFromCollection,
          { collectionId: collA1, batchSize: 2 },
        );

        // Drain the scheduled chain (prepareCardContent + fan-out) so that
        // setTimeout callbacks don't fire after the test returns and hit a
        // torn-down db. `finishAllScheduledFunctions` needs a way to advance
        // time — pass vi.runAllTimers since we installed fake timers above.
        await t.finishAllScheduledFunctions(vi.runAllTimers);

        expect(res.cardsAdded).toBeGreaterThan(0);
        const cards = await t.run(async (ctx) =>
          ctx.db
            .query("cards")
            .withIndex("by_deckId", (q) => q.eq("deckId", deckId))
            .collect(),
        );
        expect(cards.length).toBe(res.cardsAdded);
        expect(res.totalCardsInDeck).toBe(cards.length);
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    });
  });

  describe("storeTranslationAndScheduleTTS — translationSource semantics", () => {
    /**
     * Seed a single text + an existing translation row whose
     * `translationSource` is already set (LLM-produced). The
     * "existing row" branch of storeTranslationAndScheduleTTS must
     * never overwrite a present source — `processTranslationForCard`
     * (the Google-fallback path) always passes `GOOGLE_TRANSLATE_SOURCE`,
     * and the row was originally tagged by the LLM queue worker.
     */
    const TEST_VOICE = "es-ES-test-voice";

    async function seedTextWithTaggedTranslation(
      t: TestConvex<typeof schema>,
      args: { existingSource: string },
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert("translations", {
          textId,
          targetLanguage: "es",
          translatedText: "Hola",
          translationSource: args.existingSource,
        });
        // Pre-seed an audio row for this (textId, lang, voice) so the
        // mutation's `!existingAudioForVoice` guard short-circuits and we
        // don't traverse the TTS enqueue path (which validates the voice
        // against the curated voice list — not the point of these tests).
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await insertAudioFixture(ctx, {
          textId,
          language: "es",
          voiceName: TEST_VOICE,
          storageId,
          ttsQuality: "validated",
          ttsProvider: "google",
          voiceGender: "female",
        });
        return { textId, translationId };
      });
    }

    it("keeps the existing translationSource when called with a different source on an existing row", async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId } = await seedTextWithTaggedTranslation(t, {
        existingSource: "openrouter/gemini-flash-lite-low",
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "es",
          translatedText: "Hola",
          voiceName: TEST_VOICE,
          // Google-fallback would normally pass this; the mutation must
          // still leave the original LLM tag in place.
          translationSource: "google-translate-v2",
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translationSource).toBe("openrouter/gemini-flash-lite-low");
    });

    it("fills in translationSource on first-write when the existing row has none", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithTaggedTranslation(t, {
        existingSource: "openrouter/gemini-flash-lite-low",
      });
      // Replace the seeded row with one that has no source — simulates a
      // legacy row that the backfill hasn't yet reached.
      const legacyId = await t.run(async (ctx) => {
        const rows = await ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", textId))
          .collect();
        for (const r of rows) await ctx.db.delete(r._id);
        return ctx.db.insert("translations", {
          textId,
          targetLanguage: "es",
          translatedText: "Hola",
        });
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "es",
          translatedText: "Hola",
          voiceName: TEST_VOICE,
          translationSource: "google-translate-v2",
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(legacyId));
      expect(row?.translationSource).toBe("google-translate-v2");
    });

    /**
     * Regression guard for the bug where flag-triggered retranslations
     * regenerated audio against the new translation but left the existing
     * `translatedText` (and its romanization tagged to the OLD translation)
     * untouched. With `replaceExisting: true` the existing-row branch must
     * overwrite text + romanization + source as a unit.
     */
    it("with replaceExisting=true overwrites translatedText, romanization, and translationSource on an existing row", async () => {
      const t = convexTest(schema, modules);
      // Seed an existing row with old text + old romanization + old source.
      const { textId, translationId, audioId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "She's over there",
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert("translations", {
          textId,
          targetLanguage: "de",
          translatedText: "Sie ist dort drüben",
          romanizedText: "Sie ist dort drüben",
          romanizationSource: "old-romanizer",
          translationSource: "google/gemini-3.1-flash-lite-preview-high",
        });
        // Seed audio for the OLD text — the audibly-different retranslation
        // below must delete it (the replace branch now owns that decision).
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const { rowId: audioId } = await insertAudioFixture(ctx, {
          textId,
          language: "de",
          voiceName: TEST_VOICE,
          storageId,
          ttsQuality: "validated",
          ttsProvider: "google",
          voiceGender: "female",
        });
        return { textId, translationId, audioId };
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "de",
          translatedText: "Sie ist dadrüben",
          voiceName: TEST_VOICE,
          romanizedText: "Sie ist dadrüben",
          romanizationSource: "new-romanizer",
          translationSource: "google/gemini-3-flash-preview-high",
          replaceExisting: true,
          // The audible change deletes the seeded audio, so without this the
          // mutation would fall through to the TTS enqueue and reject the
          // non-curated TEST_VOICE — enqueueing isn't what this test checks.
          skipTts: true,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("Sie ist dadrüben");
      expect(row?.romanizedText).toBe("Sie ist dadrüben");
      expect(row?.romanizationSource).toBe("new-romanizer");
      expect(row?.translationSource).toBe(
        "google/gemini-3-flash-preview-high",
      );
      // Audibly different retranslation → stale audio dropped.
      expect(await t.run(async (ctx) => ctx.db.get(audioId))).toBeNull();
    });

    // Backstop at the write choke point: whatever enqueued the job, no
    // retranslation may land on a card the user created.
    it("with replaceExisting=true refuses to overwrite a translation on a user-created text", async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "Custom",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "She's over there",
          language: "en",
          userCreated: true,
          userId: "user-1",
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert("translations", {
          textId,
          targetLanguage: "de",
          translatedText: "Sie ist dort drüben",
          // Chat-model output: NOT `user-provided`, so the protected-source
          // check alone would let this through.
          translationSource: "openai/gpt-5-chat-none",
        });
        return { textId, translationId };
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "de",
          translatedText: "Sie ist da drüben",
          voiceName: TEST_VOICE,
          translationSource: "google/gemini-3-flash-preview-high",
          replaceExisting: true,
          skipTts: true,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("Sie ist dort drüben");
      expect(row?.translationSource).toBe("openai/gpt-5-chat-none");
    });

    // …but a language the card doesn't have yet must still be fillable, e.g.
    // after the user adds a target language to the course.
    it("still inserts a missing translation on a user-created text", async () => {
      const t = convexTest(schema, modules);
      const textId = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "Custom",
          textCount: 0,
        });
        return ctx.db.insert("texts", {
          text: "She's over there",
          language: "en",
          userCreated: true,
          userId: "user-1",
          collectionId,
          collectionRank: 1,
        });
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "de",
          translatedText: "Sie ist da drüben",
          voiceName: TEST_VOICE,
          translationSource: "google/gemini-3-flash-preview-high",
          replaceExisting: true,
          skipTts: true,
        },
      );

      const row = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "de"),
          )
          .first(),
      );
      expect(row?.translatedText).toBe("Sie ist da drüben");
    });

    it("with replaceExisting=true keeps audio and skips TTS when the change is punctuation-only", async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId, audioId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Oh, I'm sorry.",
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        // The observed bug shape: LLM output with a stray trailing "_".
        const translationId = await ctx.db.insert("translations", {
          textId,
          targetLanguage: "ar_lev",
          translatedText: "أوه، أنا متأسفة._",
          romanizedText: "awh, ana mtasft_",
          romanizationSource: "old-romanizer",
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const { rowId: audioId } = await insertAudioFixture(ctx, {
          textId,
          language: "ar_lev",
          voiceName: TEST_VOICE,
          storageId,
          ttsQuality: "validated",
          ttsProvider: "gemini",
          voiceGender: "female",
        });
        return { textId, translationId, audioId };
      });

      // Deliberately NOT passing skipTts: if the punctuation-only skip failed,
      // the mutation would delete the audio, hit the enqueue path, and throw
      // on the non-curated TEST_VOICE — so completing at all proves the skip.
      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "ar_lev",
          translatedText: "أوه، أنا متأسفة.",
          voiceName: TEST_VOICE,
          romanizedText: "awh, ana mtasft",
          romanizationSource: "new-romanizer",
          replaceExisting: true,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("أوه، أنا متأسفة.");
      expect(row?.romanizedText).toBe("awh, ana mtasft");
      // Sound-identical → the audio row survives the retranslation.
      expect(await t.run(async (ctx) => ctx.db.get(audioId))).not.toBeNull();
    });

    it("post-processes machine output at the choke point (insert branch strips trailing underscores)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        return { textId };
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "es",
          translatedText: "Hola._",
          voiceName: TEST_VOICE,
          romanizedText: "Hola_",
          romanizationSource: "test-romanizer",
          skipTts: true,
        },
      );

      const row = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "es"),
          )
          .first(),
      );
      expect(row?.translatedText).toBe("Hola.");
      expect(row?.romanizedText).toBe("Hola");
    });

    it("with replaceExisting=true clears romanizedText when caller didn't supply one", async () => {
      // For non-romanized languages the worker passes `romanizedText:
      // undefined`. On replace, the old romanization (which referred to the
      // OLD translatedText) must be cleared so a later ensureContent pass
      // can recompute it against the new text — otherwise we'd display a
      // romanization that doesn't match the displayed translation.
      const t = convexTest(schema, modules);
      const { textId, translationId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        const translationId = await ctx.db.insert("translations", {
          textId,
          targetLanguage: "es",
          translatedText: "Hola old",
          romanizedText: "Hola old",
          romanizationSource: "stale-romanizer",
          translationSource: "old-source",
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await insertAudioFixture(ctx, {
          textId,
          language: "es",
          voiceName: TEST_VOICE,
          storageId,
          ttsQuality: "validated",
          ttsProvider: "google",
          voiceGender: "female",
        });
        return { textId, translationId };
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "es",
          translatedText: "Hola new",
          voiceName: TEST_VOICE,
          // No romanizedText — caller didn't compute one for this language.
          translationSource: "new-source",
          replaceExisting: true,
          // Audible change deletes the seeded audio; skip the enqueue so the
          // non-curated TEST_VOICE doesn't throw (not this test's subject).
          skipTts: true,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("Hola new");
      expect(row?.romanizedText).toBeUndefined();
      expect(row?.romanizationSource).toBeUndefined();
      expect(row?.translationSource).toBe("new-source");
    });

    // Single-writer gate: a job carries the claim `_id` it was enqueued under
    // (`expectedClaimId`); a reclaim deletes + reinserts the claim with a new
    // _id, so a mismatch means the job was superseded mid-flight and its
    // (possibly stale) result must not overwrite the current owner's write.
    it("skips the write when expectedClaimId no longer matches (claim reclaimed mid-flight)", async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId } = await seedTextWithTaggedTranslation(t, {
        existingSource: "openrouter/gemini-flash-lite-low",
      });
      // Job was enqueued under claim A; it went stale and was reclaimed
      // (delete + reinsert) by a newer job B before this write landed.
      const staleClaimId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "es",
          claimedAt: Date.now() - 11 * 60 * 1000,
        });
        await ctx.db.delete(id);
        await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "es",
          claimedAt: Date.now(),
          workId: "newer-owner",
        });
        return id;
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "es",
          translatedText: "Hola (stale retranslation)",
          voiceName: TEST_VOICE,
          replaceExisting: true,
          expectedClaimId: staleClaimId,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("Hola");
    });

    it("skips the write when expectedClaimId is supplied but the claim is gone", async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId } = await seedTextWithTaggedTranslation(t, {
        existingSource: "openrouter/gemini-flash-lite-low",
      });
      const releasedClaimId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "es",
          claimedAt: Date.now(),
        });
        await ctx.db.delete(id);
        return id;
      });

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "es",
          translatedText: "Hola (orphan write)",
          voiceName: TEST_VOICE,
          replaceExisting: true,
          expectedClaimId: releasedClaimId,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("Hola");
    });

    it("writes when expectedClaimId matches the live claim", async () => {
      const t = convexTest(schema, modules);
      const { textId, translationId } = await seedTextWithTaggedTranslation(t, {
        existingSource: "openrouter/gemini-flash-lite-low",
      });
      const claimId = await t.run(async (ctx) =>
        ctx.db.insert("llmTranslationClaims", {
          textId,
          targetLanguage: "es",
          claimedAt: Date.now(),
          workId: "this-job",
        }),
      );

      await t.mutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId,
          targetLanguage: "es",
          translatedText: "Hola nueva",
          voiceName: TEST_VOICE,
          replaceExisting: true,
          expectedClaimId: claimId,
          // Audible change deletes the seeded audio; skip the enqueue so the
          // non-curated TEST_VOICE doesn't throw (not this test's subject).
          skipTts: true,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("Hola nueva");
    });
  });

  describe("scheduleMissingContent — gender-drift translation sweep", () => {
    // Seed a definitive-gender source text (female) plus one Spanish
    // translation row, and optionally a Spanish audio row. Both
    // `speakerGender` and `audioSpeakerGender` are 'female', so the gender
    // resolution at the top of scheduleMissingContent is a no-op and the
    // resolved voice gender the sweep compares against is 'female'.
    //
    // `userCreated` defaults to false (premade content): the sweep only ever
    // rewrites machine output on premade texts, so that is the case these
    // deletion tests must exercise. Pass true for the user-owned cases.
    async function seedTextWithSpanish(
      t: TestConvex<typeof schema>,
      args: {
        translation: {
          speakerGender?: "male" | "female";
          translationSource?: string;
        };
        audio?: { voiceGender: "male" | "female" };
        userCreated?: boolean;
      },
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language: "en",
          userCreated: args.userCreated ?? false,
          speakerGender: "female",
          audioSpeakerGender: "female",
          collectionId,
          collectionRank: 1,
        });
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "es",
          translatedText: "Hola",
          ...(args.translation.translationSource
            ? { translationSource: args.translation.translationSource }
            : {}),
          ...(args.translation.speakerGender
            ? { speakerGender: args.translation.speakerGender }
            : {}),
        });
        if (args.audio) {
          const storageId = await ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])]),
          );
          await insertAudioFixture(ctx, {
            textId,
            language: "es",
            voiceName: "es-test-voice",
            storageId,
            ttsQuality: "validated",
            ttsProvider: "google",
            voiceGender: args.audio.voiceGender,
          });
        }
        return { textId };
      });
    }

    // Run the sweep and return the surviving Spanish translation row (or null
    // if deleted). The query runs inside the same transaction as the sweep so
    // scheduled re-translation functions haven't fired yet — we observe the
    // exact post-sweep state.
    async function runSweepAndGetSpanish(
      t: TestConvex<typeof schema>,
      textId: Id<"texts">,
    ) {
      return t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        await scheduleMissingContent(ctx, textId, text, ["en"], ["es"]);
        return ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "es"),
          )
          .first();
      });
    }

    it("deletes a stamped translation whose gender drifted from the card's voice gender", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithSpanish(t, {
        // Stamped 'male' but the card's audioSpeakerGender is 'female' → drift.
        translation: {
          speakerGender: "male",
          translationSource: "google-translate-v2",
        },
      });
      expect(await runSweepAndGetSpanish(t, textId)).toBeNull();
    });

    it("deletes a legacy (unstamped) translation when its audio drifted gender", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithSpanish(t, {
        // No speakerGender (legacy row) + a male-voiced audio row that drifts
        // from the female card → the audio-drift signal authorizes deletion.
        translation: { translationSource: "google-translate-v2" },
        audio: { voiceGender: "male" },
      });
      expect(await runSweepAndGetSpanish(t, textId)).toBeNull();
    });

    it("keeps a legacy translation when there is no audio-drift signal", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithSpanish(t, {
        // Legacy row, no audio at all → no evidence it's wrong, leave it.
        translation: { translationSource: "google-translate-v2" },
      });
      expect(await runSweepAndGetSpanish(t, textId)).toBeTruthy();
    });

    it("skips user-provided translations even when the gender drifts", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithSpanish(t, {
        translation: {
          speakerGender: "male",
          translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
        },
      });
      expect(await runSweepAndGetSpanish(t, textId)).toBeTruthy();
    });

    // The reporter's bug: a chat-created card carries the CHAT MODEL's slug as
    // its translationSource, not `user-provided`, so the protected-source check
    // alone let the gender sweep delete it and re-translate from the stored
    // source rendering — losing the wording the user approved.
    it("keeps a machine-sourced translation on a user-created card when the gender drifts", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithSpanish(t, {
        userCreated: true,
        translation: {
          speakerGender: "male",
          translationSource: "openai/gpt-5-chat-none",
        },
      });
      expect(await runSweepAndGetSpanish(t, textId)).toBeTruthy();
    });

    it("keeps a legacy translation on a user-created card when its audio drifted gender", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithSpanish(t, {
        userCreated: true,
        translation: { translationSource: "google-translate-v2" },
        audio: { voiceGender: "male" },
      });
      expect(await runSweepAndGetSpanish(t, textId)).toBeTruthy();
    });

    // The text is the user's; the voice is ours. Drifted audio on a
    // user-created card must still be dropped so it can be re-synthesized at
    // the card's current gender — the guard covers translations only.
    it("still deletes drifted audio on a user-created card", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextWithSpanish(t, {
        userCreated: true,
        translation: { translationSource: "google-translate-v2" },
        audio: { voiceGender: "male" },
      });
      const audio = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        await scheduleMissingContent(ctx, textId, text, ["en"], ["es"]);
        return ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "es"),
          )
          .first();
      });
      expect(audio).toBeNull();
    });
  });

  describe("scheduleMissingContent — TTS version regen", () => {
    // `pt_pt` is bumped to ttsVersion 2 in lib/languages.ts (the European
    // Portuguese prompt fix). Audio stamped below that should be deleted +
    // re-synthesized; audio stamped at/above current — or unstamped — survives.
    // Provider + gender are kept matching so ONLY the version check can fire.
    async function seedPtPtAudio(
      t: TestConvex<typeof schema>,
      ttsVersion: number | undefined,
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language: "en",
          userCreated: true,
          speakerGender: "female",
          audioSpeakerGender: "female",
          collectionId,
          collectionRank: 1,
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await insertAudioFixture(ctx, {
          textId,
          language: "pt_pt",
          voiceName: "Leda",
          storageId,
          ttsProvider: "gemini", // matches current → no provider-mismatch regen
          voiceGender: "female", // matches card → no gender-drift regen
          ttsVersion,
        });
        return { textId };
      });
    }

    async function getPtPtAudio(
      t: TestConvex<typeof schema>,
      textId: Id<"texts">,
    ) {
      return t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        const result = await scheduleMissingContent(
          ctx,
          textId,
          text,
          ["en"],
          ["pt_pt"],
        );
        const audio = await ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "pt_pt"),
          )
          .first();
        return { audio, result };
      });
    }

    it("deletes audio stamped below the current ttsVersion AND schedules regeneration", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPtPtAudio(t, 1); // pt_pt current is 2
      const { audio, result } = await getPtPtAudio(t, textId);
      expect(audio).toBeNull();
      // Guard against a "delete but never regenerate" regression: the deleted
      // pt_pt audio needs a (missing) translation first, so the sweep must
      // schedule a replacement rather than just dropping the row.
      expect(result.translationsScheduled).toBeGreaterThan(0);
    });

    it("keeps audio stamped at the current ttsVersion", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPtPtAudio(t, 2);
      expect((await getPtPtAudio(t, textId)).audio).toBeTruthy();
    });

    it("keeps unstamped (undefined) audio — undefined === current, no storm", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedPtPtAudio(t, undefined);
      expect((await getPtPtAudio(t, textId)).audio).toBeTruthy();
    });
  });

  describe("scheduleMissingContent — translation version regen", () => {
    // No language sets `translationVersion` today, so a row stamped at 0 (strictly
    // below the default current version 1) is the only way to exercise the stale
    // branch. `speakerGender` matches `audioSpeakerGender` so ONLY the version
    // check fires (no gender drift), and the audio matches provider+gender+version
    // so it is deleted purely as the cascade of the stale translation.
    async function seedStaleTranslation(
      t: TestConvex<typeof schema>,
      userCreated: boolean,
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language: "en",
          userCreated,
          speakerGender: "female",
          audioSpeakerGender: "female",
          collectionId,
          collectionRank: 1,
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        const trId = await ctx.db.insert("translations", {
          textId,
          targetLanguage: "es",
          translatedText: "Hola",
          speakerGender: "female", // matches audioSpeakerGender → no drift
          translationVersion: 0, // strictly below current (1) → stale
        });
        const { rowId: audioId } = await insertAudioFixture(ctx, {
          textId,
          language: "es",
          voiceName: "es-test-voice",
          storageId,
          ttsProvider: "gemini", // matches current → no provider-mismatch regen
          voiceGender: "female", // matches card → no gender-drift regen
        });
        return { textId, trId, audioId };
      });
    }

    async function runSweep(
      t: TestConvex<typeof schema>,
      textId: Id<"texts">,
    ) {
      return t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        const result = await scheduleMissingContent(
          ctx,
          textId,
          text,
          ["en"],
          ["es"],
        );
        const tr = await ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "es"),
          )
          .first();
        const audio = await ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "es"),
          )
          .first();
        return { result, tr, audio };
      });
    }

    it("deletes a premade stale translation + its audio and schedules regeneration", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedStaleTranslation(t, false);
      const { result, tr, audio } = await runSweep(t, textId);
      expect(tr).toBeNull(); // version-stale translation deleted
      expect(audio).toBeNull(); // its audio cascade-deleted
      expect(result.translationsScheduled).toBeGreaterThan(0); // regen scheduled
    });

    it("keeps a user-created stale translation (the !userCreated guard) and its audio", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedStaleTranslation(t, true);
      const { tr, audio } = await runSweep(t, textId);
      // userCreated translations are user-owned → never version-regenerated.
      expect(tr).not.toBeNull();
      expect(audio).not.toBeNull();
    });
  });

  describe("scheduleAudioForLanguage", () => {
    beforeEach(() => {
      // Clear calls only — the setup-file implementation (unique fake
      // workIds) must stay installed.
      mockEnqueueTts.mockClear();
    });

    async function seedBareText(t: TestConvex<typeof schema>, language: string) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language,
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        return { textId };
      });
    }

    const getClaims = (t: TestConvex<typeof schema>) =>
      t.run(async (ctx) => ctx.db.query("ttsGenerationClaims").collect());

    it("returns false without claiming when the language is not the source and no translation exists", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedBareText(t, "en");
      const res = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return scheduleAudioForLanguage(ctx, text, "es", "female", null);
      });
      expect(res).toBe(false);
      // Early return fires BEFORE the claim attempt — no claim row either.
      expect(await getClaims(t)).toEqual([]);
      expect(mockEnqueueTts).not.toHaveBeenCalled();
    });

    it("returns false and does not enqueue while a fresh TTS claim holds the slot", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedBareText(t, "en");
      await t.run(async (ctx) => {
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "es",
          translatedText: "Hola",
        });
        await ctx.db.insert("ttsGenerationClaims", {
          textId,
          language: "es",
          claimedAt: Date.now(),
        });
      });
      const res = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        const translation = await ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", "es"),
          )
          .first();
        return scheduleAudioForLanguage(ctx, text, "es", "female", translation);
      });
      expect(res).toBe(false);
      expect(mockEnqueueTts).not.toHaveBeenCalled();
    });

    it("enqueues the source text via getVoiceForLanguage for the text's own language", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedBareText(t, "es");
      // Pin the random pick: es runs on Gemini, its female pool is
      // [Leda, Gacrux] and index 0 is Leda.
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        const res = await t.run(async (ctx) => {
          const text = (await ctx.db.get(textId))!;
          return scheduleAudioForLanguage(ctx, text, "es", "female", null);
        });
        expect(res).toBe(true);
      } finally {
        randomSpy.mockRestore();
      }
      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      // Full pool payload as flattened by enqueueTtsJob (args + provider).
      expect(mockEnqueueTts.mock.calls[0][2]).toEqual({
        textId,
        text: "Hello", // source text — no translation involved
        language: "es",
        voiceName: "Leda",
        voiceGender: "female",
        speed: 1,
        regionVariant: undefined,
        provider: "gemini",
      });
      const claims = await getClaims(t);
      expect(claims).toHaveLength(1);
      // enqueueTtsJob stamps the pool workId onto the claim just acquired.
      expect(claims[0].workId).toMatch(/^test-tts-work-/);
    });

    it("enqueues the stored translation's text via getVoiceForLanguage when it has no regionVariant", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedBareText(t, "en");
      await t.run(async (ctx) => {
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "es",
          translatedText: "Hola traducida",
        });
      });
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        const res = await t.run(async (ctx) => {
          const text = (await ctx.db.get(textId))!;
          const translation = await ctx.db
            .query("translations")
            .withIndex("by_text_and_language", (q) =>
              q.eq("textId", textId).eq("targetLanguage", "es"),
            )
            .first();
          return scheduleAudioForLanguage(ctx, text, "es", "female", translation);
        });
        expect(res).toBe(true);
      } finally {
        randomSpy.mockRestore();
      }
      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(mockEnqueueTts.mock.calls[0][2]).toEqual({
        textId,
        text: "Hola traducida", // translated text, not the source
        language: "es",
        voiceName: "Leda", // plain pick — no variant suffix
        voiceGender: "female",
        speed: 1,
        regionVariant: undefined,
        provider: "gemini",
      });
    });

    it("forwards the translation's regionVariant through the variant voice picker", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedBareText(t, "en");
      await t.run(async (ctx) => {
        await ctx.db.insert("translations", {
          textId,
          targetLanguage: "es_mixed",
          translatedText: "Hola variante",
          regionVariant: "es-US",
        });
      });
      // Pinned pick within the es_mixed @es-US female sub-pool
      // [Leda@es-US, Gacrux@es-US] → index 0.
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        const res = await t.run(async (ctx) => {
          const text = (await ctx.db.get(textId))!;
          const translation = await ctx.db
            .query("translations")
            .withIndex("by_text_and_language", (q) =>
              q.eq("textId", textId).eq("targetLanguage", "es_mixed"),
            )
            .first();
          return scheduleAudioForLanguage(
            ctx,
            text,
            "es_mixed",
            "female",
            translation,
          );
        });
        expect(res).toBe(true);
      } finally {
        randomSpy.mockRestore();
      }
      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(mockEnqueueTts.mock.calls[0][2]).toEqual({
        textId,
        text: "Hola variante",
        language: "es_mixed",
        voiceName: "Leda@es-US", // locale-pinned variant pick
        voiceGender: "female",
        speed: 1,
        regionVariant: "es-US", // forwarded so STT validates in the same locale
        provider: "gemini",
      });
    });

    it("throws when the picked voice is not in the curated list", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedBareText(t, "zz_uncurated");
      await expect(
        t.run(async (ctx) => {
          const text = (await ctx.db.get(textId))!;
          return scheduleAudioForLanguage(
            ctx,
            text,
            "zz_uncurated",
            "female",
            null,
          );
        }),
      ).rejects.toThrow(/is not in the curated voice list/);
      expect(mockEnqueueTts).not.toHaveBeenCalled();
    });
  });

  describe("storeTranslationAndScheduleTTS — TTS enqueue path", () => {
    beforeEach(() => {
      mockEnqueueTts.mockClear();
    });

    async function seedTextOnly(t: TestConvex<typeof schema>) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "A1",
          textCount: 0,
        });
        const textId = await ctx.db.insert("texts", {
          text: "Hello",
          language: "en",
          userCreated: false,
          collectionId,
          collectionRank: 1,
        });
        return { textId };
      });
    }

    async function seedAudioForVoice(
      t: TestConvex<typeof schema>,
      textId: Id<"texts">,
      voiceName: string,
    ) {
      await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await insertAudioFixture(ctx, {
          textId,
          language: "es",
          voiceName,
          storageId,
          ttsQuality: "validated",
          ttsProvider: "gemini",
          voiceGender: "female",
        });
      });
    }

    it("claims and enqueues TTS for the freshly stored translation with the exact payload", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextOnly(t);

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: "es",
        translatedText: "Hola",
        voiceName: "Leda", // curated Gemini voice — the enqueue path accepts it
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(mockEnqueueTts.mock.calls[0][2]).toEqual({
        textId,
        text: "Hola",
        language: "es",
        voiceName: "Leda",
        voiceGender: "female", // resolved from the curated list, not an arg
        speed: 1,
        regionVariant: undefined,
        provider: "gemini",
      });
      const claims = await t.run(async (ctx) =>
        ctx.db.query("ttsGenerationClaims").collect(),
      );
      expect(claims).toHaveLength(1);
      expect(claims[0].workId).toMatch(/^test-tts-work-/);
    });

    it("skips claim + enqueue when audio for the same voice already exists", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextOnly(t);
      await seedAudioForVoice(t, textId, "Leda");

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: "es",
        translatedText: "Hola",
        voiceName: "Leda",
      });

      expect(mockEnqueueTts).not.toHaveBeenCalled();
      // The per-voice guard short-circuits BEFORE claiming — no claim row.
      const claims = await t.run(async (ctx) =>
        ctx.db.query("ttsGenerationClaims").collect(),
      );
      expect(claims).toEqual([]);
    });

    it("skips the enqueue when audio already exists under a different voice (drift is the sweep's job)", async () => {
      // Pre-audioAssets, the per-voice guard would re-enqueue here. Now any
      // existing (text, language) row skips TTS — a wrong-voice/gender row is
      // detected and regenerated by the ensure sweep, which reads through the
      // shared asset payload, instead of duplicating synthesis on every
      // translation landing.
      const t = convexTest(schema, modules);
      const { textId } = await seedTextOnly(t);
      await seedAudioForVoice(t, textId, "Gacrux");

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: "es",
        translatedText: "Hola",
        voiceName: "Leda",
      });

      expect(mockEnqueueTts).not.toHaveBeenCalled();
    });

    it("does not double-enqueue on a second landing for the same voice (claim held)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedTextOnly(t);

      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: "es",
        translatedText: "Hola",
        voiceName: "Leda",
      });
      // Second landing (e.g. Google fallback racing the LLM path): the audio
      // row hasn't been written yet (the worker is mocked), so the per-voice
      // guard passes — the fresh claim from the first call blocks the enqueue.
      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: "es",
        translatedText: "Hola",
        voiceName: "Leda",
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
    });
  });

  describe("getCollectionProgress — active dataset branch", () => {
    it("returns the active dataset's collections with progress values, excluding legacy by-name rows", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedCourse(t); // seeds legacy "A1" (no datasetId)
      await t.run(async (ctx) => {
        const datasetId = await ctx.db.insert("datasets", {
          slug: "ogte-curated",
          version: "1.0.0",
          publishedAt: Date.now(),
          isActive: true,
        });
        const l01 = await ctx.db.insert("collections", {
          name: "L01",
          textCount: 50,
          datasetId,
          code: "L01",
          order: 1,
          origin: "premade",
        });
        await ctx.db.insert("collections", {
          name: "L02",
          textCount: 40,
          datasetId,
          code: "L02",
          order: 2,
          origin: "premade",
        });
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: l01,
          cardsAdded: 5,
          ignoredCount: 2,
          prioritizedCount: 1,
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.decks.getCollectionProgress,
        {},
      );

      // Dataset branch replaces the legacy by-name scan entirely — the "A1"
      // row from seedCourse is absent.
      expect(res.map((c) => c.collectionName)).toEqual(["L01", "L02"]);
      expect(res[0]).toMatchObject({
        cardsAdded: 5,
        ignoredCount: 2,
        prioritizedCount: 1,
        totalTexts: 50,
        order: 1,
      });
      expect(res[1]).toMatchObject({
        cardsAdded: 0,
        ignoredCount: 0,
        prioritizedCount: 0,
        totalTexts: 40,
        order: 2,
      });
    });

    it("sorts order-bearing rows first, then order-less rows by legacy CEFR position", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await t.run(async (ctx) => {
        const datasetId = await ctx.db.insert("datasets", {
          slug: "ogte-curated",
          version: "1.0.0",
          publishedAt: Date.now(),
          isActive: true,
        });
        // Order-less dataset rows inserted FIRST: the by_datasetId_and_order
        // index yields undefined-order rows before ordered ones, so the final
        // ordering below can only come from the two-tier sort.
        await ctx.db.insert("collections", {
          name: "B1",
          textCount: 10,
          datasetId,
        });
        await ctx.db.insert("collections", {
          name: "A2",
          textCount: 10,
          datasetId,
        });
        await ctx.db.insert("collections", {
          name: "L02",
          textCount: 40,
          datasetId,
          code: "L02",
          order: 2,
          origin: "premade",
        });
        await ctx.db.insert("collections", {
          name: "L01",
          textCount: 50,
          datasetId,
          code: "L01",
          order: 1,
          origin: "premade",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.decks.getCollectionProgress,
        {},
      );

      // Two tiers: `order` ascending first, then legacy CEFR position
      // (A2 before B1 in LEGACY_LEVEL_ORDER).
      expect(res.map((c) => c.collectionName)).toEqual([
        "L01",
        "L02",
        "A2",
        "B1",
      ]);
      expect(res.map((c) => c.order)).toEqual([1, 2, undefined, undefined]);
    });
  });

  describe("getActiveDataset", () => {
    it("returns the active dataset row, ignoring inactive ones", async () => {
      const t = convexTest(schema, modules);
      const activeId = await t.run(async (ctx) => {
        await ctx.db.insert("datasets", {
          slug: "ogte-curated",
          version: "0.9.0",
          publishedAt: Date.now(),
          isActive: false,
        });
        return ctx.db.insert("datasets", {
          slug: "ogte-curated",
          version: "1.0.0",
          publishedAt: Date.now(),
          isActive: true,
        });
      });
      const active = await t.run(async (ctx) => getActiveDataset(ctx));
      expect(active?._id).toBe(activeId);
      expect(active?.version).toBe("1.0.0");
    });

    it("returns null when no dataset is active", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("datasets", {
          slug: "ogte-curated",
          version: "0.9.0",
          publishedAt: Date.now(),
          isActive: false,
        });
      });
      expect(await t.run(async (ctx) => getActiveDataset(ctx))).toBeNull();
    });
  });
});
