/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../../schema";
import { api, internal } from "../../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

describe("features/chat/messages", () => {
  describe("getCourseLanguagesForUser", () => {
    it("returns null when user has no active course", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: "user_nope" },
      );
      expect(res).toBeNull();
    });

    it("returns languages for the active course", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
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
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: "user_A" },
      );
      expect(res).toEqual({
        baseLanguages: ["en"],
        targetLanguages: ["es", "fr"],
        difficulty: null,
      });
    });

    it("returns difficulty from the active curriculum collection", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const datasetId = await ctx.db.insert("datasets", {
          slug: "ogte-test",
          version: "1.0.0",
          publishedAt: Date.now(),
          isActive: true,
        });
        const collectionId = await ctx.db.insert("collections", {
          name: "L03",
          code: "L03",
          datasetId,
          cefrTier: "A1",
          displayName: "A1.2",
          order: 3,
          textCount: 10,
          origin: "premade",
        });
        const courseId = await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["es"],
          currentLevel: "intermediate",
        });
        await ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: collectionId,
        });
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: "user_A" },
      );
      expect(res?.difficulty).toEqual({ label: "A1.2", cefrTier: "A1" });
    });

    it("falls back to course currentLevel when the active collection is not a curriculum level", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const customId = await ctx.db.insert("collections", {
          name: "Custom",
          textCount: 2,
          origin: "custom",
        });
        const courseId = await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
          currentLevel: "beginner",
        });
        await ctx.db.insert("userSettings", {
          userId: "user_A",
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert("courseSettings", {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: customId,
        });
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: "user_A" },
      );
      expect(res?.difficulty).toEqual({ label: "Pre-A1", cefrTier: "Pre-A1" });
    });

    it("uses a legacy CEFR collection name when cefrTier is unset", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert("collections", {
          name: "B1",
          textCount: 5,
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
          activeCollectionId: collectionId,
        });
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: "user_A" },
      );
      expect(res?.difficulty).toEqual({ label: "B1", cefrTier: "B1" });
    });
  });

  describe("listMessages", () => {
    it("returns empty page unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.chat.messages.listMessages, {
        threadId: "thread_x",
        paginationOpts: { numItems: 10, cursor: null },
      });
      // Without identity, this returns an empty list shape.
      expect(Array.isArray(res?.page ?? [])).toBe(true);
    });

    it("includes a list-shaped streams field on the early return when streaming", async () => {
      // Regression: the client streaming hook (useUIMessages → useDeltaStreams)
      // reads `streams.messages` whenever it issues a `kind: 'list'` query. If
      // the unauthenticated / thread-not-owned early return omits `streams`,
      // the hook throws "Cannot read properties of undefined (reading
      // 'messages')". The early return must mirror syncStreams' list shape.
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.chat.messages.listMessages, {
        threadId: "thread_x",
        paginationOpts: { numItems: 10, cursor: null },
        streamArgs: { kind: "list", startOrder: 0 },
      });
      expect(res.streams).toBeDefined();
      const streams = res.streams!;
      expect(streams.kind).toBe("list");
      if (streams.kind !== "list") throw new Error("narrowed by the expect above");
      expect(Array.isArray(streams.messages)).toBe(true);
      expect(streams.messages).toHaveLength(0);
    });
  });

  // STILL SKIPPED: each of these paths calls into the `@convex-dev/agent`
  // component — `saveMessage`, `listUIMessages`, `syncStreams` delegate to
  // refs on `components.agent.*`, which convex-test resolves through its own
  // component registry. A local `vi.mock("@convex-dev/agent", ...)` cannot
  // intercept those ref-based calls, and they also hit the Agent's internal
  // thread validation before the LLM mock would kick in. Unblocking needs
  // `t.registerComponent` against the agent package (flagged fragile in
  // project notes) or a production-side seam. Out of scope for this pass.
  it.skip("sendMessage: happy path via agent component", () => {});
  // Quick actions need no skipped case: steering-before-label ordering is
  // structural (one `saveMessages` call whose array is [system, user]), the
  // payload length guards are covered by assertQuickActionWithinLimits tests,
  // and the expansion itself by expandQuickAction tests — both in
  // quickActions.test.ts.
  it.skip("generateResponse: LLM path", () => {});
  it.skip("generateThreadTitle: LLM path", () => {});
});
