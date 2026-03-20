import { v } from 'convex/values';
import { mutation, query } from '../../_generated/server';
import { createThread as createAgentThread } from '@convex-dev/agent';
import { components } from '../../_generated/api';
import { getAuthUserId, requireAuthUserId } from '../../db/users';

const agentComponent = components.agent;

/**
 * Create a thread and immediately mark it as "archived" so it stays
 * hidden from listThreads until the first message is sent (which
 * flips it to "active").
 */
async function createHiddenThread(
  ctx: Parameters<typeof createAgentThread>[0],
  userId: string,
  title?: string,
): Promise<string> {
  const threadId = await createAgentThread(ctx, agentComponent, {
    userId,
    title: title || 'New Chat',
  });
  await ctx.runMutation(agentComponent.threads.updateThread, {
    threadId,
    patch: { status: 'archived' },
  });
  return threadId;
}

/**
 * List threads for the current user, showing only those with messages.
 * Threads start as "archived" (hidden) and are flipped to "active" by
 * sendMessage on the first message, so filtering on status === "active"
 * gives us non-empty threads without per-thread message queries.
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
        paginationOpts: { cursor: null, numItems: 20 },
      },
    );

    return threads.page.filter((t) => t.status === 'active');
  },
});

/**
 * Return the user's most recent empty thread, or create a fresh one.
 * Empty threads are identified by status "archived" (set at creation).
 * Once a message is sent, sendMessage flips them to "active".
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
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );

    const emptyThread = threads.page.find((t) => t.status === 'archived');
    if (emptyThread) {
      return emptyThread._id;
    }

    return createHiddenThread(ctx, userId);
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
