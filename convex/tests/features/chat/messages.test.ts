/// <reference types="vite/client" />
import { vi } from 'vitest';

/**
 * Test-controlled LLM state. The OpenRouter provider is mocked below so that
 * BOTH module-scope clients (`agent.ts`'s Agent model and lib/openrouter's
 * `getOpenRouter()`) hand the real AI SDK a fake model whose responses come
 * from this holder. Everything downstream — @convex-dev/agent's streamText,
 * delta persistence, the component's message storage — runs for real.
 */
const llm = vi.hoisted(() => {
  const state = {
    responseText: 'Mock assistant reply.',
    titleText: 'Mock Thread Title',
    /** providerMetadata for the finish part of the Nth doStream call. */
    providerMetadataPerStep: [] as Array<Record<string, unknown> | undefined>,
    failStream: false,
    failGenerate: false,
    streamCalls: 0,
    generateCalls: 0,
    /** Tool names handed to the model on the Nth doStream call. */
    toolNamesPerStep: [] as string[][],
    reset() {
      state.responseText = 'Mock assistant reply.';
      state.titleText = 'Mock Thread Title';
      state.providerMetadataPerStep = [];
      state.failStream = false;
      state.failGenerate = false;
      state.streamCalls = 0;
      state.generateCalls = 0;
      state.toolNamesPerStep = [];
    },
  };
  return state;
});

// LanguageModelV2 fake at the provider boundary: `generateThreadTitle` goes
// through the real `generateText` → doGenerate, `generateResponse` through the
// real Agent/streamText pipeline → doStream. Stream part shapes mirror
// @convex-dev/agent's own mockModel helper.
vi.mock('@openrouter/ai-sdk-provider', () => {
  const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };
  const model = {
    specificationVersion: 'v2',
    provider: 'openrouter',
    modelId: 'mock-openrouter-model',
    supportedUrls: {},
    async doGenerate() {
      llm.generateCalls += 1;
      if (llm.failGenerate) throw new Error('mock title failure');
      return {
        content: [{ type: 'text', text: llm.titleText }],
        finishReason: 'stop',
        usage,
        warnings: [],
      };
    },
    async doStream(options: { tools?: Array<{ name?: string }> }) {
      const step = llm.streamCalls;
      llm.streamCalls += 1;
      // The tool set the model actually sees, at the provider boundary — the
      // one place that can prove a tool was withheld rather than merely
      // discouraged by prompt wording.
      llm.toolNamesPerStep[step] = (options?.tools ?? [])
        .map((tool) => tool.name ?? '')
        .filter(Boolean);
      if (llm.failStream) throw new Error('mock stream failure');
      const providerMetadata = llm.providerMetadataPerStep[step];
      const words = llm.responseText.split(' ');
      const parts: Array<Record<string, unknown>> = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'txt-0' },
        ...words.map((word, i) => ({
          type: 'text-delta',
          id: 'txt-0',
          delta: i === 0 ? word : ` ${word}`,
        })),
        { type: 'text-end', id: 'txt-0' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage,
          ...(providerMetadata ? { providerMetadata } : {}),
        },
      ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
  return { createOpenRouter: () => () => model };
});

import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConvexError, type Value } from 'convex/values';
// Runs the real agent component in-process (schema + source modules) so the
// `components.agent.*` refs these functions call resolve to actual component
// functions. See threads.test.ts for the same setup.
import { register as registerAgentComponent } from '@convex-dev/agent/test';
import schema from '../../../schema';
import { api, internal } from '../../../_generated/api';
import { posthog } from '../../../posthog';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../../../lib/scheduling';
import {
  MAX_MESSAGE_LENGTH,
  THREAD_MESSAGE_LIMIT,
} from '../../../features/chat/constants';

const modules = import.meta.glob('/convex/**/*.ts');

const USER = 'user_A';

function setup() {
  const t = convexTest(schema, modules);
  registerAgentComponent(t);
  return t;
}

/** Course + userSettings + a credits-plan quota doc for USER. */
async function seedUserWithCredits(t: TestConvex<typeof schema>, balance = 50) {
  await t.run(async (ctx) => {
    const courseId = await ctx.db.insert('courses', {
      userId: USER,
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: USER,
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    await ctx.db.insert('usageQuotas', {
      userId: USER,
      features: {
        credits: { balance, included: balance, used: 0, unlimited: false },
      },
      lastSyncedAt: Date.now(),
    });
  });
}

/**
 * A card in USER's active course, plus that course's writing settings. The
 * markAlsoCorrect tool is registered per card turn, and withheld when the
 * course writes by transcription.
 */
async function seedCardInActiveCourse(
  t: TestConvex<typeof schema>,
  writingInputMode: 'translate' | 'transcribe',
) {
  return t.run(async (ctx) => {
    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', USER))
      .first();
    const courseId = settings!.activeCourseId!;
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      writingInputMode,
    });
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'deck',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'I would like a coffee, please.',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'es',
      translatedText: 'Quisiera un café, por favor.',
    });
    return ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate: 0,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
  });
}

async function creditsBalance(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', USER))
      .first();
    return doc?.features.credits.balance;
  });
}

async function expectConvexErrorCode(p: Promise<unknown>, code: string) {
  let thrown: unknown;
  try {
    await p;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ConvexError);
  // convex-test rethrows ConvexError with `data` still JSON-serialized.
  const raw = (thrown as ConvexError<Value>).data;
  const data =
    typeof raw === 'string'
      ? (JSON.parse(raw) as { code?: string })
      : (raw as { code?: string });
  expect(data.code).toBe(code);
}

/**
 * Drain the runAfter(0) chains (title + response generation, usage
 * tracking) under fake timers. Advances in 10ms steps instead of
 * `vi.runAllTimers`: the agent component schedules stream timeout/cleanup
 * jobs minutes out and cancels them from later mutations, and letting the
 * fake clock reach those timers mid-drain trips convex-test's
 * cancel-while-inProgress invariant. The drain's pump loop caps at 10000
 * pumps, so 10ms keeps total fake time well under the 5-minute cleanup
 * delay while still firing every runAfter(0) job.
 */
function drainScheduled(t: TestConvex<typeof schema>) {
  return t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10));
}

/** Concatenated text parts of a UIMessage returned by listMessages. */
function textOf(message: unknown): string {
  const m = message as {
    text?: string;
    parts?: Array<{ type: string; text?: string }>;
  };
  return (
    m.text ??
    (m.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('')
  );
}

describe('features/chat/messages', () => {
  describe('getCourseLanguagesForUser', () => {
    it('returns null when user has no active course', async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: 'user_nope' },
      );
      expect(res).toBeNull();
    });

    it('returns languages for the active course', async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es', 'fr'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: 'user_A' },
      );
      expect(res).toEqual({
        baseLanguages: ['en'],
        targetLanguages: ['es', 'fr'],
        difficulty: null,
      });
    });

    it('returns difficulty from the active curriculum collection', async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const datasetId = await ctx.db.insert('datasets', {
          slug: 'ogte-test',
          version: '1.0.0',
          publishedAt: Date.now(),
          isActive: true,
        });
        const collectionId = await ctx.db.insert('collections', {
          name: 'L03',
          code: 'L03',
          datasetId,
          cefrTier: 'A1',
          displayName: 'A1.2',
          order: 3,
          textCount: 10,
          origin: 'premade',
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es'],
          currentLevel: 'intermediate',
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert('courseSettings', {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: collectionId,
        });
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: 'user_A' },
      );
      expect(res?.difficulty).toEqual({ label: 'A1.2', cefrTier: 'A1' });
    });

    it('falls back to course currentLevel when the active collection is not a curriculum level', async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const customId = await ctx.db.insert('collections', {
          name: 'Custom',
          textCount: 2,
          origin: 'custom',
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['de'],
          currentLevel: 'beginner',
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert('courseSettings', {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: customId,
        });
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: 'user_A' },
      );
      expect(res?.difficulty).toEqual({ label: 'Pre-A1', cefrTier: 'Pre-A1' });
    });

    it('uses a legacy CEFR collection name when cefrTier is unset', async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'B1',
          textCount: 5,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['es'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        await ctx.db.insert('courseSettings', {
          courseId,
          initialReviewCount: 3,
          activeCollectionId: collectionId,
        });
      });
      const res = await t.query(
        internal.features.chat.messages.getCourseLanguagesForUser,
        { userId: 'user_A' },
      );
      expect(res?.difficulty).toEqual({ label: 'B1', cefrTier: 'B1' });
    });
  });

  describe('listMessages', () => {
    it('returns empty page unauthenticated', async () => {
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.chat.messages.listMessages, {
        threadId: 'thread_x',
        paginationOpts: { numItems: 10, cursor: null },
      });
      // Without identity, this returns an empty list shape.
      expect(Array.isArray(res?.page ?? [])).toBe(true);
    });

    it('includes a list-shaped streams field on the early return when streaming', async () => {
      // Regression: the client streaming hook (useUIMessages → useDeltaStreams)
      // reads `streams.messages` whenever it issues a `kind: 'list'` query. If
      // the unauthenticated / thread-not-owned early return omits `streams`,
      // the hook throws "Cannot read properties of undefined (reading
      // 'messages')". The early return must mirror syncStreams' list shape.
      const t = convexTest(schema, modules);
      const res = await t.query(api.features.chat.messages.listMessages, {
        threadId: 'thread_x',
        paginationOpts: { numItems: 10, cursor: null },
        streamArgs: { kind: 'list', startOrder: 0 },
      });
      expect(res.streams).toBeDefined();
      const streams = res.streams!;
      expect(streams.kind).toBe('list');
      if (streams.kind !== 'list')
        throw new Error('narrowed by the expect above');
      expect(Array.isArray(streams.messages)).toBe(true);
      expect(streams.messages).toHaveLength(0);
    });
  });

  // The agent-component paths below run against the REAL agent component
  // (registerAgentComponent) with the LLM stubbed at the provider boundary.
  // Quick actions need no case here: steering-before-label ordering is
  // structural (one `saveMessages` call whose array is [system, user]), the
  // payload length guards are covered by assertQuickActionWithinLimits tests,
  // and the expansion itself by expandQuickAction tests, both in
  // quickActions.test.ts.
  describe('sendMessage', () => {
    beforeEach(() => llm.reset());
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects unauthenticated', async () => {
      const t = setup();
      await expect(
        t.mutation(api.features.chat.messages.sendMessage, {
          threadId: 'thread_x',
          prompt: 'hi',
        }),
      ).rejects.toThrow('Unauthenticated');
    });

    it('rejects prompts over MAX_MESSAGE_LENGTH before touching quota', async () => {
      const t = setup();
      // No quota doc seeded: the length guard must fire first.
      await expectConvexErrorCode(
        t
          .withIdentity({ subject: USER })
          .mutation(api.features.chat.messages.sendMessage, {
            threadId: 'thread_x',
            prompt: 'x'.repeat(MAX_MESSAGE_LENGTH + 1),
          }),
        'MESSAGE_TOO_LONG',
      );
    });

    it('throws QUOTA_NOT_SYNCED when the user has no quota doc', async () => {
      const t = setup();
      await expectConvexErrorCode(
        t
          .withIdentity({ subject: USER })
          .mutation(api.features.chat.messages.sendMessage, {
            threadId: 'thread_x',
            prompt: 'hi',
          }),
        'QUOTA_NOT_SYNCED',
      );
    });

    it('throws USAGE_LIMIT at zero balance', async () => {
      const t = setup();
      await seedUserWithCredits(t, 0);
      await expectConvexErrorCode(
        t
          .withIdentity({ subject: USER })
          .mutation(api.features.chat.messages.sendMessage, {
            threadId: 'thread_x',
            prompt: 'hi',
          }),
        'USAGE_LIMIT',
      );
    });

    it("denies sending into another user's thread", async () => {
      const t = setup();
      await seedUserWithCredits(t);
      const foreignThread = await t
        .withIdentity({ subject: 'user_B' })
        .mutation(api.features.chat.threads.getOrCreateEmptyThread, {});
      await expect(
        t
          .withIdentity({ subject: USER })
          .mutation(api.features.chat.messages.sendMessage, {
            threadId: foreignThread,
            prompt: 'hi',
          }),
      ).rejects.toThrow('Thread not found or access denied');
    });

    it('happy path: saves the message, consumes 1 credit, activates + titles the thread, streams a reply', async () => {
      const t = setup();
      await seedUserWithCredits(t, 50);
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );

      llm.titleText = 'Spanish Greetings';
      llm.responseText = '¡Hola! Mock reply.';
      vi.useFakeTimers();
      const messageId = await asUser.mutation(
        api.features.chat.messages.sendMessage,
        { threadId, prompt: 'How do I greet someone in Spanish?' },
      );
      expect(typeof messageId).toBe('string');

      // Synchronous effects of the mutation itself: quota consumed, first
      // message flips the hidden thread to active.
      expect(await creditsBalance(t)).toBe(49);
      const threadBefore = await asUser.query(
        api.features.chat.threads.getThread,
        { threadId },
      );
      expect(threadBefore?.status).toBe('active');

      // Drain the scheduled title generation + response generation.
      await drainScheduled(t);

      const thread = await asUser.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread?.title).toBe('Spanish Greetings');
      // Now visible in the sidebar list.
      const listed = await asUser.query(
        api.features.chat.threads.listThreads,
        {},
      );
      expect(listed.map((th) => th._id)).toContain(threadId);

      const messages = await asUser.query(
        api.features.chat.messages.listMessages,
        { threadId, paginationOpts: { numItems: 20, cursor: null } },
      );
      const byRole = (role: string) =>
        messages.page.filter(
          (m: unknown) => (m as { role?: string }).role === role,
        );
      expect(byRole('user').map(textOf)).toEqual([
        'How do I greet someone in Spanish?',
      ]);
      expect(byRole('assistant').map(textOf)).toEqual(['¡Hola! Mock reply.']);
      // Zero reported cost stays within the prepaid credit: no extra charge.
      expect(await creditsBalance(t)).toBe(49);
    });

    it('offers markAlsoCorrect on a translate card turn', async () => {
      const t = setup();
      await seedUserWithCredits(t, 50);
      const cardId = await seedCardInActiveCourse(t, 'translate');
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      vi.useFakeTimers();
      await asUser.mutation(api.features.chat.messages.sendMessage, {
        threadId,
        prompt: 'Is my version also correct?',
        cardId,
      });
      await drainScheduled(t);

      expect(llm.toolNamesPerStep[0]).toContain('markAlsoCorrect');
    });

    it('withholds markAlsoCorrect on every turn of a transcribe course', async () => {
      // Not just the discussAnswer quick action: a plain free-text follow-up
      // must not be able to store an alternative either, because in
      // transcribe a differently-worded sentence is not what the audio said.
      const t = setup();
      await seedUserWithCredits(t, 50);
      const cardId = await seedCardInActiveCourse(t, 'transcribe');
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      vi.useFakeTimers();
      await asUser.mutation(api.features.chat.messages.sendMessage, {
        threadId,
        prompt: 'Is my version also correct?',
        cardId,
      });
      await drainScheduled(t);

      expect(llm.toolNamesPerStep[0]).not.toContain('markAlsoCorrect');
      // The rest of the card-turn toolset is untouched.
      expect(llm.toolNamesPerStep[0]).toContain('createCard');
    });

    it('only the first message triggers title generation', async () => {
      const t = setup();
      await seedUserWithCredits(t, 50);
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );

      llm.titleText = 'First Title';
      vi.useFakeTimers();
      await asUser.mutation(api.features.chat.messages.sendMessage, {
        threadId,
        prompt: 'first message',
      });
      await drainScheduled(t);
      expect(llm.generateCalls).toBe(1);

      llm.titleText = 'Second Title';
      await asUser.mutation(api.features.chat.messages.sendMessage, {
        threadId,
        prompt: 'second message',
      });
      await drainScheduled(t);

      // No second doGenerate call; the title from the first message stands.
      expect(llm.generateCalls).toBe(1);
      const thread = await asUser.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread?.title).toBe('First Title');
      // Two sends, one credit each, no extra cost charges.
      expect(await creditsBalance(t)).toBe(48);
    });

    it('enforces THREAD_MESSAGE_LIMIT counting user messages only', async () => {
      const t = setup();
      await seedUserWithCredits(t, 100);
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );

      // Freeze the scheduler: the user messages pile up without any
      // generated responses, proving the count is of USER messages.
      vi.useFakeTimers();
      for (let i = 0; i < THREAD_MESSAGE_LIMIT; i++) {
        await asUser.mutation(api.features.chat.messages.sendMessage, {
          threadId,
          prompt: `message ${i}`,
        });
      }
      await expectConvexErrorCode(
        asUser.mutation(api.features.chat.messages.sendMessage, {
          threadId,
          prompt: 'one over the limit',
        }),
        'THREAD_MESSAGE_LIMIT',
      );
    });
  });

  describe('generateResponse', () => {
    beforeEach(() => llm.reset());
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Seed a thread holding one user message, with the scheduler frozen so
     * the sendMessage-scheduled copy of generateResponse never runs — the
     * tests below invoke the action directly with controlled args.
     */
    async function seedThreadWithMessage(t: TestConvex<typeof schema>) {
      await seedUserWithCredits(t, 50);
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      vi.useFakeTimers();
      const promptMessageId = await asUser.mutation(
        api.features.chat.messages.sendMessage,
        { threadId, prompt: "What does 'hola' mean?" },
      );
      return { asUser, threadId, promptMessageId };
    }

    it('streams the reply into the thread and charges extra credits from the reported cost', async () => {
      const t = setup();
      const { asUser, threadId, promptMessageId } =
        await seedThreadWithMessage(t);
      expect(await creditsBalance(t)).toBe(49);

      llm.responseText = 'It means hello.';
      // $0.012 at $0.005/credit-step → ceil = 3 units, 1 prepaid → 2 extra.
      llm.providerMetadataPerStep = [
        { openrouter: { id: 'gen-1', usage: { cost: 0.012 } } },
      ];
      await t.action(internal.features.chat.messages.generateResponse, {
        threadId,
        promptMessageId,
        prompt: "What does 'hola' mean?",
        includeAiContent: false,
      });

      const messages = await asUser.query(
        api.features.chat.messages.listMessages,
        { threadId, paginationOpts: { numItems: 20, cursor: null } },
      );
      const assistant = messages.page.filter(
        (m: unknown) => (m as { role?: string }).role === 'assistant',
      );
      expect(assistant.map(textOf)).toEqual(['It means hello.']);
      expect(await creditsBalance(t)).toBe(47);
    });

    it('does not charge extra while the cost stays within the prepaid step', async () => {
      const t = setup();
      const { threadId, promptMessageId } = await seedThreadWithMessage(t);

      llm.providerMetadataPerStep = [
        { openrouter: { id: 'gen-2', usage: { cost: 0.004 } } },
      ];
      await t.action(internal.features.chat.messages.generateResponse, {
        threadId,
        promptMessageId,
        includeAiContent: false,
      });
      expect(await creditsBalance(t)).toBe(49);
    });

    it('swallows a mid-stream model failure: no throw, no reply text, no extra charge', async () => {
      const t = setup();
      const { asUser, threadId, promptMessageId } =
        await seedThreadWithMessage(t);

      // The agent's own onError marks the pending message failed and the
      // action still resolves; the outer catch never fires for this case.
      llm.failStream = true;
      await expect(
        t.action(internal.features.chat.messages.generateResponse, {
          threadId,
          promptMessageId,
          includeAiContent: false,
        }),
      ).resolves.toBeNull();

      const messages = await asUser.query(
        api.features.chat.messages.listMessages,
        { threadId, paginationOpts: { numItems: 20, cursor: null } },
      );
      const assistantTexts = messages.page
        .filter((m: unknown) => (m as { role?: string }).role === 'assistant')
        .map(textOf)
        .filter((text) => text.length > 0);
      expect(assistantTexts).toEqual([]);
      // The failed stream reported no usage → nothing extra is charged.
      expect(await creditsBalance(t)).toBe(49);
    });

    it('never throws on pre-stream failures: reports via trackException instead', async () => {
      const t = setup();
      const { threadId } = await seedThreadWithMessage(t);

      // A promptMessageId that is not a valid component id makes the agent
      // pipeline throw before any streaming starts — the catch swallows it
      // and reports through analytics so the dashboard still sees it.
      await expect(
        t.action(internal.features.chat.messages.generateResponse, {
          threadId,
          promptMessageId: 'not-a-message-id',
          languageSection: 'langs',
          difficultySection: 'difficulty',
          includeAiContent: false,
        }),
      ).resolves.toBeNull();

      expect(vi.mocked(posthog.captureException)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          additionalProperties: expect.objectContaining({
            op: 'chat.generateResponse',
            threadId,
          }),
        }),
      );
      expect(await creditsBalance(t)).toBe(49);
    });
  });

  describe('generateThreadTitle', () => {
    beforeEach(() => llm.reset());
    afterEach(() => {
      vi.useRealTimers();
    });

    async function seedThread(t: TestConvex<typeof schema>) {
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      return { asUser, threadId };
    }

    it('writes the generated title onto the thread', async () => {
      const t = setup();
      const { asUser, threadId } = await seedThread(t);
      llm.titleText = 'Greetings In Spanish';
      await t.action(internal.features.chat.messages.generateThreadTitle, {
        threadId,
        userMessage: 'how do I say hello?',
      });
      const thread = await asUser.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread?.title).toBe('Greetings In Spanish');
    });

    it('trims and caps the title at 80 characters', async () => {
      const t = setup();
      const { asUser, threadId } = await seedThread(t);
      llm.titleText = `  ${'x'.repeat(120)}  `;
      await t.action(internal.features.chat.messages.generateThreadTitle, {
        threadId,
        userMessage: 'hello',
      });
      const thread = await asUser.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread?.title).toBe('x'.repeat(80));
    });

    it('keeps the existing title when the model returns only whitespace', async () => {
      const t = setup();
      const { asUser, threadId } = await seedThread(t);
      llm.titleText = '   ';
      await t.action(internal.features.chat.messages.generateThreadTitle, {
        threadId,
        userMessage: 'hello',
      });
      const thread = await asUser.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread?.title).toBe('New Chat');
    });

    it('swallows LLM failures without touching the title', async () => {
      const t = setup();
      const { asUser, threadId } = await seedThread(t);
      llm.failGenerate = true;
      await expect(
        t.action(internal.features.chat.messages.generateThreadTitle, {
          threadId,
          userMessage: 'hello',
        }),
      ).resolves.toBeNull();
      const thread = await asUser.query(api.features.chat.threads.getThread, {
        threadId,
      });
      expect(thread?.title).toBe('New Chat');
    });
  });

  describe('retryResponse', () => {
    beforeEach(() => llm.reset());
    afterEach(() => {
      vi.useRealTimers();
    });

    type UiMessage = { id: string; role?: string; status?: string };

    async function listAssistant(
      asUser: ReturnType<TestConvex<typeof schema>['withIdentity']>,
      threadId: string,
    ) {
      const messages = await asUser.query(
        api.features.chat.messages.listMessages,
        { threadId, paginationOpts: { numItems: 20, cursor: null } },
      );
      return (messages.page as unknown as UiMessage[]).filter(
        (m) => m.role === 'assistant',
      );
    }

    /** A thread whose first tutor reply failed mid-stream (the scheduled
     *  generation ran against a model that threw), so the thread holds a
     *  user message and a failed assistant placeholder. */
    async function seedFailedTurn(t: TestConvex<typeof schema>) {
      await seedUserWithCredits(t, 50);
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      vi.useFakeTimers();
      await asUser.mutation(api.features.chat.messages.sendMessage, {
        threadId,
        prompt: "What does 'hola' mean?",
      });
      llm.failStream = true;
      await drainScheduled(t);
      llm.failStream = false;
      const [failed] = await listAssistant(asUser, threadId);
      expect(failed?.status).toBe('failed');
      return { asUser, threadId, failed };
    }

    it('generates the reply again for a failed turn without charging another credit', async () => {
      const t = setup();
      const { asUser, threadId, failed } = await seedFailedTurn(t);
      expect(await creditsBalance(t)).toBe(49);

      llm.responseText = 'It means hello.';
      await asUser.mutation(api.features.chat.messages.retryResponse, {
        threadId,
        messageId: failed.id,
      });
      await drainScheduled(t);

      const assistant = await listAssistant(asUser, threadId);
      // The failed placeholder is gone; the thread reads as one clean reply.
      expect(assistant.map((m) => m.status)).toEqual(['success']);
      expect(assistant.map(textOf)).toEqual(['It means hello.']);
      // The send prepaid this turn; the failed attempt cost nothing.
      expect(await creditsBalance(t)).toBe(49);
    });

    it('refuses a turn whose reply did not fail (no free regeneration)', async () => {
      const t = setup();
      await seedUserWithCredits(t, 50);
      const asUser = t.withIdentity({ subject: USER });
      const threadId = await asUser.mutation(
        api.features.chat.threads.getOrCreateEmptyThread,
        {},
      );
      vi.useFakeTimers();
      await asUser.mutation(api.features.chat.messages.sendMessage, {
        threadId,
        prompt: 'hi',
      });
      await drainScheduled(t);
      const [reply] = await listAssistant(asUser, threadId);
      expect(reply?.status).toBe('success');

      await expectConvexErrorCode(
        asUser.mutation(api.features.chat.messages.retryResponse, {
          threadId,
          messageId: reply.id,
        }),
        'NOT_RETRYABLE',
      );
      expect(llm.streamCalls).toBe(1);
    });

    it("refuses another user's thread", async () => {
      const t = setup();
      const { threadId, failed } = await seedFailedTurn(t);
      const asOther = t.withIdentity({ subject: 'user_B' });
      await expectConvexErrorCode(
        asOther.mutation(api.features.chat.messages.retryResponse, {
          threadId,
          messageId: failed.id,
        }),
        'NOT_FOUND',
      );
    });
  });
});
