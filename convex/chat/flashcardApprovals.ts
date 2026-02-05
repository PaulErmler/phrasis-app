import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { authComponent } from "../auth";
import { Id } from "../_generated/dataModel";
/**
 * Internal mutation to create approval request from tool handler
 * This is called by the agent's createFlashcard tool
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
    // Check if approval already exists for this content (idempotency by content)
    // Use index on threadId and userId, then filter by text and note
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

    if (existing) {
      return existing._id;
    }

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
      throw new ConvexError("Not authenticated");
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new ConvexError("Approval not found");
    }

    if (approval.userId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    if (approval.status !== "pending") {
      throw new ConvexError("Approval already processed");
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
      throw new ConvexError("Not authenticated");
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new ConvexError("Approval not found");
    }

    if (approval.userId !== user._id) {
      throw new ConvexError("Not authorized");
    }

    if (approval.status !== "pending") {
      throw new ConvexError("Approval already processed");
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

    // Use index on messageId for efficient lookup
    const approvals = await ctx.db
      .query("flashcardApprovals")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .filter((q) => q.eq(q.field("userId"), user._id))
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

/**
 * Get approval by toolCallId
 * Used by frontend to find existing approval created by backend
 */
export const getApprovalByToolCallId = query({
  args: {
    toolCallId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("flashcardApprovals"),
      toolCallId: v.string(),
      text: v.string(),
      note: v.string(),
      status: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return null;
    }

    const approval = await ctx.db
      .query("flashcardApprovals")
      .withIndex("by_toolCallId", (q) => q.eq("toolCallId", args.toolCallId))
      .first();

    if (!approval || approval.userId !== user._id) {
      return null;
    }

    return {
      _id: approval._id,
      toolCallId: approval.toolCallId,
      text: approval.text,
      note: approval.note,
      status: approval.status,
    };
  },
});

/**
 * Get all approvals for a thread (efficient batch query)
 * Used by frontend to fetch all approvals at once instead of querying individually
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
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    // Use index on threadId and userId for efficient lookup
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
