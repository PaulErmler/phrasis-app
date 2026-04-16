/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";

// Stub the aggregate component — production code instantiates
// `new TableAggregate(components.cardsByState, ...)` at module-load.
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
      vi.stubEnv("ELEVENLABS_API_KEY", "dummy");

      const translateBody = JSON.stringify({
        data: { translations: [{ translatedText: "translated" }] },
      });
      const scribeBody = JSON.stringify({
        text: "translated",
        words: [{ text: "translated", start: 0, end: 0.5, type: "word" }],
      });
      const elevenTtsBytes = new Uint8Array([0, 1, 2, 3]);
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
        if (u.includes("api.elevenlabs.io/v1/speech-to-text")) {
          return new Response(scribeBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("api.elevenlabs.io/v1/text-to-speech")) {
          return new Response(elevenTtsBytes, {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
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
});
