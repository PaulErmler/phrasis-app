import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { components } from '../_generated/api';
import { listUIMessages } from '@convex-dev/agent';
import { adminQuery } from './lib';

const agentComponent = components.agent;

/**
 * Chat threads of an arbitrary user for the admin detail page. Threads
 * with status 'archived' are empty (created but never messaged — see
 * features/chat/threads.ts) and are surfaced with their status so the UI
 * can label them.
 */
export const listUserThreads = adminQuery({
  args: {
    userId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.string(),
        title: v.optional(v.string()),
        summary: v.optional(v.string()),
        status: v.optional(v.string()),
        _creationTime: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(
      agentComponent.threads.listThreadsByUserId,
      {
        userId: args.userId,
        order: 'desc',
        paginationOpts: args.paginationOpts,
      },
    );
    return {
      page: result.page.map((t) => ({
        _id: t._id,
        title: t.title,
        summary: t.summary,
        status: t.status,
        _creationTime: t._creationTime,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Messages of one thread, read-only (no streaming). The thread must belong
 * to the given user — defense-in-depth so a stray threadId can't cross
 * users in the admin UI.
 */
export const listThreadMessages = adminQuery({
  args: {
    userId: v.string(),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });
    if (!thread || thread.userId !== args.userId) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const messages = await listUIMessages(ctx, agentComponent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    return {
      page: messages.page,
      isDone: messages.isDone,
      continueCursor: messages.continueCursor,
    };
  },
});

/**
 * Custom texts (sentences) a user created — via manual card creation or
 * chat approval — newest first, with translations and origin badge.
 */
export const listUserTexts = adminQuery({
  args: {
    userId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id('texts'),
        text: v.string(),
        language: v.string(),
        _creationTime: v.number(),
        origin: v.optional(v.string()),
        translations: v.array(
          v.object({ language: v.string(), text: v.string() }),
        ),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('texts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .order('desc')
      .paginate(args.paginationOpts);

    const originByCollection = new Map<string, string | undefined>();
    const page = await Promise.all(
      result.page.map(async (text) => {
        if (!originByCollection.has(text.collectionId)) {
          const collection = await ctx.db.get(text.collectionId);
          originByCollection.set(text.collectionId, collection?.origin);
        }
        const translations = await ctx.db
          .query('translations')
          .withIndex('by_textId', (q) => q.eq('textId', text._id))
          .take(10);
        return {
          _id: text._id,
          text: text.text,
          language: text.language,
          _creationTime: text._creationTime,
          origin: originByCollection.get(text.collectionId),
          translations: translations.map((t) => ({
            language: t.targetLanguage,
            text: t.translatedText,
          })),
        };
      }),
    );

    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
