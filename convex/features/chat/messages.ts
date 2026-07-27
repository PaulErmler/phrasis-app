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
import { CHAT_CREDIT_USD_STEP, CREDIT_COSTS, FEATURE_IDS } from '../featureIds';
import { agent } from './agent';
import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { THREAD_MESSAGE_LIMIT, MAX_MESSAGE_LENGTH } from './constants';
import { trackEvent } from '../../db/stats/dailyStats';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_MODELS } from '../../config/aiModels';
import { getLanguageByCode } from '../../../lib/languages';

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

  const namedLines = allLangs
    .map((code) => `- ${code}: ${getLanguageByCode(code)?.name ?? code}`)
    .join('\n');

  const firstName = getLanguageByCode(allLangs[0])?.name ?? allLangs[0];
  const secondCode = allLangs[1] ?? allLangs[0];
  const secondName = getLanguageByCode(secondCode)?.name ?? secondCode;

  const schematic = allLangs
    .map((code) => {
      const name = getLanguageByCode(code)?.name ?? code;
      return `{"language":"${code}","text":"<${name} sentence>"}`;
    })
    .join(',');

  return `Course language configuration (required order; one translation per code per card):
${namedLines}

Each createCard call must pass exactly these entries, in this order. The "text" for each entry must be written in the language named above — e.g. the "${allLangs[0]}" text must be ${firstName}, the "${secondCode}" text must be ${secondName}. Never copy one entry's text into another.
Schematic: [${schematic}]`;
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
      (m) => m.message?.role === 'user',
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

    // Track chat message event
    const active = await getActiveCourseForUser(ctx, userId);
    if (active) {
      await trackEvent(ctx, { userId, courseId: active.course._id, field: 'chatMessagesSent' });
    }

    return messageId;
  },
});

/**
 * Empty, correctly-shaped `streams` value matching what `syncStreams` returns
 * for the requested `streamArgs`. The client streaming hook reads
 * `result.streams.messages` whenever it issues a `kind: 'list'` query, so the
 * early-return branches in `listMessages` (unauthenticated / thread not owned)
 * must still include a `streams` field of the right shape — otherwise the hook
 * throws `Cannot read properties of undefined (reading 'messages')`. Mirrors
 * `syncStreams` by returning `undefined` when no streaming was requested.
 */
function emptyStreamsFor(streamArgs: unknown) {
  if (!streamArgs || typeof streamArgs !== 'object') return undefined;
  const kind = (streamArgs as { kind?: string }).kind;
  if (kind === 'list') return { kind: 'list' as const, messages: [] };
  if (kind === 'deltas') return { kind: 'deltas' as const, deltas: [] };
  return undefined;
}

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
      return {
        page: [],
        isDone: true,
        continueCursor: '',
        streams: emptyStreamsFor(args.streamArgs),
      };
    }

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== userId) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
        streams: emptyStreamsFor(args.streamArgs),
      };
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

      // Dynamic chat billing: 1 credit was consumed up-front in
      // `sendMessage`; here we accumulate the actual OpenRouter cost across
      // all LLM steps (tool loops included) and charge the remainder — 1
      // credit per additional started CHAT_CREDIT_USD_STEP. The handler
      // runs (awaited) per step while the stream is consumed, and
      // `agent.streamText` only resolves after the stream finishes, so the
      // accumulator is complete after the await. Thread-title generation is
      // deliberately not billed (flash-lite, ~4 words — negligible).
      let totalCostUsd = 0;
      let billedUserId: string | undefined;

      await agent.streamText(
        ctx,
        { threadId: args.threadId },
        {
          promptMessageId: args.promptMessageId,
          system,
        },
        {
          saveStreamDeltas: { chunking: "word", throttleMs: 500 },
          usageHandler: async (_usageCtx, { userId, providerMetadata }) => {
            const openrouterUsage = (
              providerMetadata as
                | { openrouter?: { usage?: { cost?: number } } }
                | undefined
            )?.openrouter?.usage;
            totalCostUsd += openrouterUsage?.cost ?? 0;
            billedUserId = userId ?? billedUserId;
          },
        },
      );

      // Integer micro-USD math: IEEE-754 division can land an exact multiple
      // of the step an epsilon above an integer (0.035 / 0.005 → 7.000…001),
      // which ceil would then overcharge by a full credit.
      //
      // Billed in whole chat_messages UNITS, not credits: decrementQuota and
      // Autumn's credit schema each multiply a chat_messages amount by
      // CREDIT_COSTS[CHAT_MESSAGES], so passing credits through them would
      // double-convert. One unit deducts `unitCredits` credits, so it covers
      // `unitCredits` billing steps — the effective rate stays 1 credit per
      // CHAT_CREDIT_USD_STEP regardless of the configured cost.
      const stepMicroUsd = Math.round(CHAT_CREDIT_USD_STEP * 1e6);
      const unitCredits = CREDIT_COSTS[FEATURE_IDS.CHAT_MESSAGES] ?? 1;
      const totalUnits = Math.ceil(
        Math.round(totalCostUsd * 1e6) / (stepMicroUsd * unitCredits),
      );
      const extraMessageUnits = Math.max(0, totalUnits - 1);
      if (extraMessageUnits > 0 && billedUserId) {
        await ctx.runMutation(internal.usage.helpers.chargeExtraChatCredits, {
          userId: billedUserId,
          extraMessageUnits,
        });
      }
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
