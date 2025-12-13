import { v } from "convex/values";
import { internalAction, mutation, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { internal } from "../_generated/api";
import { saveMessage } from "@convex-dev/agent";
import { listUIMessages, syncStreams } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { authComponent } from "../auth";
import { agent } from "./agent";
import { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";

export type ListMessagesStreamArgs = {
  kind: "list";
  includeStatuses?: ("streaming" | "finished" | "aborted")[];
};


const agentComponent = components.agent;

/**
 * Send a user message and trigger async AI response generation
 */
export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    // Verify thread ownership
    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== user._id) {
      throw new Error("Thread not found or access denied");
    }

    // Save the user message
    const { messageId } = await saveMessage(ctx, agentComponent, {
      threadId: args.threadId,
      prompt: args.prompt,
    });

    // Schedule async response generation
    await ctx.scheduler.runAfter(0, internal.chat.messages.generateResponse, {
      threadId: args.threadId,
      promptMessageId: messageId,
    });

    return messageId;
  },
});

/**
 * List messages for a thread in UI-friendly format
 */
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    // Stream args are permissive here to align with @convex-dev/agent validators
    streamArgs: v.optional(v.any()),
  },
  // UIMessage includes provider-specific fields; accept any to avoid blocking streaming
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    streams: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    // Verify thread ownership
    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== user._id) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    // Get UI messages
    const messages = await listUIMessages(ctx, agentComponent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts
    });

    const streams = await syncStreams(ctx, agentComponent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });

    return { ...messages, streams };
  },
});

/**
 * Generate AI response to a user message (internal action)
 */
export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Stream the agent response so clients receive incremental updates
      await agent.streamText(
        ctx,
        { threadId: args.threadId },
        {
          promptMessageId: args.promptMessageId,
          // providerOptions: {
          //   google: {
          //     thinkingConfig: {
          //       thinkingBudget: 8192,
          //       includeThoughts: true,
          //     },
          //   } satisfies GoogleGenerativeAIProviderOptions,
          // }
        },
        { 
          saveStreamDeltas: true,
          
        }
      );
    } catch (error) {
      console.error("Failed to generate AI response:", error);
    }

    return null;
  },
});

