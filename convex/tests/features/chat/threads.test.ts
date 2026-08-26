/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
// The real agent component, run in-process: the package's official test
// helper registers its source modules + schema with convex-test, so
// `ctx.runQuery(components.agent.threads.*)` executes the actual component
// functions instead of needing a module-level mock (which could never
// intercept ref-based component calls anyway).
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import schema from "../../../schema";
import { api, components } from "../../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerAgentComponent(t);
  return t;
}

/**
 * Flip a thread's status directly on the agent component, standing in for
 * what sendMessage does on the first message (archived → active).
 */
async function setThreadStatus(
  t: TestConvex<typeof schema>,
  threadId: string,
  status: "active" | "archived",
) {
  await t.run(async (ctx) => {
    await ctx.runMutation(components.agent.threads.updateThread, {
      threadId,
      patch: { status },
    });
  });
}

describe("features/chat/threads", () => {
  describe("listThreads", () => {
    it("returns [] for unauthenticated users without touching the agent component", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.chat.threads.listThreads, {});
      expect(res).toEqual([]);
    });

    it("lists only the current user's active threads", async () => {
      const t = setup();
      const asA = t.withIdentity({ subject: "user_A" });
      const asB = t.withIdentity({ subject: "user_B" });

      // A's first thread, activated (as sendMessage would on first message).
      const activeThread = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      await setThreadStatus(t, activeThread, "active");
      // A's second thread stays archived (empty, hidden).
      const emptyThread = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      // B's thread, active, must not leak into A's list.
      const bThread = await asB.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      await setThreadStatus(t, bThread, "active");

      const res = await asA.query(api.features.chat.threads.listThreads, {});
      expect(res.map((th) => th._id)).toEqual([activeThread]);
      expect(res[0].status).toBe("active");
      expect(res[0].userId).toBe("user_A");
      expect(res.map((th) => th._id)).not.toContain(emptyThread);
    });
  });

  describe("getOrCreateEmptyThread", () => {
    it("throws unauthenticated", async () => {
      const t = setup();
      await expect(
        t.mutation(api.features.chat.threads.getOrCreateEmptyThread, {}),
      ).rejects.toThrow("Unauthenticated");
    });

    it("creates a hidden (archived) 'New Chat' thread that listThreads does not show", async () => {
      const t = setup();
      const asA = t.withIdentity({ subject: "user_A" });
      const threadId = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      const thread = await asA.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread).toMatchObject({
        _id: threadId,
        userId: "user_A",
        title: "New Chat",
        status: "archived",
      });
      // Hidden until the first message flips it to active.
      expect(
        await asA.query(api.features.chat.threads.listThreads, {}),
      ).toEqual([]);
    });

    it("reuses the existing empty thread instead of creating a second one", async () => {
      const t = setup();
      const asA = t.withIdentity({ subject: "user_A" });
      const first = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      const second = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      expect(second).toBe(first);
    });

    it("creates a fresh thread once the empty one has been activated", async () => {
      const t = setup();
      const asA = t.withIdentity({ subject: "user_A" });
      const first = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      await setThreadStatus(t, first, "active");
      const second = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      expect(second).not.toBe(first);
    });

    it("never reuses another user's empty thread", async () => {
      const t = setup();
      const aThread = await t
        .withIdentity({ subject: "user_A" })
        .mutation(api.features.chat.threads.getOrCreateEmptyThread, {});
      const bThread = await t
        .withIdentity({ subject: "user_B" })
        .mutation(api.features.chat.threads.getOrCreateEmptyThread, {});
      expect(bThread).not.toBe(aThread);
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

    it("returns the caller's own thread", async () => {
      const t = setup();
      const asA = t.withIdentity({ subject: "user_A" });
      const threadId = await asA.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      const thread = await asA.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread?._id).toBe(threadId);
      expect(thread?.userId).toBe("user_A");
    });

    it("returns null for a thread owned by another user", async () => {
      const t = setup();
      const aThread = await t
        .withIdentity({ subject: "user_A" })
        .mutation(api.features.chat.threads.getOrCreateEmptyThread, {});
      const res = await t
        .withIdentity({ subject: "user_B" })
        .query(api.features.chat.threads.getThread, { threadId: aThread });
      expect(res).toBeNull();
    });
  });
});
