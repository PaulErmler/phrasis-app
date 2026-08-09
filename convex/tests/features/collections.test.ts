/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { MARK_READ_LIMIT } from "../../db/collectionTextMarks";
import type { Id } from "../../_generated/dataModel";
// Mocked globally in tests/convexTestSetup.ts — imported here to assert on
// the enqueue boundary (the pools never run jobs under convex-test).
import { llmPool, ttsPool } from "../../lib/workpools";
import { USER_PROVIDED_TRANSLATION_SOURCE } from "../../../lib/languages";

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob("/convex/**/*.ts");

// Tests here schedule content work on 0ms timers - drain it inside the test
// context so its logs don't race vitest teardown.
drainSchedulerAfterEach();

const firstPage = { numItems: 25, cursor: null };

/** Level collection + active course for user_A, with `count` es texts. */
async function seedCourseWithTexts(
  t: TestConvex<typeof schema>,
  count: number,
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
 * Per-user CUSTOM collection for user_A (registered in courseSettings), with
 * `count` owned texts plus one FOREIGN text (user_B) sharing the collection —
 * which must never surface for user_A.
 */
async function seedCustomCollection(
  t: TestConvex<typeof schema>,
  count: number,
) {
  return t.run(async (ctx) => {
    const collId = await ctx.db.insert("collections", {
      name: "Custom",
      textCount: count,
      origin: "custom",
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
      customCollectionId: collId,
      activeCustomCollectionIds: [collId],
    });
    const deckId = await ctx.db.insert("decks", {
      courseId,
      name: "d",
      cardCount: 0,
    });
    const textIds: Id<"texts">[] = [];
    for (let i = 1; i <= count; i++) {
      textIds.push(
        await ctx.db.insert("texts", {
          text: `Mi frase ${i}`,
          language: "es",
          userCreated: true,
          userId: "user_A",
          collectionId: collId,
          collectionRank: i,
        }),
      );
    }
    const foreignTextId = await ctx.db.insert("texts", {
      text: "Ajeno",
      language: "es",
      userCreated: true,
      userId: "user_B",
      collectionId: collId,
      collectionRank: count + 1,
    });
    return { collId, courseId, deckId, textIds, foreignTextId };
  });
}

function insertCardFor(
  t: TestConvex<typeof schema>,
  deckId: Id<"decks">,
  collId: Id<"collections">,
  textId: Id<"texts">,
) {
  return t.run(async (ctx) => {
    await ctx.db.insert("cards", {
      deckId,
      textId,
      collectionId: collId,
      dueDate: Date.now(),
      isMastered: false,
      isHidden: false,
      schedulingPhase: "preReview",
      preReviewCount: 0,
    });
  });
}

describe("features/collections", () => {
  describe("browseCollectionTexts", () => {
    it("returns an empty page for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const collId = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "A1", textCount: 0 }),
      );
      const res = await t.query(api.features.collections.browseCollectionTexts, {
        collectionId: collId,
        anchorRank: 0,
        direction: "after",
        paginationOpts: firstPage,
      });
      expect(res.page).toEqual([]);
      expect(res.isDone).toBe(true);
    });

    it("returns an empty page when the collection is inaccessible", async () => {
      const t = convexTest(schema, modules);
      await seedCourseWithTexts(t, 0);
      const randomColl = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "random-xyz", textCount: 0 }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: randomColl,
          anchorRank: 0,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      expect(res.page).toEqual([]);
    });

    it("lists texts in rank order with status + missingTranslationLanguages", async () => {
      const t = convexTest(schema, modules);
      const { collId } = await seedCourseWithTexts(t, 3);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 0,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      expect(res.page.map((r) => r.collectionRank)).toEqual([1, 2, 3]);
      expect(res.page.every((r) => r.status === "none")).toBe(true);
      // No en translation exists → flagged for the client's generation batch.
      expect(res.page[0].missingTranslationLanguages).toEqual(["en"]);
      expect(res.page[0].sourceLanguage).toBe("es");
    });

    it("clamps the page size to 25", async () => {
      const t = convexTest(schema, modules);
      const { collId } = await seedCourseWithTexts(t, 30);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 0,
          direction: "after",
          paginationOpts: { numItems: 100, cursor: null },
        },
      );
      expect(res.page.length).toBeLessThanOrEqual(25);
      expect(res.isDone).toBe(false);
    });

    it("includes added rows in the stream with status 'added' (visibility is a client concern)", async () => {
      const t = convexTest(schema, modules);
      const { collId, deckId, textIds } = await seedCourseWithTexts(t, 3);
      // Direct-add rank 2 ahead of the anchor (anchor stays 0).
      await insertCardFor(t, deckId, collId, textIds[1]);

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 0,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      // The row is NOT filtered out — a just-added sentence stays in the list
      // (the client flips it green in place).
      expect(res.page.map((r) => [r.collectionRank, r.status])).toEqual([
        [1, "none"],
        [2, "added"],
        [3, "none"],
      ]);
    });

    it("injects marked texts at/below the anchor on the first page of the after stream", async () => {
      const t = convexTest(schema, modules);
      const { collId, courseId, textIds } = await seedCourseWithTexts(t, 4);
      // The frontier passed ranks 1-3; rank 1 was ignored, rank 3 prioritized
      // via an ignored→prioritized flip after the scan passed it.
      await t.run(async (ctx) => {
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: collId,
          cardsAdded: 1,
          lastRankProcessed: 3,
          ignoredCount: 1,
          prioritizedCount: 1,
        });
        await ctx.db.insert("collectionTextMarks", {
          userId: "user_A",
          courseId,
          collectionId: collId,
          textId: textIds[0],
          mark: "ignored",
          collectionRank: 1,
        });
        await ctx.db.insert("collectionTextMarks", {
          userId: "user_A",
          courseId,
          collectionId: collId,
          textId: textIds[2],
          mark: "prioritized",
          collectionRank: 3,
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 3,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      // Injected marks (ranks 1, 3) come first in rank order, then the
      // past-anchor stream (rank 4).
      expect(res.page.map((r) => [r.collectionRank, r.status])).toEqual([
        [1, "ignored"],
        [3, "prioritized"],
        [4, "none"],
      ]);
    });

    it("caps the below-anchor mark injection at MARK_READ_LIMIT rows", async () => {
      const t = convexTest(schema, modules);
      const total = MARK_READ_LIMIT + 20;
      const { collId, courseId, textIds } = await seedCourseWithTexts(t, total);
      // Every text below the anchor is ignored — an unbounded injection would
      // return all of them (and, at real scale, blow the query's read limit).
      await t.run(async (ctx) => {
        await ctx.db.insert("collectionProgress", {
          userId: "user_A",
          courseId,
          collectionId: collId,
          cardsAdded: 0,
          lastRankProcessed: total,
          ignoredCount: total,
        });
        for (let i = 0; i < total; i++) {
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

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: total,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      // Lowest ranks win; the rest stay reachable via the upTo feed.
      expect(res.page.length).toBe(MARK_READ_LIMIT);
      expect(res.page[0].collectionRank).toBe(1);
      expect(res.page.every((r) => r.status === "ignored")).toBe(true);
      // 1000+ rows through the convex-test interpreter hovers around the 5s
      // default timeout (same reason the scan-cap test raises it).
    }, 120_000);

    it("pages the added history DESCENDING from the anchor with direction upTo", async () => {
      const t = convexTest(schema, modules);
      const { collId, deckId, textIds } = await seedCourseWithTexts(t, 4);
      await insertCardFor(t, deckId, collId, textIds[0]);
      await insertCardFor(t, deckId, collId, textIds[1]);
      await insertCardFor(t, deckId, collId, textIds[2]);

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 3,
          direction: "upTo",
          paginationOpts: { numItems: 2, cursor: null },
        },
      );
      // Newest-first so scrolling up reveals progressively older sentences.
      expect(res.page.map((r) => [r.collectionRank, r.status])).toEqual([
        [3, "added"],
        [2, "added"],
      ]);
      expect(res.isDone).toBe(false);

      const nextPage = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 3,
          direction: "upTo",
          paginationOpts: { numItems: 2, cursor: res.continueCursor },
        },
      );
      expect(nextPage.page.map((r) => r.collectionRank)).toEqual([1]);
      expect(nextPage.isDone).toBe(true);
    });
  });

  describe("setCollectionTextMark", () => {
    it("sets, switches, and clears marks while keeping counters in sync", async () => {
      const t = convexTest(schema, modules);
      const { collId, courseId, textIds } = await seedCourseWithTexts(t, 3);
      const asUser = t.withIdentity({ subject: "user_A" });

      const getProgress = () =>
        t.run(async (ctx) =>
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

      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[0],
        mark: "prioritized",
      });
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1],
        mark: "ignored",
      });
      let progress = await getProgress();
      expect(progress?.prioritizedCount).toBe(1);
      expect(progress?.ignoredCount).toBe(1);

      // prioritized → ignored moves the counter across.
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[0],
        mark: "ignored",
      });
      progress = await getProgress();
      expect(progress?.prioritizedCount).toBe(0);
      expect(progress?.ignoredCount).toBe(2);

      // Clearing removes the row + decrements.
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[0],
        mark: null,
      });
      progress = await getProgress();
      expect(progress?.ignoredCount).toBe(1);
      const marks = await t.run(async (ctx) =>
        ctx.db.query("collectionTextMarks").collect(),
      );
      expect(marks).toHaveLength(1);
      expect(marks[0].textId).toBe(textIds[1]);
    });

    it("flips a below-frontier mark to 'readd' on clear — frontier untouched, counters decremented", async () => {
      const t = convexTest(schema, modules);
      const { collId, courseId, textIds } = await seedCourseWithTexts(t, 3);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1], // rank 2
        mark: "ignored",
      });
      // Simulate the sequential scan having passed rank 3.
      await t.run(async (ctx) => {
        const progress = await ctx.db
          .query("collectionProgress")
          .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
            q
              .eq("userId", "user_A")
              .eq("courseId", courseId)
              .eq("collectionId", collId),
          )
          .unique();
        await ctx.db.patch(progress!._id, { lastRankProcessed: 3 });
      });

      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1],
        mark: null,
      });

      const progress = await t.run(async (ctx) =>
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
      // The frontier stays monotonic (no rescan of the added stretch, no
      // browseAnchor regression); the text stays tracked via 'readd'.
      expect(progress?.lastRankProcessed).toBe(3);
      expect(progress?.ignoredCount).toBe(0);
      const marks = await t.run(async (ctx) =>
        ctx.db.query("collectionTextMarks").collect(),
      );
      expect(marks).toHaveLength(1);
      expect(marks[0].textId).toBe(textIds[1]);
      expect(marks[0].mark).toBe("readd");

      // A 'readd' row renders as an unmarked ('none') text in the browse view
      // and is injected below the anchor like any other mark.
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 3,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      const row = res.page.find((r) => r._id === textIds[1]);
      expect(row?.status).toBe("none");

      // Clearing again is a no-op (the row must survive for the drain)...
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1],
        mark: null,
      });
      // ...and re-marking flips the row back with correct counters.
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1],
        mark: "prioritized",
      });
      const after = await t.run(async (ctx) => ({
        marks: await ctx.db.query("collectionTextMarks").collect(),
        progress: await ctx.db
          .query("collectionProgress")
          .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
            q
              .eq("userId", "user_A")
              .eq("courseId", courseId)
              .eq("collectionId", collId),
          )
          .unique(),
      }));
      expect(after.marks).toHaveLength(1);
      expect(after.marks[0].mark).toBe("prioritized");
      expect(after.progress?.prioritizedCount).toBe(1);
      expect(after.progress?.ignoredCount).toBe(0);
    });

    it("deletes the mark on clear when the frontier has not passed it", async () => {
      const t = convexTest(schema, modules);
      const { textIds } = await seedCourseWithTexts(t, 3);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1], // rank 2, frontier at 0
        mark: "ignored",
      });
      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[1],
        mark: null,
      });
      const marks = await t.run(async (ctx) =>
        ctx.db.query("collectionTextMarks").collect(),
      );
      // Above the frontier the sequential scan reaches the text naturally —
      // no tracking row needed.
      expect(marks).toHaveLength(0);
    });

    it("rejects marking a text that is already a card", async () => {
      const t = convexTest(schema, modules);
      const { collId, deckId, textIds } = await seedCourseWithTexts(t, 1);
      await insertCardFor(t, deckId, collId, textIds[0]);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.collections.setCollectionTextMark, {
          textId: textIds[0],
          mark: "ignored",
        }),
      ).rejects.toThrow();
    });

    it("rejects unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const { textIds } = await seedCourseWithTexts(t, 1);
      await expect(
        t.mutation(api.features.collections.setCollectionTextMark, {
          textId: textIds[0],
          mark: "ignored",
        }),
      ).rejects.toThrow();
    });
  });

  describe("requestPreviewTranslations (skipTts)", () => {
    it("enqueues translation jobs with skipTts and never touches the TTS pool", async () => {
      const t = convexTest(schema, modules);
      const { collId, textIds } = await seedCourseWithTexts(t, 2);
      // The workpools are mocked globally (tests/convexTestSetup.ts) — the
      // enqueue boundary is what we assert on.
      vi.mocked(llmPool.enqueueAction).mockClear();
      vi.mocked(ttsPool.enqueueAction).mockClear();

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.requestPreviewTranslations,
        { collectionId: collId, textIds },
      );
      // One missing language (en) per text.
      expect(res.translationsScheduled).toBe(2);

      const llmCalls = vi.mocked(llmPool.enqueueAction).mock.calls;
      expect(llmCalls).toHaveLength(2);
      for (const call of llmCalls) {
        const jobArgs = call[2] as { targetLanguage: string; skipTts?: boolean };
        expect(jobArgs.targetLanguage).toBe("en");
        expect(jobArgs.skipTts).toBe(true);
      }
      expect(vi.mocked(ttsPool.enqueueAction)).not.toHaveBeenCalled();

      // Re-requesting while the jobs are in flight is a claim-deduped no-op
      // for openrouter languages; either way it must not touch audio.
      const { audio, ttsClaims } = await t.run(async (ctx) => ({
        audio: await ctx.db.query("audioRecordings").collect(),
        ttsClaims: await ctx.db.query("ttsGenerationClaims").collect(),
      }));
      expect(audio).toEqual([]);
      expect(ttsClaims).toEqual([]);
    });

    it("regenerates version-stale translations while browsing (marked missing, then deleted + rescheduled)", async () => {
      const t = convexTest(schema, modules);
      const { collId } = await seedCourseWithTexts(t, 1);
      // An en curriculum text whose es translation is stamped below the
      // language's current translationVersion (es is at 2 since the
      // 3.5flash bump), plus paired audio synthesized from the old wording,
      // plus a user-provided sibling row that must never be swept.
      const { enTextId, userTextId } = await t.run(async (ctx) => {
        const enTextId = await ctx.db.insert("texts", {
          text: "Hello there",
          language: "en",
          userCreated: false,
          collectionId: collId,
          collectionRank: 2,
        });
        await ctx.db.insert("translations", {
          textId: enTextId,
          targetLanguage: "es",
          translatedText: "Hola viejo",
          translationVersion: 1,
        });
        await insertAudioFixture(ctx, {
          textId: enTextId,
          language: "es",
          voiceName: "es-ES-test-voice",
          storageId: await ctx.storage.store(new Blob(["fake-mp3"])),
        });
        const userTextId = await ctx.db.insert("texts", {
          text: "Hello again",
          language: "en",
          userCreated: false,
          collectionId: collId,
          collectionRank: 3,
        });
        await ctx.db.insert("translations", {
          textId: userTextId,
          targetLanguage: "es",
          translatedText: "Hola de nuevo",
          translationVersion: 1,
          translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
        });
        return { enTextId, userTextId };
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      // Browse reports the stale language as missing (while still shipping
      // the old text for display) so the client requests regeneration.
      const browsed = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 0,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      const staleRow = browsed.page.find((r) => r._id === enTextId)!;
      expect(staleRow.missingTranslationLanguages).toContain("es");
      expect(
        staleRow.translations.find((tr) => tr.language === "es")?.text,
      ).toBe("Hola viejo");
      // User-provided rows are exempt.
      const userRow = browsed.page.find((r) => r._id === userTextId)!;
      expect(userRow.missingTranslationLanguages).not.toContain("es");

      // The preview mutation deletes the stale row + its paired audio and
      // reschedules the translation.
      const res = await asUser.mutation(
        api.features.collections.requestPreviewTranslations,
        { collectionId: collId, textIds: [enTextId, userTextId] },
      );
      expect(res.translationsScheduled).toBe(1);
      const { translations, audio } = await t.run(async (ctx) => ({
        translations: await ctx.db.query("translations").collect(),
        audio: await ctx.db.query("audioRecordings").collect(),
      }));
      expect(
        translations.filter((tr) => tr.textId === enTextId),
      ).toEqual([]);
      expect(audio.filter((a) => a.textId === enTextId)).toEqual([]);
      // The user-provided sibling survived untouched.
      expect(
        translations.find((tr) => tr.textId === userTextId)?.translatedText,
      ).toBe("Hola de nuevo");

      // Re-requesting while the regen claim is in flight is a no-op — the
      // row is gone but the LLM claim gates a duplicate enqueue.
      const again = await asUser.mutation(
        api.features.collections.requestPreviewTranslations,
        { collectionId: collId, textIds: [enTextId] },
      );
      expect(again.translationsScheduled).toBe(0);
    });

    it("is a no-op for texts outside the given collection", async () => {
      const t = convexTest(schema, modules);
      const { textIds } = await seedCourseWithTexts(t, 1);
      const otherColl = await t.run(async (ctx) =>
        ctx.db.insert("collections", { name: "A2", textCount: 0 }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.requestPreviewTranslations,
        { collectionId: otherColl, textIds },
      );
      expect(res.translationsScheduled).toBe(0);
    });
  });

  describe("custom collections", () => {
    it("browses only the owner's texts (foreign texts in the same collection never surface)", async () => {
      const t = convexTest(schema, modules);
      const { collId, textIds, foreignTextId } = await seedCustomCollection(t, 2);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.collections.browseCollectionTexts,
        {
          collectionId: collId,
          anchorRank: 0,
          direction: "after",
          paginationOpts: firstPage,
        },
      );
      expect(res.page.map((r) => r._id)).toEqual(textIds);
      expect(res.page.map((r) => r._id)).not.toContain(foreignTextId);
    });

    it("supports marks + counters on own texts, rejects marking a foreign text", async () => {
      const t = convexTest(schema, modules);
      const { collId, courseId, textIds, foreignTextId } =
        await seedCustomCollection(t, 2);
      const asUser = t.withIdentity({ subject: "user_A" });

      await asUser.mutation(api.features.collections.setCollectionTextMark, {
        textId: textIds[0],
        mark: "prioritized",
      });
      const progress = await t.run(async (ctx) =>
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
      expect(progress?.prioritizedCount).toBe(1);

      await expect(
        asUser.mutation(api.features.collections.setCollectionTextMark, {
          textId: foreignTextId,
          mark: "prioritized",
        }),
      ).rejects.toThrow();
    });
  });

  describe("prewarmPreviewTranslations", () => {
    it("schedules skipTts translations for the next texts after the given rank", async () => {
      const t = convexTest(schema, modules);
      const { collId } = await seedCourseWithTexts(t, 4);
      vi.mocked(llmPool.enqueueAction).mockClear();
      vi.mocked(ttsPool.enqueueAction).mockClear();

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.prewarmPreviewTranslations,
        { collectionId: collId, afterRank: 1 },
      );
      // Texts at ranks 2-4, each missing its en translation.
      expect(res.translationsScheduled).toBe(3);

      const llmCalls = vi.mocked(llmPool.enqueueAction).mock.calls;
      expect(llmCalls).toHaveLength(3);
      for (const call of llmCalls) {
        const jobArgs = call[2] as { targetLanguage: string; skipTts?: boolean };
        expect(jobArgs.targetLanguage).toBe("en");
        expect(jobArgs.skipTts).toBe(true);
      }
      // Prewarming must never touch audio.
      expect(vi.mocked(ttsPool.enqueueAction)).not.toHaveBeenCalled();
    });

    it("skips foreign texts (user forks in premade collections stay other users' content)", async () => {
      const t = convexTest(schema, modules);
      const { collId, textIds } = await seedCourseWithTexts(t, 1);
      // Another user's fork living inside the shared premade collection.
      const forkTextId = await t.run(async (ctx) =>
        ctx.db.insert("texts", {
          text: "Forked",
          language: "es",
          userCreated: true,
          userId: "user_B",
          collectionId: collId,
          collectionRank: 99,
        }),
      );
      vi.mocked(llmPool.enqueueAction).mockClear();

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.requestPreviewTranslations,
        { collectionId: collId, textIds: [textIds[0], forkTextId] },
      );
      // Only the curriculum text is scheduled; the fork is skipped.
      expect(res.translationsScheduled).toBe(1);
      expect(vi.mocked(llmPool.enqueueAction)).toHaveBeenCalledTimes(1);
    });

    it("skips texts whose translations already exist", async () => {
      const t = convexTest(schema, modules);
      const { collId, textIds } = await seedCourseWithTexts(t, 2);
      await t.run(async (ctx) => {
        await ctx.db.insert("translations", {
          textId: textIds[1],
          targetLanguage: "en",
          translatedText: "Hello 2",
        });
      });
      vi.mocked(llmPool.enqueueAction).mockClear();

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.prewarmPreviewTranslations,
        { collectionId: collId, afterRank: 0 },
      );
      // Only the text without a stored translation gets a job.
      expect(res.translationsScheduled).toBe(1);
      expect(vi.mocked(llmPool.enqueueAction)).toHaveBeenCalledTimes(1);
    });
  });

  describe("requestPreviewAudio", () => {
    it("claims + enqueues TTS for the source language on click, deduping the second click", async () => {
      const t = convexTest(schema, modules);
      const { textIds } = await seedCourseWithTexts(t, 1);
      vi.mocked(ttsPool.enqueueAction).mockClear();

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.requestPreviewAudio,
        { textId: textIds[0], language: "es" },
      );
      expect(res.scheduled).toBe(true);

      // The claim is held by the enqueued job; a second click is a no-op.
      const again = await asUser.mutation(
        api.features.collections.requestPreviewAudio,
        { textId: textIds[0], language: "es" },
      );
      expect(again.scheduled).toBe(false);

      const claims = await t.run(async (ctx) =>
        ctx.db.query("ttsGenerationClaims").collect(),
      );
      expect(claims).toHaveLength(1);
      expect(claims[0].language).toBe("es");

      const ttsCalls = vi.mocked(ttsPool.enqueueAction).mock.calls;
      expect(ttsCalls).toHaveLength(1);
      const jobArgs = ttsCalls[0][2] as { language: string; text: string };
      expect(jobArgs.language).toBe("es");
      expect(jobArgs.text).toBe("Hola 1"); // source text, no translation involved
    });

    it("does not schedule when the translation has not landed yet", async () => {
      const t = convexTest(schema, modules);
      const { textIds } = await seedCourseWithTexts(t, 1);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.requestPreviewAudio,
        { textId: textIds[0], language: "en" },
      );
      expect(res.scheduled).toBe(false);
      const claims = await t.run(async (ctx) =>
        ctx.db.query("ttsGenerationClaims").collect(),
      );
      expect(claims).toEqual([]);
    });

    it("rejects another user's text", async () => {
      const t = convexTest(schema, modules);
      const { foreignTextId } = await seedCustomCollection(t, 1);
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.collections.requestPreviewAudio, {
          textId: foreignTextId,
          language: "es",
        }),
      ).rejects.toThrow();
    });

    it("no-ops when audio already exists", async () => {
      const t = convexTest(schema, modules);
      const { textIds } = await seedCourseWithTexts(t, 1);
      await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array([1, 2, 3])]),
        );
        await insertAudioFixture(ctx, {
          textId: textIds[0],
          language: "es",
          voiceName: "es-test-voice",
          storageId,
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.collections.requestPreviewAudio,
        { textId: textIds[0], language: "es" },
      );
      expect(res.scheduled).toBe(false);
    });
  });
});
