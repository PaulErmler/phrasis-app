import { v, ConvexError } from 'convex/values';
import { mutation, query } from '../../_generated/server';
import { createThread as createAgentThread, listMessages } from '@convex-dev/agent';
import { components } from '../../_generated/api';
import { getAuthUserId, requireAuthUserId } from '../../db/users';

const agentComponent = components.agent;

/**
 * Create a new chat thread for the current user.
 */
export const createThread = mutation({
  args: {
    title: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const threadId = await createAgentThread(ctx, agentComponent, {
      userId,
      title: args.title || 'New Chat',
    });

    return threadId;
  },
});

/**
 * List all threads for the current user.
 */
export const listThreads = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      userId: v.optional(v.string()),
      title: v.optional(v.string()),
      summary: v.optional(v.string()),
      status: v.optional(v.string()),
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const threads = await ctx.runQuery(
      agentComponent.threads.listThreadsByUserId,
      {
        userId,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );

    return threads.page;
  },
});

/**
 * Return the user's most recent thread if it has no messages yet,
 * otherwise create a fresh one.
 */
export const getOrCreateEmptyThread = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);

    const threads = await ctx.runQuery(
      agentComponent.threads.listThreadsByUserId,
      {
        userId,
        order: 'desc',
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );

    const latest = threads.page[0];
    if (latest) {
      const messages = await listMessages(ctx, agentComponent, {
        threadId: latest._id,
        paginationOpts: { cursor: null, numItems: 1 },
      });
      if (messages.page.length === 0) {
        return latest._id;
      }
    }

    const threadId = await createAgentThread(ctx, agentComponent, {
      userId,
      title: 'New Chat',
    });

    return threadId;
  },
});

/**
 * Get a specific thread by ID.
 */
export const getThread = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      userId: v.optional(v.string()),
      title: v.optional(v.string()),
      summary: v.optional(v.string()),
      status: v.optional(v.string()),
      _creationTime: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (thread?.userId !== userId) return null;
    return thread;
  },
});
