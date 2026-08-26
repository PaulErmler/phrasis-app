/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi } from "vitest";

import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { ADD_SCAN_CAP } from "../../features/decks";
import type { Id } from "../../_generated/dataModel";

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob("/convex/**/*.ts");

drainSchedulerAfterEach();

/**
 * Prioritize/ignore-aware add flows: prioritized drain order, ignored skips,
 * direct-add counting, scan-cap continuation, and the skipTts store guard.
 */

async function seedCourseWithTexts(
  t: TestConvex<typeof schema>,
  count: number,
  quotaBalance = 100,
) {
  return t.run(async (ctx) => {
    const collId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: count,
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
    await ctx.db.insert("usageQuotas", {
      userId: "user_A",
      features: {
        sentences: {
          balance: quotaBalance,
          included: quotaBalance,
          used: 0,
          unlimited: false,
        },
      },
      lastSyncedAt: Date.now(),
    });
    const textIds: Id<"texts">[] = [];
    for (let i = 1; i <= count; i++) {
      textIds.push(
        await ctx.db.insert("texts", {
          text: `Hola ${i}`,
          language: "es",
          userCreated: false,
          collectionId: collId,
          collectionRank: i,
        }),
      );
    }
    return { collId, courseId, deckId, textIds };
  });
}

/**
 * Stub every host the prepareCardContent fan-out (translation → TTS → STT)
 * can reach, under fake timers, so tests can drain the scheduled chain with
 * `t.finishAllScheduledFunctions(vi.runAllTimers)`. Unknown hosts throw so a
 * test fails loudly if the chain wanders into unmocked territory.
 */
async function withContentChainMocks(fn: () => Promise<void>) {
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
    await fn();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}

function getProgress(
  t: TestConvex<typeof schema>,
  courseId: Id<"courses">,
  collId: Id<"collections">,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("collectionProgress")
      .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
        q
          .eq("userId", "user_A")
          .eq("courseId", courseId)
          .eq("collectionId", collId),
      )
      .unique(),
  );
}

function getDeckCards(t: TestConvex<typeof schema>, deckId: Id<"decks">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("cards")
      .withIndex("by_deckId", (q) => q.eq("deckId", deckId))
      .collect(),
  );
}

describe("collection browse add flows", () => {
  it("drains prioritized marks first (rank order) without advancing the frontier past them", async () => {
    const t = convexTest(schema, modules);
    const { collId, courseId, deckId, textIds } = await seedCourseWithTexts(t, 5);
    const asUser = t.withIdentity({ subject: "user_A" });

    await withContentChainMocks(async () => {
      // Prioritize ranks 4 and 3. The drain must pull them rank-ordered.
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[3],
        mark: "prioritized",
      });
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[2],
        mark: "prioritized",
      });

      const res = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 3,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(res.cardsAdded).toBe(3);
      const cards = await getDeckCards(t, deckId);
      const cardTextIds = new Set(cards.map((c) => c.textId));
      // Both prioritized texts (ranks 3, 4) + the sequential fill (rank 1).
      expect(cardTextIds.has(textIds[2])).toBe(true);
      expect(cardTextIds.has(textIds[3])).toBe(true);
      expect(cardTextIds.has(textIds[0])).toBe(true);

      const progress = await getProgress(t, courseId, collId);
      expect(progress?.cardsAdded).toBe(3);
      expect(progress?.prioritizedCount).toBe(0);
      // Drained adds must NOT move the frontier, only the scan (rank 1) did.
      expect(progress?.lastRankProcessed).toBe(1);
      const marks = await t.run(async (ctx) =>
        ctx.db.query("collectionTextMarks").collect(),
      );
      expect(marks).toEqual([]);

      // Next batch: scan continues 2 → (3,4 already carded, passed) → 5.
      const res2 = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 5,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(res2.cardsAdded).toBe(2);
      const progress2 = await getProgress(t, courseId, collId);
      expect(progress2?.cardsAdded).toBe(5); // never double-counts ranks 3/4
      expect(progress2?.lastRankProcessed).toBe(5);
      expect((await getDeckCards(t, deckId)).length).toBe(5);
    });
  });

  it("skips ignored texts and still completes the collection (added + ignored)", async () => {
    const t = convexTest(schema, modules);
    const { collId, courseId, deckId, textIds } = await seedCourseWithTexts(t, 3);
    const asUser = t.withIdentity({ subject: "user_A" });

    await withContentChainMocks(async () => {
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[0], // rank 1
        mark: "ignored",
      });

      const res = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 5,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(res.cardsAdded).toBe(2); // ranks 2 and 3; rank 1 skipped
      const cards = await getDeckCards(t, deckId);
      expect(cards.map((c) => c.textId)).not.toContain(textIds[0]);

      const progress = await getProgress(t, courseId, collId);
      expect(progress?.cardsAdded).toBe(2);
      expect(progress?.ignoredCount).toBe(1);
      expect(progress?.lastRankProcessed).toBe(3); // frontier passed the ignore

      // added(2) + ignored(1) === textCount(3) → complete for selection.
      await expect(
        asUser.mutation(api.features.decks.setActiveCollection, {
          collectionId: collId,
        }),
      ).rejects.toThrow(/complete/i);
    });
  });

  it("un-ignoring a below-frontier text flips it to 'readd' and the next add drains it (frontier monotonic)", async () => {
    const t = convexTest(schema, modules);
    const { collId, courseId, deckId, textIds } = await seedCourseWithTexts(t, 5);
    const asUser = t.withIdentity({ subject: "user_A" });

    await withContentChainMocks(async () => {
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1], // rank 2
        mark: "ignored",
      });

      // Frontier passes the ignored rank: adds ranks 1 and 3.
      const first = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 2,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(first.cardsAdded).toBe(2);
      let progress = await getProgress(t, courseId, collId);
      expect(progress?.lastRankProcessed).toBe(3);

      // Un-ignore the passed-over text: no frontier rollback, tracked as 'readd'.
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1],
        mark: null,
      });
      progress = await getProgress(t, courseId, collId);
      expect(progress?.lastRankProcessed).toBe(3);
      expect(progress?.ignoredCount).toBe(0);
      const marks = await t.run(async (ctx) =>
        ctx.db.query("collectionTextMarks").collect(),
      );
      expect(marks.map((m) => [m.textId, m.mark])).toEqual([
        [textIds[1], "readd"],
      ]);

      // Next add drains the readd row first, then the scan continues at 4,
      // no rescan of ranks 1-3.
      const second = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 2,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(second.cardsAdded).toBe(2);
      const cardTextIds = new Set((await getDeckCards(t, deckId)).map((c) => c.textId));
      expect(cardTextIds.has(textIds[1])).toBe(true); // the un-ignored text
      expect(cardTextIds.has(textIds[3])).toBe(true); // rank 4 from the scan
      progress = await getProgress(t, courseId, collId);
      expect(progress?.cardsAdded).toBe(4);
      expect(progress?.lastRankProcessed).toBe(4);
      const marksAfter = await t.run(async (ctx) =>
        ctx.db.query("collectionTextMarks").collect(),
      );
      expect(marksAfter).toEqual([]); // drain cleared the readd row
    });
  });

  it("direct-add ahead of the frontier is not re-counted by the later scan", async () => {
    const t = convexTest(schema, modules);
    const { collId, courseId, deckId, textIds } = await seedCourseWithTexts(t, 3);
    const asUser = t.withIdentity({ subject: "user_A" });

    await withContentChainMocks(async () => {
      const single = await asUser.mutation(
        api.features.decks.addSingleTextFromCollection,
        { textId: textIds[1] }, // rank 2, frontier still 0
      );
      expect(single).toEqual({ added: true, alreadyAdded: false });

      let progress = await getProgress(t, courseId, collId);
      expect(progress?.cardsAdded).toBe(1);
      expect(progress?.lastRankProcessed ?? 0).toBe(0); // frontier untouched

      // Re-adding is a no-op.
      const again = await asUser.mutation(
        api.features.decks.addSingleTextFromCollection,
        { textId: textIds[1] },
      );
      expect(again).toEqual({ added: false, alreadyAdded: true });

      const res = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 5,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(res.cardsAdded).toBe(2); // ranks 1 and 3; rank 2 passed silently
      progress = await getProgress(t, courseId, collId);
      expect(progress?.cardsAdded).toBe(3); // exactly the number of cards
      expect((await getDeckCards(t, deckId)).length).toBe(3);
      // deck.cardCount is maintained by `insertCard` across BOTH add paths
      // (single direct-add + batch add), no per-mutation patching left.
      expect(
        (await t.run(async (ctx) => ctx.db.get(deckId)))?.cardCount,
      ).toBe(3);
    });
  });

  it("addSingleTextFromCollection consumes SENTENCES quota and clears marks", async () => {
    const t = convexTest(schema, modules);
    const { collId, courseId, textIds } = await seedCourseWithTexts(t, 2, 1);
    const asUser = t.withIdentity({ subject: "user_A" });

    await withContentChainMocks(async () => {
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[0],
        mark: "prioritized",
      });

      await asUser.mutation(api.features.decks.addSingleTextFromCollection, {
        textId: textIds[0],
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const progress = await getProgress(t, courseId, collId);
      expect(progress?.cardsAdded).toBe(1);
      expect(progress?.prioritizedCount).toBe(0); // mark cleared on add
      const marks = await t.run(async (ctx) =>
        ctx.db.query("collectionTextMarks").collect(),
      );
      expect(marks).toEqual([]);

      // Quota (balance 1) is exhausted. The next premade direct-add throws.
      await expect(
        asUser.mutation(api.features.decks.addSingleTextFromCollection, {
          textId: textIds[1],
        }),
      ).rejects.toThrow();
      expect((await getProgress(t, courseId, collId))?.cardsAdded).toBe(1);
    });
  });

  it("quota-empty batch add reports quotaLimited; a truly drained collection does not", async () => {
    const t = convexTest(schema, modules);
    const { collId, courseId, textIds } = await seedCourseWithTexts(t, 3, 2);
    const asUser = t.withIdentity({ subject: "user_A" });

    await withContentChainMocks(async () => {
      // Balance 2 clamps the batch: 2 cards added, not quota-limited.
      const first = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 5,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(first.cardsAdded).toBe(2);
      expect(first.quotaLimited).toBe(false);

      // Balance 0: Phase 2 is skipped before any scan. The 0-card result
      // must be distinguishable from a drained collection, or clients latch
      // the collection as exhausted and never retry after a refill.
      const second = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 5,
      });
      expect(second.cardsAdded).toBe(0);
      expect(second.scanIncomplete).toBe(false);
      expect(second.quotaLimited).toBe(true);
      // No frontier movement, no quota burned by the skipped phase.
      expect((await getProgress(t, courseId, collId))?.cardsAdded).toBe(2);
      expect(textIds.length).toBe(3);

      // Refill → the remaining text is added; drained follow-up is NOT
      // quota-limited (that 0-card result is the real exhausted signal).
      await t.run(async (ctx) => {
        const quota = await ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .unique();
        await ctx.db.patch(quota!._id, {
          features: {
            sentences: { balance: 10, included: 10, used: 2, unlimited: false },
          },
        });
      });
      const third = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 5,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(third.cardsAdded).toBe(1);
      expect(third.quotaLimited).toBe(false);

      const drained = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 5,
      });
      expect(drained.cardsAdded).toBe(0);
      expect(drained.scanIncomplete).toBe(false);
      expect(drained.quotaLimited).toBe(false);
    });
  });

  it("scan cap: an all-ignored streak returns scanIncomplete with the frontier advanced (no quota burned), and a re-call continues", async () => {
    const t = convexTest(schema, modules);
    // Ranks 1..CAP+5 ignored → the first scan (bounded by ADD_SCAN_CAP)
    // finds nothing addable; the addable texts sit just beyond the streak.
    const ignoredCount = ADD_SCAN_CAP + 5;
    const totalTexts = ADD_SCAN_CAP + 10;
    const { collId, courseId, deckId, textIds } = await seedCourseWithTexts(
      t,
      totalTexts,
    );
    // Chunked mark seeding. One giant transaction would be needlessly slow.
    const CHUNK = 500;
    for (let start = 0; start < ignoredCount; start += CHUNK) {
      const end = Math.min(start + CHUNK, ignoredCount);
      await t.run(async (ctx) => {
        for (let i = start; i < end; i++) {
          await ctx.db.insert("collectionTextMarks", {
            userId: "user_A",
            courseId,
            collectionId: collId,
            textId: textIds[i],
            mark: "ignored",
            collectionRank: i + 1,
          });
        }
      });
    }
    await t.run(async (ctx) => {
      await ctx.db.insert("collectionProgress", {
        userId: "user_A",
        courseId,
        collectionId: collId,
        cardsAdded: 0,
        ignoredCount,
      });
    });
    const asUser = t.withIdentity({ subject: "user_A" });

    await withContentChainMocks(async () => {
      const first = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 2,
      });
      expect(first.cardsAdded).toBe(0);
      expect(first.scanIncomplete).toBe(true);

      let progress = await getProgress(t, courseId, collId);
      expect(progress?.lastRankProcessed).toBe(ADD_SCAN_CAP); // persisted progress
      const quotaAfterFirst = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .unique(),
      );
      expect(quotaAfterFirst?.features.sentences?.used).toBe(0);

      const second = await asUser.mutation(api.features.decks.addCardsFromCollection, {
        collectionId: collId,
        batchSize: 2,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // The re-call resumes past the streak: ranks CAP+6 and CAP+7.
      expect(second.cardsAdded).toBe(2);
      expect(second.scanIncomplete).toBe(false);
      progress = await getProgress(t, courseId, collId);
      expect(progress?.cardsAdded).toBe(2);
      expect(progress?.lastRankProcessed).toBe(ignoredCount + 2);
      expect((await getDeckCards(t, deckId)).length).toBe(2);
    });
  }, 120_000);

  it("storeTranslationAndScheduleTTS with skipTts stores the translation but never claims TTS", async () => {
    const t = convexTest(schema, modules);
    const { textIds } = await seedCourseWithTexts(t, 1);

    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId: textIds[0],
      targetLanguage: "en",
      translatedText: "Hello 1",
      // A bogus voice would throw inside the TTS enqueue path. skipTts must
      // return before the voice is even validated.
      voiceName: "not-a-real-voice",
      skipTts: true,
    });

    const { translations, ttsClaims, audio } = await t.run(async (ctx) => ({
      translations: await ctx.db.query("translations").collect(),
      ttsClaims: await ctx.db.query("ttsGenerationClaims").collect(),
      audio: await ctx.db.query("audioRecordings").collect(),
    }));
    expect(translations).toHaveLength(1);
    expect(translations[0].translatedText).toBe("Hello 1");
    expect(ttsClaims).toEqual([]);
    expect(audio).toEqual([]);
  });
});
