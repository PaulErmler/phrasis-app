/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../../schema";
import { api, internal } from "../../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

async function seedCourse(t: ReturnType<typeof convexTest>) {
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
    return { courseId };
  });
}

describe("features/chat/cardApprovals", () => {
  describe("createApprovalRequestInternal", () => {
    it("rejects empty translations", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await expect(
        t.mutation(
          internal.features.chat.cardApprovals.createApprovalRequestInternal,
          {
            threadId: "thread_1",
            messageId: "m1",
            toolCallId: "tc1",
            translations: [],
            userId: "user_A",
          },
        ),
      ).rejects.toThrow();
    });

    it("rejects translations with missing course language", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await expect(
        t.mutation(
          internal.features.chat.cardApprovals.createApprovalRequestInternal,
          {
            threadId: "thread_1",
            messageId: "m1",
            toolCallId: "tc1",
            translations: [{ language: "es", text: "Hola" }], // missing "en"
            userId: "user_A",
          },
        ),
      ).rejects.toThrow();
    });

    it("creates an approval when all course languages are provided", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      const approvalId = await t.mutation(
        internal.features.chat.cardApprovals.createApprovalRequestInternal,
        {
          threadId: "thread_1",
          messageId: "m1",
          toolCallId: "tc1",
          translations: [
            { language: "en", text: "Hello" },
            { language: "es", text: "Hola" },
          ],
          userId: "user_A",
        },
      );
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe("pending");
    });
  });

  describe("rejectCard", () => {
    it("rejects unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert("cardApprovals", {
          threadId: "thread_1",
          messageId: "m1",
          toolCallId: "tc1",
          translations: [{ language: "en", text: "x" }],
          userId: "user_A",
          status: "pending",
        }),
      );
      await expect(
        t.mutation(api.features.chat.cardApprovals.rejectCard, {
          approvalId,
        }),
      ).rejects.toThrow();
    });

    it("marks a pending approval as rejected", async () => {
      const t = convexTest(schema, modules);
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert("cardApprovals", {
          threadId: "thread_1",
          messageId: "m1",
          toolCallId: "tc1",
          translations: [{ language: "en", text: "x" }],
          userId: "user_A",
          status: "pending",
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.rejectCard,
        { approvalId },
      );
      expect(res.success).toBe(true);
      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe("rejected");
      expect(approval?.processedAt).toBeTypeOf("number");
    });

    it("rejects another user's approval", async () => {
      const t = convexTest(schema, modules);
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert("cardApprovals", {
          threadId: "thread_1",
          messageId: "m1",
          toolCallId: "tc1",
          translations: [{ language: "en", text: "x" }],
          userId: "user_B",
          status: "pending",
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      await expect(
        asUser.mutation(api.features.chat.cardApprovals.rejectCard, {
          approvalId,
        }),
      ).rejects.toThrow();
    });
  });

  describe("getApprovalsByThread", () => {
    it("returns [] unauthenticated", async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(
        api.features.chat.cardApprovals.getApprovalsByThread,
        { threadId: "thread_x" },
      );
      expect(res).toEqual([]);
    });

    it("returns approvals for the authenticated user only", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert("cardApprovals", {
          threadId: "thread_1",
          messageId: "m1",
          toolCallId: "tc-A",
          translations: [{ language: "en", text: "a" }],
          userId: "user_A",
          status: "pending",
        });
        await ctx.db.insert("cardApprovals", {
          threadId: "thread_1",
          messageId: "m2",
          toolCallId: "tc-B",
          translations: [{ language: "en", text: "b" }],
          userId: "user_B",
          status: "pending",
        });
      });
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.query(
        api.features.chat.cardApprovals.getApprovalsByThread,
        { threadId: "thread_1" },
      );
      expect(res).toHaveLength(1);
      expect(res[0].toolCallId).toBe("tc-A");
    });
  });

  describe("approveCard", () => {
    it("happy path: consumes quota, inserts text + translations, flips approval to approved", async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      // Seed quota for CUSTOM_SENTENCES.
      await t.run(async (ctx) => {
        await ctx.db.insert("usageQuotas", {
          userId: "user_A",
          features: {
            custom_sentences: {
              balance: 5,
              included: 5,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
      });
      const approvalId = await t.run(async (ctx) =>
        ctx.db.insert("cardApprovals", {
          threadId: "thread_1",
          messageId: "m1",
          toolCallId: "tc1",
          translations: [
            { language: "en", text: "Hello" },
            { language: "es", text: "Hola" },
          ],
          userId: "user_A",
          status: "pending",
        }),
      );
      const asUser = t.withIdentity({ subject: "user_A" });
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      expect(res.success).toBe(true);
      expect(res.textId).toBeDefined();

      const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
      expect(approval?.status).toBe("approved");
      expect(approval?.textId).toBe(res.textId);

      const text = await t.run(async (ctx) => ctx.db.get(res.textId!));
      // First translation ("en") becomes the main text; others land in translations.
      expect(text?.text).toBe("Hello");
      expect(text?.language).toBe("en");
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query("translations")
          .withIndex("by_textId", (q) => q.eq("textId", res.textId!))
          .collect(),
      );
      expect(translations.map((tr) => tr.targetLanguage)).toEqual(["es"]);

      const quota = await t.run(async (ctx) =>
        ctx.db
          .query("usageQuotas")
          .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
          .first(),
      );
      expect(quota?.features.custom_sentences.balance).toBe(4);
    });
  });
});
