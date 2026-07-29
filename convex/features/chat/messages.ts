import { v, ConvexError } from 'convex/values';
import {
  internalAction,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from '../../_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { internal, components } from '../../_generated/api';
import { saveMessage, listUIMessages, syncStreams } from '@convex-dev/agent';
import { requireAuthUserId, getAuthUserId, getUserSettings } from '../../db/users';
import { getActiveCourseForUser } from '../../db/courses';
import { consumeQuota } from '../../usage/helpers';
import { CHAT_CREDIT_USD_STEP, CREDIT_COSTS, FEATURE_IDS } from '../featureIds';
import { agent } from './agent';
import type { Id } from '../../_generated/dataModel';
import { THREAD_MESSAGE_LIMIT, MAX_MESSAGE_LENGTH } from './constants';
import { trackEvent } from '../../db/stats/dailyStats';
import { EVENTS, track, trackException } from '../../analytics';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../../lib/posthogAi';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_MODELS, OPENROUTER_USAGE_ACCOUNTING } from '../../config/aiModels';
import { getLanguageByCode } from '../../../lib/languages';

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

    // The privacy policy promises that declining analytics stops chat content
    // from reaching PostHog. The consent choice lives in the browser, mirrored
    // to `userSettings` by ConsentSync; unset means never synced → withhold.
    const settings = await getUserSettings(ctx, userId);
    const includeAiContent = settings?.analyticsConsent === true;

    await ctx.scheduler.runAfter(
      0,
      internal.features.chat.messages.generateResponse,
      {
        threadId: args.threadId,
        promptMessageId: messageId,
        cardContextSection,
        languageSection,
        prompt: args.prompt,
        includeAiContent,
      },
    );

    // Track chat message event
    const active = await getActiveCourseForUser(ctx, userId);
    if (active) {
      await trackEvent(ctx, { userId, courseId: active.course._id, field: 'chatMessagesSent' });
    }

    // Captured server-side rather than from the composer: the browser can be
    // closed the instant the send resolves, and this is the event every chat
    // funnel is anchored on.
    await track(ctx, userId, EVENTS.CHAT_MESSAGE_SENT, {
      thread_id: args.threadId,
      thread_message_index: userMessageCount,
      message_chars: args.prompt.length,
      has_card_context: args.cardId !== undefined,
      base_languages: active?.course.baseLanguages,
      target_languages: active?.course.targetLanguages,
    });

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
    const emptyResult = () => ({
      page: [],
      isDone: true,
      continueCursor: '',
      streams: emptyStreamsFor(args.streamArgs),
    });

    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return emptyResult();
    }

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== userId) {
      return emptyResult();
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
    // Passed through from sendMessage purely so the cost event can carry the
    // prompt as `$ai_input`. Re-reading it from the agent component here would
    // cost an extra query for data the caller already had in hand.
    prompt: v.optional(v.string()),
    // Whether the user's synced analytics consent allows attaching the prompt
    // and response text to the `$ai_generation` cost event. Tokens, cost and
    // latency are captured either way (legitimate-interest telemetry); the
    // *content* is consent-gated. Resolved in sendMessage, which has db access.
    includeAiContent: v.optional(v.boolean()),
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

      // One `$ai_generation` per LLM step is emitted after the stream finishes
      // rather than from inside `usageHandler`: the handler runs mid-stream, and
      // the response text needed for `$ai_output_choices` only exists once the
      // whole thing has resolved. Steps are collected here and flushed below.
      const steps: Array<{
        model: string;
        provider: string;
        inputTokens?: number;
        outputTokens?: number;
        costUsd: number;
        generationId?: string;
      }> = [];
      const startedAt = Date.now();

      const result = await agent.streamText(
        ctx,
        { threadId: args.threadId },
        {
          promptMessageId: args.promptMessageId,
          system,
        },
        {
          saveStreamDeltas: { chunking: "word", throttleMs: 500 },
          usageHandler: async (
            _usageCtx,
            { userId, providerMetadata, usage, model, provider },
          ) => {
            const openrouter = (
              providerMetadata as
                | { openrouter?: { id?: string; usage?: { cost?: number } } }
                | undefined
            )?.openrouter;
            const stepCostUsd = openrouter?.usage?.cost ?? 0;
            totalCostUsd += stepCostUsd;
            billedUserId = userId ?? billedUserId;
            steps.push({
              model,
              provider,
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
              costUsd: stepCostUsd,
              // OpenRouter's generation id — the join key back to their dashboard
              // when a cost figure needs to be reconciled.
              generationId: openrouter?.id,
            });
          },
        },
      );

      // Safe to await: `agent.streamText` only resolves after the stream has
      // finished (see the billing comment above), so this promise is already
      // settled. Wrapped anyway — a missing transcript must not cost the user
      // their reply.
      let responseText: string | undefined;
      try {
        responseText = await result.text;
      } catch {
        responseText = undefined;
      }

      const latencyPerStepMs = steps.length
        ? (Date.now() - startedAt) / steps.length
        : 0;
      for (const [index, step] of steps.entries()) {
        const isFinalStep = index === steps.length - 1;
        await captureGeneration(ctx, {
          distinctId: billedUserId,
          feature: 'chat',
          model: step.model,
          provider: step.provider,
          latencyMs: latencyPerStepMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          costUsd: step.costUsd,
          // Prompt on the first step, completion on the last: the intermediate
          // steps are tool loops with no user-facing text of their own.
          // Content only with synced consent — the privacy policy promises
          // that declining keeps chat text out of PostHog.
          input:
            args.includeAiContent && index === 0 && args.prompt
              ? [{ role: 'user', content: args.prompt }]
              : undefined,
          outputChoices:
            args.includeAiContent && isFinalStep && responseText
              ? [{ role: 'assistant', content: responseText }]
              : undefined,
          traceId: step.generationId,
          extra: {
            thread_id: args.threadId,
            step_index: index,
            step_count: steps.length,
            has_card_context: args.cardContextSection !== undefined,
          },
        });
      }

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
      // Caught, so the Convex dashboard's exception destination never sees it.
      // A silently failed reply is the single most user-visible chat bug there
      // is, so report it explicitly.
      await trackException(ctx, error, undefined, {
        op: 'chat.generateResponse',
        threadId: args.threadId,
      });
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
        // Makes OpenRouter report the actual USD cost of this call. Titles are
        // cheap individually but fire once per thread, so they are worth a line
        // on the cost dashboard rather than an unexplained gap.
        extraBody: OPENROUTER_USAGE_ACCOUNTING,
      });
      const startedAt = Date.now();
      const { text, usage, providerMetadata } = await generateText({
        model: openrouter(OPENROUTER_MODELS.threadTitle),
        system: `You generate short titles for chat conversations. Respond with ONLY the title, nothing else.
The title MUST be written in the SAME language the user wrote their message in. Do NOT translate into any other language.
For example: if the user writes in English, respond in English. If the user writes in German, respond in German.
Maximum 4 words. No quotes. No period.`,
        prompt: args.userMessage,
      });
      await captureGeneration(ctx, {
        feature: 'chat_title',
        model: OPENROUTER_MODELS.threadTitle,
        provider: 'openrouter',
        latencyMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        costUsd: openrouterCostUsd(providerMetadata),
        traceId: openrouterGenerationId(providerMetadata),
        extra: { thread_id: args.threadId },
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
