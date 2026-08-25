import { v, ConvexError } from 'convex/values';
import {
  internalAction,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from '../../_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { internal, components } from '../../_generated/api';
import { saveMessages, listUIMessages, syncStreams } from '@convex-dev/agent';
import { requireAuthUserId, getAuthUserId, getUserSettings } from '../../db/users';
import { getActiveCourseForUser } from '../../db/courses';
import { getCourseSettings } from '../../db/courseSettings';
import { consumeQuota } from '../../usage/helpers';
import { CHAT_CREDIT_USD_STEP, CREDIT_COSTS, FEATURE_IDS } from '../featureIds';
import { agent, AGENT_TOOLS, createMarkAlsoCorrectTool } from './agent';
import type { Doc } from '../../_generated/dataModel';
import { THREAD_MESSAGE_LIMIT, MAX_MESSAGE_LENGTH } from './constants';
import { trackEvent } from '../../db/stats/dailyStats';
import { EVENTS, track, trackException } from '../../analytics';
import {
  captureGeneration,
  openrouterCostUsd,
  openrouterGenerationId,
} from '../../lib/posthogAi';
import { generateText, type ModelMessage } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  OPENROUTER_CHAT_MAX_OUTPUT_TOKENS,
  OPENROUTER_CHAT_PROVIDER_OPTIONS,
  OPENROUTER_INPUT_CACHE_CONTROL,
  OPENROUTER_MODELS,
  OPENROUTER_USAGE_ACCOUNTING,
} from '../../config/aiModels';
import {
  buildCardContextSection,
  buildDifficultySection,
  buildLanguageSection,
  buildSpeakerGenderSection,
  type LearnerDifficulty,
} from './promptSections';
import { speakerGenderPreferenceValidator } from '../../types';
import {
  deriveLegacyCefrTier,
  isPremadeLevelCollection,
  LEVEL_TO_COLLECTION,
} from '../../lib/collections';
import { resolveCardContext } from './cardContext';
import {
  assertQuickActionWithinLimits,
  expandQuickAction,
  vQuickAction,
  type QuickAction,
} from './quickActions';

const agentComponent = components.agent;

const learnerDifficultyValidator = v.object({
  label: v.string(),
  cefrTier: v.string(),
});

function difficultyFromCurrentLevel(level: string): LearnerDifficulty | null {
  const mapping = LEVEL_TO_COLLECTION[level];
  if (!mapping) return null;
  const cefrTier = deriveLegacyCefrTier(mapping.legacyName);
  if (!cefrTier) return null;
  return { label: cefrTier, cefrTier };
}

function difficultyFromCollection(
  collection: Doc<'collections'>,
): LearnerDifficulty | null {
  if (!isPremadeLevelCollection(collection)) return null;
  const cefrTier =
    collection.cefrTier ?? deriveLegacyCefrTier(collection.name);
  if (!cefrTier) return null;
  return {
    label: collection.displayName ?? collection.name,
    cefrTier,
  };
}

/**
 * The level the user is currently studying at: the active curriculum
 * collection when there is one, else the course's 6-bucket `currentLevel`.
 */
async function resolveLearnerDifficulty(
  ctx: QueryCtx,
  course: Doc<'courses'> | undefined,
): Promise<LearnerDifficulty | null> {
  if (!course) return null;
  const settings = await getCourseSettings(ctx, course._id);
  if (settings?.activeCollectionId) {
    const collection = await ctx.db.get(settings.activeCollectionId);
    if (collection) {
      const fromCollection = difficultyFromCollection(collection);
      if (fromCollection) return fromCollection;
    }
  }
  if (course.currentLevel) {
    return difficultyFromCurrentLevel(course.currentLevel);
  }
  return null;
}

/**
 * Internal query to get course languages (and learner difficulty) by userId.
 * Works without auth identity. Used by scheduled actions and tool handlers.
 */
export const getCourseLanguagesForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.object({
      baseLanguages: v.array(v.string()),
      targetLanguages: v.array(v.string()),
      difficulty: v.union(learnerDifficultyValidator, v.null()),
      speakerGenderPreference: v.optional(speakerGenderPreferenceValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const active = await getActiveCourseForUser(ctx, args.userId);
    if (!active) return null;
    const courseSettings = await getCourseSettings(ctx, active.course._id);
    return {
      baseLanguages: active.course.baseLanguages,
      targetLanguages: active.course.targetLanguages,
      difficulty: await resolveLearnerDifficulty(ctx, active.course),
      speakerGenderPreference: courseSettings?.speakerGenderPreference,
    };
  },
});


/**
 * Expand a quick action into its steering prompt, resolving the language
 * context from the reviewed card when present, else from the active course.
 */
function buildQuickActionSteering(
  quickAction: QuickAction,
  cardData: Awaited<ReturnType<typeof resolveCardContext>>,
  active: Awaited<ReturnType<typeof getActiveCourseForUser>>,
): string {
  return expandQuickAction(quickAction, {
    card: cardData,
    baseLanguages: cardData?.baseLanguages ?? active?.course.baseLanguages ?? [],
    targetLanguages:
      cardData?.targetLanguages ?? active?.course.targetLanguages ?? [],
  });
}

/**
 * Send a user message and trigger async AI response generation.
 */
export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    cardId: v.optional(v.id('cards')),
    quickAction: v.optional(vQuickAction),
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

    if (args.quickAction) {
      assertQuickActionWithinLimits(args.quickAction);
    }

    await consumeQuota(ctx, userId, FEATURE_IDS.CHAT_MESSAGES, 1);

    const thread = await ctx.runQuery(agentComponent.threads.getThread, {
      threadId: args.threadId,
    });

    if (!thread || thread.userId !== userId) {
      throw new ConvexError('Thread not found or access denied');
    }

    // Count across ALL pages: a single tool-call-heavy turn stores many
    // assistant/tool messages, so a one-page count freezes (and stops
    // enforcing) once the thread outgrows the page. Stops early when the
    // limit is already proven reached.
    let userMessageCount = 0;
    let cursor: string | null = null;
    do {
      // Annotated to break the inference cycle (result → cursor → query args).
      const existingMessages: {
        page: { message?: { role?: string } }[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(
        agentComponent.messages.listMessagesByThreadId,
        { threadId: args.threadId, order: 'asc', paginationOpts: { cursor, numItems: 300 } },
      );
      userMessageCount += existingMessages.page.filter(
        (m) => m.message?.role === 'user',
      ).length;
      cursor = existingMessages.isDone ? null : existingMessages.continueCursor;
    } while (cursor !== null && userMessageCount < THREAD_MESSAGE_LIMIT);
    if (userMessageCount >= THREAD_MESSAGE_LIMIT) {
      throw new ConvexError({ code: 'THREAD_MESSAGE_LIMIT', message: 'Thread message limit reached' });
    }

    const cardData = args.cardId
      ? await resolveCardContext(ctx, args.cardId, userId)
      : null;
    const active = await getActiveCourseForUser(ctx, userId);

    const steering = args.quickAction
      ? buildQuickActionSteering(args.quickAction, cardData, active)
      : undefined;

    // One save; the array order persists the steering as a hidden system
    // message immediately BEFORE the visible label, so the model reads the
    // detailed request in place on this and every later turn while the UI
    // (which filters system messages) shows only the short label bubble.
    const { messages: savedMessages } = await saveMessages(ctx, agentComponent, {
      threadId: args.threadId,
      messages: [
        ...(steering !== undefined
          ? [{ role: 'system' as const, content: steering }]
          : []),
        { role: 'user' as const, content: args.prompt },
      ],
    });
    const messageId = savedMessages[savedMessages.length - 1]._id;

    const cardContextSection = cardData
      ? buildCardContextSection(cardData)
      : undefined;
    const languageSection = cardData ? buildLanguageSection(cardData) : undefined;
    const difficulty = await resolveLearnerDifficulty(ctx, active?.course);
    const difficultySection = difficulty
      ? buildDifficultySection(difficulty)
      : undefined;
    // Resolved here (db access) so card-context turns — where generateResponse
    // skips its course-languages fallback query — still steer generation by
    // the user's speaker-gender preference. Undefined = Mixed = no steering.
    const activeCourseSettings = active
      ? await getCourseSettings(ctx, active.course._id)
      : null;
    const speakerGenderSection = active
      ? buildSpeakerGenderSection(
          active.course,
          activeCourseSettings?.speakerGenderPreference,
        )
      : undefined;

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
        difficultySection,
        speakerGenderSection,
        prompt: args.prompt,
        includeAiContent,
        // Only forwarded when the card context resolved (ownership verified
        // above), gates the markAlsoCorrect tool for this turn.
        cardId: cardData ? args.cardId : undefined,
      },
    );

    // Track chat message event
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
      quick_action: args.quickAction?.kind,
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
 * must still include a `streams` field of the right shape, otherwise the hook
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
    difficultySection: v.optional(v.string()),
    // Speaker-gender steering (undefined = Mixed preference or unmarked
    // course = no steering). Resolved in sendMessage; the fallback below
    // rebuilds it only when the course-languages query runs anyway.
    speakerGenderSection: v.optional(v.string()),
    // Passed through from sendMessage purely so the cost event can carry the
    // prompt as `$ai_input`. Re-reading it from the agent component here would
    // cost an extra query for data the caller already had in hand.
    prompt: v.optional(v.string()),
    // Whether the user's synced analytics consent allows attaching the prompt
    // and response text to the `$ai_generation` cost event. Tokens, cost and
    // latency are captured either way (legitimate-interest telemetry); the
    // *content* is consent-gated. Resolved in sendMessage, which has db access.
    includeAiContent: v.optional(v.boolean()),
    // The reviewed card, when this turn has card context (ownership already
    // verified by sendMessage's resolveCardContext). Presence registers the
    // markAlsoCorrect tool for this turn, closed over this id.
    cardId: v.optional(v.id('cards')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      let languageSection = args.languageSection;
      let difficultySection = args.difficultySection;
      let speakerGenderSection = args.speakerGenderSection;
      if (!languageSection || !difficultySection) {
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
          languageSection ??= buildLanguageSection(courseLanguages);
          if (!difficultySection && courseLanguages.difficulty) {
            difficultySection = buildDifficultySection(courseLanguages.difficulty);
          }
          speakerGenderSection ??= buildSpeakerGenderSection(
            courseLanguages,
            courseLanguages.speakerGenderPreference,
          );
        }
      }

      const staticInstructions = agent.options.instructions ?? '';
      const dynamicContextParts: string[] = [];
      if (languageSection) {
        dynamicContextParts.push(languageSection);
      }
      if (difficultySection) {
        dynamicContextParts.push(difficultySection);
      }
      if (speakerGenderSection) {
        dynamicContextParts.push(speakerGenderSection);
      }
      if (args.cardContextSection) {
        dynamicContextParts.push(args.cardContextSection);
      }
      const dynamicContext = dynamicContextParts.join('\n\n');

      // Dynamic chat billing: 1 credit was consumed up-front in
      // `sendMessage`; here we accumulate the actual OpenRouter cost across
      // all LLM steps (tool loops included) and charge the remainder. 1
      // credit per additional started CHAT_CREDIT_USD_STEP. The handler
      // runs (awaited) per step while the stream is consumed, and
      // `agent.streamText` only resolves after the stream finishes, so the
      // accumulator is complete after the await. Thread-title generation is
      // deliberately not billed (flash-lite, ~4 words, negligible).
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
          // Leave the AI SDK `system` slot empty. Static instructions are
          // injected via prepareStep with message-level cache_control so
          // OpenRouter can cache the stable prefix across turns/steps.
          //
          // '' is deliberate and load-bearing: `undefined` would re-trigger
          // @convex-dev/agent's `?? options.instructions` fallback and inject
          // the instructions a second time. The cost is one empty
          // `{role:'system', content:''}` block prepended at prompt
          // conversion (the SDK only skips nullish `system`), it is added
          // AFTER prepareStep runs, so it cannot be filtered there. It is
          // byte-stable across all requests (cache-neutral) and OpenAI
          // endpoints accept empty system content; revisit if a future
          // provider rejects it.
          system: '',
          allowSystemInMessages: true,
          maxOutputTokens: OPENROUTER_CHAT_MAX_OUTPUT_TOKENS,
          providerOptions: {
            openrouter: {
              ...OPENROUTER_CHAT_PROVIDER_OPTIONS.openrouter,
              // Documented OpenRouter param: sticky-routing key. All requests
              // of a thread go to the same provider endpoint, which is what
              // makes automatic prefix caching actually hit across the
              // multi-step tool loop (spread above must be kept, per-call
              // providerOptions REPLACES the agent-level default, so dropping
              // it would silently lose reasoning.effort).
              session_id: args.threadId,
            },
          },
          // Re-inject on every step: AI SDK rebuilds each step from
          // initialPrompt.messages + prior step outputs, so a step-0-only
          // prefix is dropped on tool-loop continuations (and with it the
          // "don't summarize" instructions).
          prepareStep: ({ messages }) => {
            const prefix: ModelMessage[] = [
              {
                role: 'system',
                content: staticInstructions,
                providerOptions: {
                  openrouter: {
                    cacheControl: OPENROUTER_INPUT_CACHE_CONTROL,
                  },
                },
              },
            ];

            // Keep dynamic course/card context out of the cached system block.
            if (dynamicContext) {
              prefix.push({
                role: 'system',
                content: dynamicContext,
              });
            }

            return { messages: [...prefix, ...messages] };
          },
          // Card-context turns additionally get markAlsoCorrect, closed over
          // the reviewed card's id. A per-call `tools` REPLACES the
          // agent-level set, so that set is spread back in (AGENT_TOOLS.
          // The single source of truth; a tool added there is automatically
          // available here too). Registered on every card turn (not just
          // discussAnswer): the user can free-text ask "is X also correct?",
          // and persisted steering from an earlier quick action is re-read
          // on later turns.
          ...(args.cardId
            ? {
                tools: {
                  ...AGENT_TOOLS,
                  markAlsoCorrect: createMarkAlsoCorrectTool({
                    cardId: args.cardId,
                  }),
                },
              }
            : {}),
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
              // OpenRouter's generation id. The join key back to their dashboard
              // when a cost figure needs to be reconciled.
              generationId: openrouter?.id,
            });
          },
        },
      );

      // Safe to await: `agent.streamText` only resolves after the stream has
      // finished (see the billing comment above), so this promise is already
      // settled. Wrapped anyway. A missing transcript must not cost the user
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
          // Content only with synced consent. The privacy policy promises
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
      // `unitCredits` billing steps. The effective rate stays 1 credit per
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
