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
      });
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
      expect(res.streams.kind).toBe("list");
      expect(Array.isArray(res.streams.messages)).toBe(true);
      expect(res.streams.messages).toHaveLength(0);
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
  it.skip("generateResponse: LLM path", () => {});
  it.skip("generateThreadTitle: LLM path", () => {});
});
