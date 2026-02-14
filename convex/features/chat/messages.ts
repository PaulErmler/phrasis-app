import { v, ConvexError } from 'convex/values';
import { internalAction, mutation, query } from '../../_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { internal } from '../../_generated/api';
import { saveMessage } from '@convex-dev/agent';
import { listUIMessages, syncStreams } from '@convex-dev/agent';
import { components } from '../../_generated/api';
import { getAuthUser, requireAuthUser } from '../../db/users';
import { agent } from './agent';

export type ListMessagesStreamArgs = {
  kind: 'list';
  includeStatuses?: ('streaming' | 'finished' | 'aborted')[];
};

const agentComponent = components.agent;

/**
 * Send a user message and trigger async AI response generation.
 */
export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== user._id) {
      throw new ConvexError('Thread not found or access denied');
    }

    const { messageId } = await saveMessage(ctx, agentComponent, {
      threadId: args.threadId,
      prompt: args.prompt,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.features.chat.messages.generateResponse,
      {
        threadId: args.threadId,
        promptMessageId: messageId,
      },
    );

    return messageId;
  },
});

/**
 * List messages for a thread in UI-friendly format.
 */
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(v.any()),
  },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    streams: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== user._id) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const messages = await listUIMessages(ctx, agentComponent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    const streams = await syncStreams(ctx, agentComponent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });

    return { ...messages, streams };
  },
});

/**
 * Generate AI response to a user message (internal action).
 */
export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await agent.streamText(
        ctx,
        { threadId: args.threadId },
        { promptMessageId: args.promptMessageId },
        { saveStreamDeltas: true },
      );
    } catch (error) {
      console.error('Failed to generate AI response:', error);
    }

    return null;
  },
});
