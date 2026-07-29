/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

type Origin = "premade" | "custom" | "chat";

type CardSeed = {
  sourceText: string;
  origin?: Origin;
  isMastered?: boolean;
  isHidden?: boolean;
  isFavorite?: boolean;
  lastReviewedAt?: number;
  searchableText?: string;
};

async function seedLibrary(
  t: TestConvex<typeof schema>,
  cardSeeds: CardSeed[],
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
      name: "deck",
      cardCount: cardSeeds.length,
    });
    const textIds = [];
    for (let i = 0; i < cardSeeds.length; i++) {
      const seed = cardSeeds[i];
      const textId = await ctx.db.insert("texts", {
        text: seed.sourceText,
        language: "es",
        userCreated: false,
        collectionId,
        collectionRank: i + 1,
      });
      await ctx.db.insert("cards", {
        deckId,
        textId,
        collectionId,
        collectionOrigin: seed.origin,
        dueDate: 0,
        isMastered: seed.isMastered ?? false,
        isHidden: seed.isHidden ?? false,
        isFavorite: seed.isFavorite,
        lastReviewedAt: seed.lastReviewedAt,
        searchableText: seed.searchableText,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
      textIds.push(textId);
    }
    return { collectionId, courseId, deckId, textIds };
  });
}

// One card per (origin × state) cell, with strictly increasing lastReviewedAt
// in seed order so index/merge descending order is fully determined:
// premade 1-4, custom 5-8, chat 9-12 (plain, mastered, favorite, hidden).
// Every card gets a searchableText containing the shared token "lexeme" —
// convex-test evaluates the search filter against every row in the table, so
// the field must be present on all of them.
function matrixSeeds(): CardSeed[] {
  const origins: readonly Origin[] = ["premade", "custom", "chat"];
  const seeds: CardSeed[] = [];
  let ts = 0;
  for (const origin of origins) {
    for (const state of ["plain", "mastered", "favorite", "hidden"] as const) {
      const sourceText = `${origin}-${state}`;
      seeds.push({
        sourceText,
        origin,
        isMastered: state === "mastered",
        isHidden: state === "hidden",
        isFavorite: state === "favorite" ? true : undefined,
        lastReviewedAt: ++ts,
        searchableText: `${sourceText} lexeme`,
      });
    }
  }
  return seeds;
}

const sourceTexts = (cards: Array<{ sourceText: string }>) =>
  cards.map((c) => c.sourceText);

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
    const { textIds } = await seedLibrary(t, [{ sourceText: "Hola" }]);

    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.query(api.features.library.getLibraryCards, {});
    expect(res).toHaveLength(1);
    expect(res[0].textId).toBe(textIds[0]);
    expect(res[0].sourceText).toBe("Hola");
  });

  it("filter=hidden returns only hidden cards", async () => {
    const t = convexTest(schema, modules);
    await seedLibrary(t, [
      { sourceText: "visible" },
      { sourceText: "hidden", isHidden: true },
    ]);

    const asUser = t.withIdentity({ subject: "user_A" });
    const hiddenOnly = await asUser.query(
      api.features.library.getLibraryCards,
      { activeFilter: "hidden" },
    );
    expect(hiddenOnly).toHaveLength(1);
    expect(hiddenOnly[0].sourceText).toBe("hidden");
  });

  describe("default filter × source", () => {
    it("source undefined returns all non-hidden cards across origins, lastReviewedAt desc", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {});
      expect(sourceTexts(res)).toEqual([
        "chat-favorite",
        "chat-mastered",
        "chat-plain",
        "custom-favorite",
        "custom-mastered",
        "custom-plain",
        "premade-favorite",
        "premade-mastered",
        "premade-plain",
      ]);
    });

    it("source=premade returns only premade non-hidden cards", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        sourceFilter: "premade",
      });
      expect(sourceTexts(res)).toEqual([
        "premade-favorite",
        "premade-mastered",
        "premade-plain",
      ]);
    });

    it("source=custom returns custom+chat non-hidden cards merged desc", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        sourceFilter: "custom",
      });
      expect(sourceTexts(res)).toEqual([
        "chat-favorite",
        "chat-mastered",
        "chat-plain",
        "custom-favorite",
        "custom-mastered",
        "custom-plain",
      ]);
    });

    it("cards without collectionOrigin appear under source undefined only", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, [
        { sourceText: "legacy", lastReviewedAt: 1 },
        { sourceText: "curated", origin: "premade", lastReviewedAt: 2 },
      ]);
      const asUser = t.withIdentity({ subject: "user_A" });

      const all = await asUser.query(api.features.library.getLibraryCards, {});
      expect(sourceTexts(all)).toEqual(["curated", "legacy"]);

      const premade = await asUser.query(api.features.library.getLibraryCards, {
        sourceFilter: "premade",
      });
      expect(sourceTexts(premade)).toEqual(["curated"]);

      const custom = await asUser.query(api.features.library.getLibraryCards, {
        sourceFilter: "custom",
      });
      expect(custom).toEqual([]);
    });
  });

  describe("mastered filter × source", () => {
    it("source undefined returns mastered non-hidden cards across origins", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "mastered",
      });
      expect(sourceTexts(res)).toEqual([
        "chat-mastered",
        "custom-mastered",
        "premade-mastered",
      ]);
    });

    it("source=premade returns only premade mastered cards", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "mastered",
        sourceFilter: "premade",
      });
      expect(sourceTexts(res)).toEqual(["premade-mastered"]);
    });

    it("source=custom returns custom+chat mastered cards merged desc", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "mastered",
        sourceFilter: "custom",
      });
      expect(sourceTexts(res)).toEqual(["chat-mastered", "custom-mastered"]);
    });
  });

  describe("favorites filter × source", () => {
    it("source undefined returns favorited non-hidden cards across origins", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "favorites",
      });
      expect(sourceTexts(res)).toEqual([
        "chat-favorite",
        "custom-favorite",
        "premade-favorite",
      ]);
    });

    it("source=premade returns only premade favorited cards", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "favorites",
        sourceFilter: "premade",
      });
      expect(sourceTexts(res)).toEqual(["premade-favorite"]);
    });

    it("source=custom returns custom+chat favorited cards merged desc", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "favorites",
        sourceFilter: "custom",
      });
      expect(sourceTexts(res)).toEqual(["chat-favorite", "custom-favorite"]);
    });
  });

  describe("hidden filter × source", () => {
    it("source=premade returns only premade hidden cards", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "hidden",
        sourceFilter: "premade",
      });
      expect(sourceTexts(res)).toEqual(["premade-hidden"]);
    });

    it("source=custom returns custom+chat hidden cards merged desc", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        activeFilter: "hidden",
        sourceFilter: "custom",
      });
      expect(sourceTexts(res)).toEqual(["chat-hidden", "custom-hidden"]);
    });
  });

  // convex-test evaluates search indexes as word-prefix matching over the
  // search field and returns matches in insertion order — it does not model
  // relevance ranking. Single-bucket search branches therefore pin membership
  // only (sorted), while the source='custom' branch re-sorts by lastReviewedAt
  // server-side so its order IS asserted.
  describe("search filter × source", () => {
    it("source undefined returns matching non-hidden cards across origins", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        searchQuery: "lexeme",
      });
      expect(sourceTexts(res).sort()).toEqual([
        "chat-favorite",
        "chat-mastered",
        "chat-plain",
        "custom-favorite",
        "custom-mastered",
        "custom-plain",
        "premade-favorite",
        "premade-mastered",
        "premade-plain",
      ]);
    });

    it("source=premade returns only matching premade cards", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        searchQuery: "lexeme",
        sourceFilter: "premade",
      });
      expect(sourceTexts(res).sort()).toEqual([
        "premade-favorite",
        "premade-mastered",
        "premade-plain",
      ]);
    });

    it("source=custom returns matching custom+chat cards re-sorted by lastReviewedAt desc", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        searchQuery: "lexeme",
        sourceFilter: "custom",
      });
      expect(sourceTexts(res)).toEqual([
        "chat-favorite",
        "chat-mastered",
        "chat-plain",
        "custom-favorite",
        "custom-mastered",
        "custom-plain",
      ]);
    });

    it("narrows to cards whose searchableText matches the query", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        searchQuery: "premade-mastered",
      });
      expect(sourceTexts(res)).toEqual(["premade-mastered"]);
    });

    it("combines with activeFilter=mastered", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        searchQuery: "lexeme",
        activeFilter: "mastered",
      });
      expect(sourceTexts(res).sort()).toEqual([
        "chat-mastered",
        "custom-mastered",
        "premade-mastered",
      ]);
    });

    it("combines with activeFilter=hidden", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, matrixSeeds());
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        searchQuery: "lexeme",
        activeFilter: "hidden",
      });
      expect(sourceTexts(res).sort()).toEqual([
        "chat-hidden",
        "custom-hidden",
        "premade-hidden",
      ]);
    });
  });

  describe("mergeByLastReviewedDesc (via source=custom)", () => {
    it("interleaves custom and chat buckets strictly descending; missing lastReviewedAt sorts last", async () => {
      const t = convexTest(schema, modules);
      await seedLibrary(t, [
        { sourceText: "custom-10", origin: "custom", lastReviewedAt: 10 },
        { sourceText: "custom-30", origin: "custom", lastReviewedAt: 30 },
        { sourceText: "custom-50", origin: "custom", lastReviewedAt: 50 },
        { sourceText: "chat-20", origin: "chat", lastReviewedAt: 20 },
        { sourceText: "chat-40", origin: "chat", lastReviewedAt: 40 },
        { sourceText: "chat-60", origin: "chat", lastReviewedAt: 60 },
        { sourceText: "custom-none", origin: "custom" },
      ]);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        sourceFilter: "custom",
      });
      expect(sourceTexts(res)).toEqual([
        "chat-60",
        "custom-50",
        "chat-40",
        "custom-30",
        "chat-20",
        "custom-10",
        "custom-none",
      ]);
    });

    it("truncates to LIBRARY_LIMIT after merging, not per bucket", async () => {
      // 70 custom cards (even lastReviewedAt 0..138) + 70 chat cards (odd
      // 1..139). Each bucket is under the per-bucket take(100), so a correct
      // post-merge slice keeps the global top 100 (139 down to 40) — a
      // per-bucket truncation or an unsliced concat would return a different
      // set/length.
      const seeds: CardSeed[] = [];
      for (let i = 0; i < 70; i++) {
        seeds.push({
          sourceText: `custom-${2 * i}`,
          origin: "custom",
          lastReviewedAt: 2 * i,
        });
        seeds.push({
          sourceText: `chat-${2 * i + 1}`,
          origin: "chat",
          lastReviewedAt: 2 * i + 1,
        });
      }
      const t = convexTest(schema, modules);
      await seedLibrary(t, seeds);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.library.getLibraryCards, {
        sourceFilter: "custom",
      });
      expect(res).toHaveLength(100);
      expect(res.map((c) => c.lastReviewedAt)).toEqual(
        Array.from({ length: 100 }, (_, i) => 139 - i),
      );
      expect(res[0].sourceText).toBe("chat-139");
      expect(res[1].sourceText).toBe("custom-138");
      expect(res[99].sourceText).toBe("custom-40");
    });
  });
});
