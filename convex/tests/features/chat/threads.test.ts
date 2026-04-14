/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../../schema";
import { api } from "../../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

describe("features/chat/threads", () => {
  describe("listThreads", () => {
    it("returns [] for unauthenticated users without touching the agent component", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.chat.threads.listThreads, {});
      expect(res).toEqual([]);
    });
  });

  describe("getThread", () => {
    it("returns null unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.chat.threads.getThread, {
        threadId: "thread_missing",
      });
      expect(res).toBeNull();
    });
  });

  // STILL SKIPPED: these paths do `ctx.runQuery(components.agent.threads.*)`
  // and `ctx.runMutation(components.agent.threads.updateThread, ...)`. Those
  // function refs are resolved by convex-test's component registry, so a local
  // `vi.mock("@convex-dev/agent", ...)` does not intercept them. Unblocking
  // would need either `t.registerComponent(".../@convex-dev/agent/src/component", ...)`
  // (flagged as fragile in project notes) or a production-side seam that lets
  // us inject a fake threads component. Neither is in scope for this pass.
  it.skip("listThreads: authenticated path via agent component", () => {});
  it.skip("getOrCreateEmptyThread: authenticated path via agent component", () => {});
  it.skip("getThread: authenticated path via agent component", () => {});
});
