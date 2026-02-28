import { v, ConvexError } from 'convex/values';
import { mutation, query } from '../../_generated/server';
import { createThread as createAgentThread } from '@convex-dev/agent';
import { components } from '../../_generated/api';
import { getAuthUser, requireAuthUser } from '../../db/users';

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
    const user = await requireAuthUser(ctx);

    const threadId = await createAgentThread(ctx, agentComponent, {
      userId: user._id,
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
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const threads = await ctx.runQuery(
      agentComponent.threads.listThreadsByUserId,
      {
        userId: user._id,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );

    return threads.page;
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
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (thread?.userId !== user._id) return null;
    return thread;
  },
});
