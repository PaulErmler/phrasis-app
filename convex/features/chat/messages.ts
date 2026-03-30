import { v, ConvexError } from 'convex/values';
import { internalAction, internalQuery, mutation, query } from '../../_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { internal } from '../../_generated/api';
import { saveMessage } from '@convex-dev/agent';
import { listUIMessages, syncStreams } from '@convex-dev/agent';
import { components } from '../../_generated/api';
import { requireAuthUserId, getAuthUserId } from '../../db/users';
import { getActiveCourseForUser } from '../../db/courses';
import { consumeQuota } from '../../usage/helpers';
import { FEATURE_IDS } from '../featureIds';
import { agent } from './agent';
import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { THREAD_MESSAGE_LIMIT, MAX_MESSAGE_LENGTH } from './constants';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_MODELS } from '../../config/aiModels';

export type ListMessagesStreamArgs = {
  kind: 'list';
  includeStatuses?: ('streaming' | 'finished' | 'aborted')[];
};

const agentComponent = components.agent;

/**
 * Internal query to get course languages by userId.
 * Works without auth identity — used by scheduled actions and tool handlers.
 */
export const getCourseLanguagesForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.object({
      baseLanguages: v.array(v.string()),
      targetLanguages: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const active = await getActiveCourseForUser(ctx, args.userId);
    if (!active) return null;
    return {
      baseLanguages: active.course.baseLanguages,
      targetLanguages: active.course.targetLanguages,
    };
  },
});

/**
 * Look up a card's source text, course-scoped translations, and course
 * languages via card → deck → course. Only fetches translations whose
 * targetLanguage is in the course's language set (uses the compound
 * by_text_and_language index for each language).
 */
async function resolveCardContext(
  ctx: MutationCtx,
  cardId: Id<'cards'>,
  userId: string,
): Promise<{
  sourceText: string;
  sourceLanguage: string;
  translations: { language: string; text: string }[];
  baseLanguages: string[];
  targetLanguages: string[];
} | null> {
  const card = await ctx.db.get(cardId);
  if (!card) return null;

  const deck = await ctx.db.get(card.deckId);
  if (!deck) return null;

  const course = await ctx.db.get(deck.courseId);
  if (!course) return null;

  if (course.userId !== userId) return null;

  const text = await ctx.db.get(card.textId);
  if (!text) return null;

  const courseLangs = new Set([...course.baseLanguages, ...course.targetLanguages]);
  courseLangs.delete(text.language);

  const translations = (
    await Promise.all(
      [...courseLangs].map((lang) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('targetLanguage', lang),
          )
          .unique(),
      ),
    )
  )
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .map((t) => ({ language: t.targetLanguage, text: t.translatedText }));

  return {
    sourceText: text.text,
    sourceLanguage: text.language,
    translations,
    baseLanguages: course.baseLanguages,
    targetLanguages: course.targetLanguages,
  };
}

function buildCardContextSection(opts: {
  sourceText: string;
  sourceLanguage: string;
  translations: { language: string; text: string }[];
}): string {
  const lines = [`Original (${opts.sourceLanguage}): "${opts.sourceText}"`];
  for (const t of opts.translations) {
    lines.push(`${t.language}: "${t.text}"`);
  }
  return `The user is currently reviewing this card:\n${lines.join('\n')}`;
}

function buildLanguageSection(courseLanguages: {
  baseLanguages: string[];
  targetLanguages: string[];
}): string {
  const allLangs = [
    ...new Set([...courseLanguages.baseLanguages, ...courseLanguages.targetLanguages]),
  ];

  return `Course language configuration:
Base languages: ${courseLanguages.baseLanguages.join(', ')}
Target languages: ${courseLanguages.targetLanguages.join(', ')}
All language codes for cards (in required order): ${JSON.stringify(allLangs)}
Every createCard call MUST include translations for ALL of these languages: ${JSON.stringify(allLangs)}. No exceptions.`;
}

/**
 * Send a user message and trigger async AI response generation.
 */
export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    cardId: v.optional(v.id('cards')),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    if (args.prompt.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError({
        code: 'MESSAGE_TOO_LONG',
        message: `Message exceeds the ${MAX_MESSAGE_LENGTH} character limit`,
      });
    }

    await consumeQuota(ctx, userId, FEATURE_IDS.CHAT_MESSAGES, 1);

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== userId) {
      throw new ConvexError('Thread not found or access denied');
    }

    const existingMessages = await ctx.runQuery(
      agentComponent.messages.listMessagesByThreadId,
      { threadId: args.threadId, order: 'asc', paginationOpts: { cursor: null, numItems: 200 } },
    );
    const userMessageCount = existingMessages.page.filter(
      (m: any) => m.message?.role === 'user',
    ).length;
    if (userMessageCount >= THREAD_MESSAGE_LIMIT) {
      throw new ConvexError({ code: 'THREAD_MESSAGE_LIMIT', message: 'Thread message limit reached' });
    }

    const { messageId } = await saveMessage(ctx, agentComponent, {
      threadId: args.threadId,
      prompt: args.prompt,
    });

    let cardContextSection: string | undefined;
    let languageSection: string | undefined;
    if (args.cardId) {
      const cardData = await resolveCardContext(ctx, args.cardId, userId);
      if (cardData) {
        cardContextSection = buildCardContextSection(cardData);
        languageSection = buildLanguageSection(cardData);
      }
    }

    if (userMessageCount === 0) {
      await ctx.runMutation(agentComponent.threads.updateThread, {
        threadId: args.threadId,
        patch: { status: 'active' },
      });

      await ctx.scheduler.runAfter(
        0,
        internal.features.chat.messages.generateThreadTitle,
        {
          threadId: args.threadId,
          userMessage: args.prompt,
        },
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.features.chat.messages.generateResponse,
      {
        threadId: args.threadId,
        promptMessageId: messageId,
        cardContextSection,
        languageSection,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== userId) {
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
    cardContextSection: v.optional(v.string()),
    languageSection: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      let languageSection = args.languageSection;
      if (!languageSection) {
        const thread = await ctx.runQuery(agentComponent.threads.getThread, {
          threadId: args.threadId,
        });
        const courseLanguages = thread?.userId
          ? await ctx.runQuery(
            internal.features.chat.messages.getCourseLanguagesForUser,
            { userId: thread.userId },
          )
          : null;
        if (courseLanguages) {
          languageSection = buildLanguageSection(courseLanguages);
        }
      }

      const parts: string[] = [agent.options.instructions ?? ''];
      if (languageSection) {
        parts.push(languageSection);
      }
      if (args.cardContextSection) {
        parts.push(args.cardContextSection);
      }

      const system = parts.join('\n\n');

      await agent.streamText(
        ctx,
        { threadId: args.threadId },
        {
          promptMessageId: args.promptMessageId,
          system,
        },
        { saveStreamDeltas: { chunking: "word", throttleMs: 500 } },
      );
    } catch (error) {
      console.error('Failed to generate AI response:', error);
    }

    return null;
  },
});

/**
 * Generate a short title for a thread based on the first user message.
 */
export const generateThreadTitle = internalAction({
  args: {
    threadId: v.string(),
    userMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      });
      const { text } = await generateText({
        model: openrouter(OPENROUTER_MODELS.threadTitle),
        system: `You generate short titles for chat conversations. Respond with ONLY the title, nothing else.
The title MUST be written in the SAME language the user wrote their message in. Do NOT translate into any other language.
For example: if the user writes in English, respond in English. If the user writes in German, respond in German.
Maximum 4 words. No quotes. No period.`,
        prompt: args.userMessage,
      });
      const title = text.trim().slice(0, 80);
      if (title) {
        await ctx.runMutation(agentComponent.threads.updateThread, {
          threadId: args.threadId,
          patch: { title },
        });
      }
    } catch (e) {
      console.error('Failed to generate thread title:', e);
    }
    return null;
  },
});
