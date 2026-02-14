import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUser, requireAuthUser } from "../../db/users";
import { Id } from "../../_generated/dataModel";

/**
 * Internal mutation to create approval request from tool handler.
 */
export const createApprovalRequestInternal = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    text: v.string(),
    note: v.string(),
    userId: v.string(),
  },
  returns: v.id("flashcardApprovals"),
  handler: async (ctx, args) => {
    // Idempotency check by content within same thread/user
    const existing = await ctx.db
      .query("flashcardApprovals")
      .withIndex("by_thread_and_user", (q) =>
        q.eq("threadId", args.threadId).eq("userId", args.userId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("text"), args.text),
          q.eq(q.field("note"), args.note)
        )
      )
      .first();

    if (existing) return existing._id;

    const approvalId = await ctx.db.insert("flashcardApprovals", {
      threadId: args.threadId,
      messageId: args.messageId,
      toolCallId: args.toolCallId,
      text: args.text,
      note: args.note,
      userId: args.userId,
      status: "pending",
      createdAt: Date.now(),
    });

    return approvalId;
  },
});

/**
 * Approve a flashcard and create it.
 */
export const approveFlashcard = mutation({
  args: {
    approvalId: v.id("flashcardApprovals"),
  },
  returns: v.object({
    success: v.boolean(),
    flashcardId: v.optional(v.id("testFlashcards")),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new ConvexError("Approval not found");
    if (approval.userId !== user._id) throw new ConvexError("Not authorized");
    if (approval.status !== "pending") throw new ConvexError("Approval already processed");

    const flashcardId: Id<"testFlashcards"> = await ctx.runMutation(
      internal.features.chat.flashcards.createFlashcardInternal,
      {
        text: approval.text,
        note: approval.note,
        userId: approval.userId,
      }
    );

    await ctx.db.patch(args.approvalId, {
      status: "approved",
      processedAt: Date.now(),
    });

    return { success: true, flashcardId };
  },
});

/**
 * Reject a flashcard creation.
 */
export const rejectFlashcard = mutation({
  args: {
    approvalId: v.id("flashcardApprovals"),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) throw new ConvexError("Approval not found");
    if (approval.userId !== user._id) throw new ConvexError("Not authorized");
    if (approval.status !== "pending") throw new ConvexError("Approval already processed");

    await ctx.db.patch(args.approvalId, {
      status: "rejected",
      processedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get all approvals for a thread (efficient batch query).
 */
export const getApprovalsByThread = query({
  args: {
    threadId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("flashcardApprovals"),
      toolCallId: v.string(),
      text: v.string(),
      note: v.string(),
      status: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const approvals = await ctx.db
      .query("flashcardApprovals")
      .withIndex("by_thread_and_user", (q) =>
        q.eq("threadId", args.threadId).eq("userId", user._id)
      )
      .collect();

    return approvals.map((a) => ({
      _id: a._id,
      toolCallId: a.toolCallId,
      text: a.text,
      note: a.note,
      status: a.status,
    }));
  },
});

