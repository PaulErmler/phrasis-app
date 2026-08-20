/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";

// File-level aggregate mock (takes precedence over the zero-count stub in
// tests/convexTestSetup.ts. See the precedent in
// migrations/recalcUserCardAggregates.test.ts). `count()` records its args and
// returns the value registered for the namespace's tail, defaulting to 0 so
// tests that don't register counts behave like the global stub. Lookup tries
// the two-segment tail first (`origin:state`, for the filter-aware
// cardsByOriginStateAndDueDate namespaces `${deckId}:${origin}:${state}`),
// then the last segment (`state`, for `${deckId}:${state}`).
const countsByStateSuffix: Record<string, number> = {};
const countCalls: Array<{
  namespace: string;
  /** Which scheduling track's aggregate instance served this count. */
  track: "shared" | "writing";
  bounds?: { upper?: { key: number; inclusive: boolean } };
}> = [];

vi.mock("@convex-dev/aggregate", () => {
  class TableAggregate {
    private readonly track: "shared" | "writing";

    constructor(
      _component: unknown,
      opts?: { sortKey?: (doc: unknown) => unknown },
    ) {
      // Label the instance by which due date its sortKey reads. The only
      // structural difference between a writing-track aggregate and its
      // shared twin (their NAMESPACE strings are identical, so namespace
      // alone can't tell the separate-mode tests which aggregate was hit).
      let probed: unknown;
      try {
        probed = opts?.sortKey?.({
          dueDate: "shared",
          writingDueDate: "writing",
        });
      } catch {
        probed = undefined;
      }
      this.track = probed === "writing" ? "writing" : "shared";
    }

    async insertIfDoesNotExist(): Promise<void> {}
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async count(
      _ctx: unknown,
      opts: {
        namespace: string;
        bounds?: { upper?: { key: number; inclusive: boolean } };
      },
    ): Promise<number> {
      countCalls.push({
        namespace: opts.namespace,
        track: this.track,
        bounds: opts.bounds,
      });
      const parts = opts.namespace.split(":");
      const tail2 = parts.slice(-2).join(":");
      const tail1 = parts[parts.length - 1] ?? "";
      return countsByStateSuffix[tail2] ?? countsByStateSuffix[tail1] ?? 0;
    }
  }
  return { TableAggregate };
});

import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

beforeEach(() => {
  countCalls.length = 0;
  for (const key of Object.keys(countsByStateSuffix)) {
    delete countsByStateSuffix[key];
  }
});

async function seedActiveCourse(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
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
    return { courseId, deckId };
  });
}

describe("features/stats", () => {
  describe("getRecentWords", () => {
    it("returns [] unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getRecentWords, {});
      expect(res).toEqual([]);
    });

    it("returns recent words for target language", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "Hola",
        });
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "mundo",
          displayWord: "mundo",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getRecentWords, {});
      expect(res).toHaveLength(1);
      expect(res[0].language).toBe("es");
      expect(res[0].words.sort()).toEqual(["Hola", "mundo"]);
    });
  });

  describe("getRecentWordsForLanguage", () => {
    it("rejects a non-target language", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.stats.getRecentWordsForLanguage,
        { language: "fr" },
      );
      expect(res).toEqual([]);
    });
  });

  describe("searchWords", () => {
    it("returns [] on empty query", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.searchWords, {
        searchQuery: "   ",
      });
      expect(res).toEqual([]);
    });
  });

  describe("getSentencesForWord", () => {
    it("returns empty page for unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getSentencesForWord, {
        word: "hola",
        language: "es",
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(res.page).toEqual([]);
      expect(res.isDone).toBe(true);
    });
  });

  describe("getCardCounts", () => {
    it("returns null when unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getCardCounts, {});
      expect(res).toBeNull();
    });

    it("returns null when there is no active course", async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getCardCounts, {});
      expect(res).toBeNull();
    });

    it("returns the four-state shape (new, learning, relearning, review)", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getCardCounts, {});
      // Aggregate is mocked → all zero, but the shape must include relearning
      // separately so the progress display can color it independently.
      expect(res).toEqual({ new: 0, learning: 0, relearning: 0, review: 0 });
    });
  });

  describe("getCardCounts: aggregate namespace mapping", () => {
    it("maps each `${deckId}:state` namespace count to its matching return field", async () => {
      const t = convexTest(schema, modules);
      const { deckId } = await seedActiveCourse(t);
      Object.assign(countsByStateSuffix, {
        new: 1,
        learning: 2,
        review: 3,
        relearning: 4,
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getCardCounts, {});

      // Distinct per-namespace counts: transposing any two namespaces (or the
      // Promise.all destructure) flips the corresponding fields.
      expect(res).toEqual({ new: 1, learning: 2, review: 3, relearning: 4 });
      expect(countCalls.map((c) => c.namespace).sort()).toEqual(
        [
          `${deckId}:learning`,
          `${deckId}:new`,
          `${deckId}:relearning`,
          `${deckId}:review`,
        ].sort(),
      );
    });

    it("passes the now-inclusive due-date upper bound to every state count", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      const before = Date.now();
      await asUser.query(api.features.stats.getCardCounts, {});
      const after = Date.now();

      expect(countCalls).toHaveLength(4);
      const firstKey = countCalls[0].bounds?.upper?.key;
      for (const call of countCalls) {
        expect(call.bounds?.upper?.inclusive).toBe(true);
        // All four counts share one `now` snapshot taken inside the handler.
        expect(call.bounds?.upper?.key).toBe(firstKey);
        expect(call.bounds?.upper?.key).toBeGreaterThanOrEqual(before);
        expect(call.bounds?.upper?.key).toBeLessThanOrEqual(after);
      }
    });

    it("uses a client-supplied `now` verbatim as the due-date bound", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });

      const NOW = 1_754_000_000_000;
      await asUser.query(api.features.stats.getCardCounts, { now: NOW });

      expect(countCalls).toHaveLength(4);
      for (const call of countCalls) {
        expect(call.bounds?.upper?.key).toBe(NOW);
      }
    });
  });

  describe("getFilteredCardCounts", () => {
    const NOW = 1_754_000_000_000;

    it("returns null when unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.stats.getFilteredCardCounts, {
        now: NOW,
      });
      expect(res).toBeNull();
    });

    it("'both' (and omitted filter) counts the unsplit `${deckId}:state` namespaces", async () => {
      const t = convexTest(schema, modules);
      const { deckId } = await seedActiveCourse(t);
      Object.assign(countsByStateSuffix, {
        new: 1,
        learning: 2,
        review: 3,
        relearning: 4,
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
      });
      expect(res).toEqual({ new: 1, learning: 2, review: 3, relearning: 4 });
      expect(countCalls.map((c) => c.namespace).sort()).toEqual(
        [
          `${deckId}:learning`,
          `${deckId}:new`,
          `${deckId}:relearning`,
          `${deckId}:review`,
        ].sort(),
      );

      countCalls.length = 0;
      const resDefault = await asUser.query(
        api.features.stats.getFilteredCardCounts,
        { now: NOW },
      );
      expect(resDefault).toEqual(res);
      expect(countCalls).toHaveLength(4);
    });

    it("'course' counts only the premade origin namespaces", async () => {
      const t = convexTest(schema, modules);
      const { deckId } = await seedActiveCourse(t);
      Object.assign(countsByStateSuffix, {
        // Unsplit namespaces. Must NOT be used by the filtered path.
        new: 100,
        learning: 100,
        review: 100,
        relearning: 100,
        "premade:new": 5,
        "premade:learning": 6,
        "premade:review": 7,
        "premade:relearning": 8,
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "course",
        now: NOW,
      });
      expect(res).toEqual({ new: 5, learning: 6, review: 7, relearning: 8 });
      expect(countCalls.map((c) => c.namespace).sort()).toEqual(
        [
          `${deckId}:premade:learning`,
          `${deckId}:premade:new`,
          `${deckId}:premade:relearning`,
          `${deckId}:premade:review`,
        ].sort(),
      );
    });

    it("'custom' sums the custom and chat origin namespaces", async () => {
      const t = convexTest(schema, modules);
      const { deckId } = await seedActiveCourse(t);
      Object.assign(countsByStateSuffix, {
        "custom:new": 1,
        "chat:new": 2,
        "custom:learning": 3,
        "chat:learning": 4,
        "custom:review": 5,
        "chat:review": 6,
        "custom:relearning": 7,
        "chat:relearning": 8,
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "custom",
        now: NOW,
      });
      expect(res).toEqual({ new: 3, learning: 7, review: 11, relearning: 15 });
      const namespaces = countCalls.map((c) => c.namespace);
      expect(namespaces).toHaveLength(8);
      expect(namespaces).toContain(`${deckId}:custom:new`);
      expect(namespaces).toContain(`${deckId}:chat:new`);
      // Legacy cards without a resolved origin are 'both'-only by design.
      expect(namespaces.some((n) => n.includes(":none:"))).toBe(false);
      expect(namespaces.some((n) => n.includes(":premade:"))).toBe(false);
    });

    it("uses the client-supplied `now` (not the wall clock) as the inclusive due bound", async () => {
      const t = convexTest(schema, modules);
      await seedActiveCourse(t);
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "custom",
        now: NOW,
      });
      expect(countCalls.length).toBeGreaterThan(0);
      for (const call of countCalls) {
        expect(call.bounds?.upper?.key).toBe(NOW);
        expect(call.bounds?.upper?.inclusive).toBe(true);
      }
    });
  });

  describe("due counts: separate mode tracking (writing track)", () => {
    const NOW = 1_754_000_000_000;

    async function seedWithSettings(
      t: TestConvex<typeof schema>,
      settings: Record<string, unknown>,
    ) {
      const ids = await seedActiveCourse(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("courseSettings", {
          courseId: ids.courseId,
          initialReviewCount: 5,
          ...settings,
        });
      });
      return ids;
    }

    it("Writing mode on a split course counts the WRITING aggregates", async () => {
      const t = convexTest(schema, modules);
      await seedWithSettings(t, {
        separateModeTracking: true,
        reviewMode: "full",
        writingSeedDone: true,
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
      });
      // Seed finished → settled counts, no provisional flag.
      expect(res).toEqual({ new: 0, learning: 0, relearning: 0, review: 0 });
      expect(countCalls).toHaveLength(4);
      for (const call of countCalls) {
        expect(call.track).toBe("writing");
      }
    });

    it("audio mode on a split course (and Writing with the split off) stays on the SHARED aggregates", async () => {
      const t = convexTest(schema, modules);
      await seedWithSettings(t, {
        separateModeTracking: true,
        reviewMode: "audio",
        writingSeedDone: true,
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
      });
      expect(countCalls).toHaveLength(4);
      for (const call of countCalls) {
        expect(call.track).toBe("shared");
      }

      // Split off: Writing mode still counts the shared track.
      const t2 = convexTest(schema, modules);
      countCalls.length = 0;
      await seedWithSettings(t2, { reviewMode: "full" });
      const asUser2 = t2.withIdentity({ subject: "user_A" });
      await asUser2.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
      });
      expect(countCalls).toHaveLength(4);
      for (const call of countCalls) {
        expect(call.track).toBe("shared");
      }
    });

    it("the client's optimistic reviewMode override wins over settings (both directions)", async () => {
      const t = convexTest(schema, modules);
      await seedWithSettings(t, {
        separateModeTracking: true,
        reviewMode: "audio",
        writingSeedDone: true,
      });
      const asUser = t.withIdentity({ subject: "user_A" });

      await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
        reviewMode: "full",
      });
      expect(countCalls.map((c) => c.track)).toEqual(
        Array(4).fill("writing"),
      );

      countCalls.length = 0;
      await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
        reviewMode: "audio",
      });
      expect(countCalls.map((c) => c.track)).toEqual(Array(4).fill("shared"));
    });

    it("the origin-filtered path also selects the writing aggregates", async () => {
      const t = convexTest(schema, modules);
      const { deckId } = await seedWithSettings(t, {
        separateModeTracking: true,
        reviewMode: "full",
        writingSeedDone: true,
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "custom",
        now: NOW,
      });
      expect(countCalls).toHaveLength(8);
      for (const call of countCalls) {
        expect(call.track).toBe("writing");
      }
      expect(countCalls.map((c) => c.namespace)).toContain(
        `${deckId}:custom:new`,
      );
    });

    it("flags preparingWriting while the seed is unfinished, writing track only", async () => {
      const t = convexTest(schema, modules);
      await seedWithSettings(t, {
        separateModeTracking: true,
        reviewMode: "full",
        // writingSeedDone deliberately absent: the enable-time sweep hasn't
        // finished, so the writing aggregates hold only a partial prefix.
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
      });
      expect(res).toEqual({
        new: 0,
        learning: 0,
        relearning: 0,
        review: 0,
        preparingWriting: true,
      });

      // The shared track's counts are always settled, no flag, even with the
      // seed unfinished on the same course.
      const shared = await asUser.query(
        api.features.stats.getFilteredCardCounts,
        { filter: "both", now: NOW, reviewMode: "audio" },
      );
      expect(shared).toEqual({ new: 0, learning: 0, relearning: 0, review: 0 });
    });

    it("free play (radio + Writing) never flags preparingWriting, it serves the rotation, not the writing queue", async () => {
      const t = convexTest(schema, modules);
      await seedWithSettings(t, {
        separateModeTracking: true,
        reviewMode: "full",
        schedulingMode: "radio",
        // writingSeedDone deliberately absent. The seed is still running,
        // but free play never reads the writing queue, so its counts must
        // not be greyed out as provisional.
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getFilteredCardCounts, {
        filter: "both",
        now: NOW,
      });
      expect(res).toEqual({ new: 0, learning: 0, relearning: 0, review: 0 });
    });

    it("getCardCounts derives the track from settings and flags the unfinished seed too", async () => {
      const t = convexTest(schema, modules);
      await seedWithSettings(t, {
        separateModeTracking: true,
        reviewMode: "full",
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(api.features.stats.getCardCounts, {
        now: NOW,
      });
      expect(res).toEqual({
        new: 0,
        learning: 0,
        relearning: 0,
        review: 0,
        preparingWriting: true,
      });
      expect(countCalls).toHaveLength(4);
      for (const call of countCalls) {
        expect(call.track).toBe("writing");
      }
    });
  });

  describe("getNewWordsForCelebration", () => {
    it("buckets rows by sessionId match: matching → session, different or missing → today", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await t.run(async (ctx) => {
        // Matching sessionId → session bucket
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "hola",
          sessionId: "session-current",
        });
        // Different sessionId → today bucket (earlier session today)
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "adios",
          displayWord: "adios",
          sessionId: "session-earlier",
        });
        // No sessionId field → today bucket. Strict semantics: an orphaned
        // row stays orphaned so a regression that re-introduces missing
        // sessionIds is visible on the celebration screen, not masked.
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "gracias",
          displayWord: "gracias",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.stats.getNewWordsForCelebration,
        { sessionId: "session-current", timezone: "UTC" },
      );

      expect(res.session.map((w) => w.display)).toEqual(["hola"]);
      expect(res.today.map((w) => w.display).sort()).toEqual([
        "adios",
        "gracias",
      ]);
    });

    it("dedupes by (language, word) and promotes today → session when a session row exists for the same word", async () => {
      const t = convexTest(schema, modules);
      const { courseId } = await seedActiveCourse(t);
      await t.run(async (ctx) => {
        // Two rows for the same (language, word), different sessionIds.
        // The session row must win regardless of insertion order.
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "hola",
          sessionId: "session-earlier",
        });
        await ctx.db.insert("userWords", {
          userId: "user_A",
          courseId,
          language: "es",
          word: "hola",
          displayWord: "hola",
          sessionId: "session-current",
        });
      });

      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.stats.getNewWordsForCelebration,
        { sessionId: "session-current", timezone: "UTC" },
      );

      expect(res.session.map((w) => w.display)).toEqual(["hola"]);
      expect(res.today).toEqual([]);
    });
  });
});
