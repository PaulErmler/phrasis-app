/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { scheduleMissingContent } from "../../features/decks";
import { USER_PROVIDED_TRANSLATION_SOURCE } from "../../../lib/languages";

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob("/convex/**/*.ts");

// Tests here schedule content work on 0ms timers - drain it inside the test
// context so its logs don't race vitest teardown.
drainSchedulerAfterEach();

async function seedCourse(t: ReturnType<typeof convexTest>) {
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
      t: ReturnType<typeof convexTest>,
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
        await ctx.db.insert("audioRecordings", {
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
      const { textId, translationId } = await t.run(async (ctx) => {
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
        // Pre-seed audio so the TTS-enqueue branch short-circuits.
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await ctx.db.insert("audioRecordings", {
          textId,
          language: "de",
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
          targetLanguage: "de",
          translatedText: "Sie ist dadrüben",
          voiceName: TEST_VOICE,
          romanizedText: "Sie ist dadrüben",
          romanizationSource: "new-romanizer",
          translationSource: "google/gemini-3-flash-preview-high",
          replaceExisting: true,
        },
      );

      const row = await t.run(async (ctx) => ctx.db.get(translationId));
      expect(row?.translatedText).toBe("Sie ist dadrüben");
      expect(row?.romanizedText).toBe("Sie ist dadrüben");
      expect(row?.romanizationSource).toBe("new-romanizer");
      expect(row?.translationSource).toBe(
        "google/gemini-3-flash-preview-high",
      );
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
        await ctx.db.insert("audioRecordings", {
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
    async function seedTextWithSpanish(
      t: ReturnType<typeof convexTest>,
      args: {
        translation: {
          speakerGender?: "male" | "female";
          translationSource?: string;
        };
        audio?: { voiceGender: "male" | "female" };
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
          userCreated: true,
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
          await ctx.db.insert("audioRecordings", {
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
      t: ReturnType<typeof convexTest>,
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
  });

  describe("scheduleMissingContent — TTS version regen", () => {
    // `pt_pt` is bumped to ttsVersion 2 in lib/languages.ts (the European
    // Portuguese prompt fix). Audio stamped below that should be deleted +
    // re-synthesized; audio stamped at/above current — or unstamped — survives.
    // Provider + gender are kept matching so ONLY the version check can fire.
    async function seedPtPtAudio(
      t: ReturnType<typeof convexTest>,
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
        await ctx.db.insert("audioRecordings", {
          textId,
          language: "pt_pt",
          voiceName: "Leda",
          storageId,
          ttsProvider: "gemini", // matches current → no provider-mismatch regen
          voiceGender: "female", // matches card → no gender-drift regen
          ...(ttsVersion !== undefined ? { ttsVersion } : {}),
        });
        return { textId };
      });
    }

    async function getPtPtAudio(
      t: ReturnType<typeof convexTest>,
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
      t: ReturnType<typeof convexTest>,
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
        const audioId = await ctx.db.insert("audioRecordings", {
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
      t: ReturnType<typeof convexTest>,
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
});
