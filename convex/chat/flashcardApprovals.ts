import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { authComponent } from "../auth";
import { Id } from "../_generated/dataModel";
/**
 * Create a pending flashcard approval request
 */
export const createApprovalRequest = mutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    text: v.string(),
    note: v.string(),
  },
  returns: v.id("flashcardApprovals"),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const approvalId = await ctx.db.insert("flashcardApprovals", {
      threadId: args.threadId,
      messageId: args.messageId,
      toolCallId: args.toolCallId,
      text: args.text,
      note: args.note,
      userId: user._id,
      status: "pending",
      createdAt: Date.now(),
    });

    return approvalId;
  },
});

/**
 * Approve a flashcard and create it
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
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error("Approval not found");
    }

    if (approval.userId !== user._id) {
      throw new Error("Not authorized");
    }

    if (approval.status !== "pending") {
      throw new Error("Approval already processed");
    }

    // Create the flashcard
    const flashcardId: Id<"testFlashcards"> = await ctx.runMutation(
      internal.chat.flashcards.createFlashcardInternal,
      {
        text: approval.text,
        note: approval.note,
        userId: approval.userId,
      }
    );

    // Update approval status
    await ctx.db.patch(args.approvalId, {
      status: "approved",
      processedAt: Date.now(),
    });

    return { success: true, flashcardId };
  },
});

/**
 * Reject a flashcard creation
 */
export const rejectFlashcard = mutation({
  args: {
    approvalId: v.id("flashcardApprovals"),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error("Approval not found");
    }

    if (approval.userId !== user._id) {
      throw new Error("Not authorized");
    }

    if (approval.status !== "pending") {
      throw new Error("Approval already processed");
    }

    // Update approval status
    await ctx.db.patch(args.approvalId, {
      status: "rejected",
      processedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get pending approvals for a message
 */
export const getPendingApprovals = query({
  args: {
    messageId: v.string(),
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
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    const approvals = await ctx.db
      .query("flashcardApprovals")
      .filter((q) =>
        q.and(
          q.eq(q.field("messageId"), args.messageId),
          q.eq(q.field("userId"), user._id)
        )
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



