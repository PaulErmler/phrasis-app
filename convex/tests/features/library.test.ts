/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildCardSearchableText } from "../../lib/cardContent";
import { augmentSearchQuery } from "../../features/library";

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
// Every card gets a searchableText containing the shared token "lexeme".
// Convex-test evaluates the search filter against every row in the table, so
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
  // search field and returns matches in insertion order. It does not model
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
      // post-merge slice keeps the global top 100 (139 down to 40), a
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

// The CJK fix has two halves: `buildCardSearchableText` appends
// Intl.Segmenter word tokens to the indexed string, and `getLibraryCards`
// appends them to the query. convex-test models Convex's real behavior
// closely enough to exercise both: the document side is split on whitespace
// only (an unsegmented CJK sentence stays one un-matchable word) and query
// terms are OR'd with prefix matching.
describe("CJK search (no-word-boundary languages)", () => {
  async function seedZhCourse(t: TestConvex<typeof schema>) {
    return t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        name: "A1",
        textCount: 0,
      });
      const courseId = await ctx.db.insert("courses", {
        userId: "user_A",
        baseLanguages: ["en"],
        targetLanguages: ["zh"],
      });
      await ctx.db.insert("userSettings", {
        userId: "user_A",
        hasCompletedOnboarding: true,
        activeCourseId: courseId,
      });
      const deckId = await ctx.db.insert("decks", {
        courseId,
        name: "deck",
        cardCount: 1,
      });
      const textId = await ctx.db.insert("texts", {
        text: "你真的体贴",
        language: "zh",
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      const translationId = await ctx.db.insert("translations", {
        textId,
        targetLanguage: "en",
        translatedText: "You are really considerate",
        romanizedText: "ni zhende titie",
      });
      const cardId = await ctx.db.insert("cards", {
        deckId,
        textId,
        collectionId,
        collectionOrigin: "premade",
        dueDate: 0,
        isMastered: false,
        isHidden: false,
        schedulingPhase: "preReview",
        preReviewCount: 0,
      });
      return { courseId, deckId, textId, translationId, cardId };
    });
  }

  async function buildSearchableTextFor(
    t: TestConvex<typeof schema>,
    cardId: Id<"cards">,
  ) {
    // Stamp the card with the real index-side builder so the test covers the
    // exact string production writes.
    await t.run(async (ctx) => {
      const card = (await ctx.db.get(cardId))!;
      const deck = (await ctx.db.get(card.deckId))!;
      const course = (await ctx.db.get(deck.courseId))!;
      const built = await buildCardSearchableText(
        ctx,
        card.textId,
        (await ctx.db.get(card.textId))!.text,
        [...course.baseLanguages, ...course.targetLanguages],
      );
      await ctx.db.patch(cardId, built);
    });
  }

  it("finds a word in the middle of an unspaced Chinese sentence", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedZhCourse(t);
    await buildSearchableTextFor(t, cardId);
    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.query(api.features.library.getLibraryCards, {
      searchQuery: "体贴",
    });
    expect(res.map((c) => c.sourceText)).toEqual(["你真的体贴"]);
  });

  it("finds a query spanning segment boundaries via query-side segmentation", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedZhCourse(t);
    await buildSearchableTextFor(t, cardId);
    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.query(api.features.library.getLibraryCards, {
      searchQuery: "真的体贴",
    });
    expect(res.map((c) => c.sourceText)).toEqual(["你真的体贴"]);
  });

  it("still matches via romanization and translation text", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedZhCourse(t);
    await buildSearchableTextFor(t, cardId);
    const asUser = t.withIdentity({ subject: "user_A" });
    for (const searchQuery of ["zhende", "considerate"]) {
      const res = await asUser.query(api.features.library.getLibraryCards, {
        searchQuery,
      });
      expect(res.map((c) => c.sourceText)).toEqual(["你真的体贴"]);
    }
  });

  it("matches a punctuated query and search does not throw", async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedZhCourse(t);
    await buildSearchableTextFor(t, cardId);
    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.query(api.features.library.getLibraryCards, {
      searchQuery: "你真的体贴。",
    });
    expect(res.map((c) => c.sourceText)).toEqual(["你真的体贴"]);
  });

  describe("augmentSearchQuery: 16-term budget", () => {
    // Convex tokenizes the query on punctuation as well as whitespace, so the
    // budget must count terms the same way, exceeding 16 terms makes the
    // real search index throw instead of returning results.
    //
    // Enumerates the SEPARATORS rather than the keepers, on purpose: this
    // oracle used to be a verbatim copy of the production regex, which made
    // every assertion below tautological and let a combining-mark bug ship
    // that shredded Hindi/Thai/Hebrew queries. See searchQueryScripts.test.ts.
    const termCount = (q: string) =>
      q.split(/[\s\p{P}\p{S}]+/u).filter(Boolean).length;

    it("stays within 16 terms for a long punctuated Japanese query", () => {
      const query = "私は日本語を勉強しています、友達と毎日話します。";
      const augmented = augmentSearchQuery(query, ["en", "ja"]);
      expect(termCount(augmented)).toBeLessThanOrEqual(16);
      // Still actually augmented. Segments were appended.
      expect(termCount(augmented)).toBeGreaterThan(termCount(query));
    });

    it("stays within 16 terms for a multi-clause Chinese paste", () => {
      const query =
        "你好，我叫小明。我喜欢学习语言，也喜欢旅行。你呢，你喜欢什么？";
      const augmented = augmentSearchQuery(query, ["en", "zh"]);
      expect(termCount(augmented)).toBeLessThanOrEqual(16);
    });

    it("returns space-delimited queries unchanged", () => {
      expect(augmentSearchQuery("hello world", ["en", "es"])).toBe(
        "hello world",
      );
    });

    it("truncates a base query that itself exceeds 16 terms", () => {
      // The regression this exists for: the budget only capped the APPENDED
      // segments. A pasted 20-word sentence sailed through unchanged and
      // made the search throw instead of returning partial results.
      const twentyWords = Array.from({ length: 20 }, (_, i) => `word${i}`).join(
        " ",
      );
      const augmented = augmentSearchQuery(twentyWords, ["en", "es"]);
      expect(termCount(augmented)).toBeLessThanOrEqual(16);
      // The kept terms are the first 16, in order.
      expect(augmented.split(" ")[0]).toBe("word0");
      expect(augmented.split(" ")).toHaveLength(16);
    });

    it("truncates an over-cap CJK paste after counting Convex-style terms", () => {
      const longMixed =
        "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen 你真的体贴";
      const augmented = augmentSearchQuery(longMixed, ["en", "zh"]);
      expect(termCount(augmented)).toBeLessThanOrEqual(16);
    });
  });

  it("does not match a card whose searchableText was never segmented (pre-migration state)", async () => {
    // Documents the failure mode the migration exists to fix: the raw
    // sentence is one whitespace-token, so the mid-sentence word can only
    // match after the rebuild.
    const t = convexTest(schema, modules);
    const { cardId } = await seedZhCourse(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(cardId, {
        searchableText: "你真的体贴 You are really considerate",
        searchableTextLanguages: ["en"],
      });
    });
    const asUser = t.withIdentity({ subject: "user_A" });
    const res = await asUser.query(api.features.library.getLibraryCards, {
      searchQuery: "体贴",
    });
    expect(res).toEqual([]);
  });
});
