/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getFunctionName } from 'convex/server';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => (modelSlug: string) => ({ modelId: modelSlug }),
}));

import { generateText } from 'ai';
import schema from '../../schema';
import { internal } from '../../_generated/api';
import { Id } from '../../_generated/dataModel';
// The workpools are module-mocked globally (tests/convexTestSetup.ts, outside convex/ on purpose, see vitest.config.ts):
// `enqueueAction` is a vi.fn() resolving to unique fake workIds
// ('test-llm-work-N'), so tests can assert claim→workId stamping and drive
// the onComplete handlers by hand.
import { llmPool, llmWarmPool } from '@/convex/lib/workpools';
import { claimLlmTranslationIfAvailable } from '../../features/llmTranslationQueue';
import type { WorkId } from '@convex-dev/workpool';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const mockEnqueue = vi.mocked(llmPool.enqueueAction);
const mockWarmEnqueue = vi.mocked(llmWarmPool.enqueueAction);
const mockWarmCancel = vi.mocked(llmWarmPool.cancel);

const modules = import.meta.glob('/convex/**/*.ts');

// Some flows (storeTranslationAndScheduleTTS) still run 0ms scheduled work.
// Drain it inside the test context so its logs don't race vitest teardown.
drainSchedulerAfterEach();

beforeEach(() => {
  // Clear calls only. The setup-file implementation (unique fake workIds)
  // must stay installed.
  mockEnqueue.mockClear();
  mockWarmEnqueue.mockClear();
  mockWarmCancel.mockClear();
});

async function seedText(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Have you looked in the glove compartment?',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
      addressesSomeone: true,
      addresseeGender: 'male',
      referentGender: 'female',
      speakerGender: 'neutral',
      register: 'neutral',
      addresseeNumber: 'singular',
    });
    return { textId };
  });
}

const getClaim = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  targetLanguage = 'de',
) =>
  t.run(async (ctx) =>
    ctx.db
      .query('llmTranslationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', textId).eq('targetLanguage', targetLanguage),
      )
      .first(),
  );

const baseArgs = (textId: Id<'texts'>) => ({
  textId,
  sourceLanguage: 'en',
  targetLanguage: 'de',
  text: 'Have you looked in the glove compartment?',
  audioSpeakerGender: 'male',
});

describe('features/llmTranslationQueue', () => {
  describe('claimLlmTranslationIfAvailable', () => {
    const claim = (
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      priority?: 'interactive' | 'background',
    ) =>
      t.run(async (ctx) =>
        claimLlmTranslationIfAvailable(ctx as any, textId, 'de', priority),
      );

    it("stamps the caller's tier onto the new claim", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimId = await claim(t, textId, 'background');
      const row = await getClaim(t, textId);
      expect(row?._id).toBe(claimId);
      expect(row?.priority).toBe('background');
    });

    it('returns null while a fresh interactive claim holds the slot', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
        });
      });
      expect(await claim(t, textId)).toBeNull();
    });

    it('interactive request takes over a fresh background-held claim and cancels the warm job', async () => {
      // The onboarding warmup translates exactly the texts a new user hits
      // first, so this collision is the normal path. Without takeover the
      // user's request no-ops and then waits out llmWarmPool's queue.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const warmClaimId = await t.run(async (ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          priority: 'background',
          workId: 'llm-warm-work-1',
        }),
      );

      const newId = await claim(t, textId);

      expect(newId).not.toBeNull();
      expect(newId).not.toBe(warmClaimId);
      expect(mockWarmCancel).toHaveBeenCalledTimes(1);
      expect(mockWarmCancel.mock.calls[0][1]).toBe('llm-warm-work-1');
      const row = await getClaim(t, textId);
      expect(row?._id).toBe(newId);
      expect(row?.priority).toBeUndefined();
    });

    it('takes over a workId-less background claim without cancelling anything', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          priority: 'background',
        });
      });
      expect(await claim(t, textId)).not.toBeNull();
      expect(mockWarmCancel).not.toHaveBeenCalled();
    });

    it("one warmup job does NOT take over another's fresh background claim", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          priority: 'background',
          workId: 'llm-warm-work-2',
        });
      });
      expect(await claim(t, textId, 'background')).toBeNull();
      expect(mockWarmCancel).not.toHaveBeenCalled();
    });

    it('reclaims a stale background claim without cancelling its dead job', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const staleId = await t.run(async (ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now() - 11 * 60 * 1000,
          priority: 'background',
          workId: 'llm-warm-work-3',
        }),
      );
      const newId = await claim(t, textId, 'background');
      expect(newId).not.toBeNull();
      expect(newId).not.toBe(staleId);
      expect(mockWarmCancel).not.toHaveBeenCalled();
    });
  });

  describe('enqueueLlmTranslation', () => {
    it('enqueues processLlmTranslationForCard into llmPool with a fallback-ready context and stamps the workId onto the held claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      const claimId = await t.run(async (ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: claimedBefore,
        }),
      );

      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        { args: { ...baseArgs(textId), replaceExisting: true } },
      );

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const call = mockEnqueue.mock.calls[0];
      expect(getFunctionName(call[1])).toBe(
        'features/llmTranslationQueue:processLlmTranslationForCard',
      );
      // The claim's _id rides along as the worker's single-writer token.
      expect(call[2]).toEqual({
        ...baseArgs(textId),
        replaceExisting: true,
        claimId,
      });
      const opts = call[3] as any;
      expect(getFunctionName(opts.onComplete)).toBe(
        'features/llmTranslationQueue:onLlmTranslationComplete',
      );
      // The context must carry everything the Google fallback needs to run.
      expect(opts.context).toEqual({
        textId,
        sourceLanguage: 'en',
        targetLanguage: 'de',
        text: 'Have you looked in the glove compartment?',
        audioSpeakerGender: 'male',
        replaceExisting: true,
      });

      const workId = await (mockEnqueue.mock.results[0]
        .value as Promise<string>);
      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe(workId);
      expect(claim?.claimedAt).toBeGreaterThan(claimedBefore);
    });

    it("routes an llmPriority 'background' job to llmWarmPool, keeping llmPool free for user-facing work", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimId = await t.run(async (ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now() - 60_000,
          priority: 'background',
        }),
      );

      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        { args: { ...baseArgs(textId), llmPriority: 'background' } },
      );

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockWarmEnqueue).toHaveBeenCalledTimes(1);
      const call = mockWarmEnqueue.mock.calls[0];
      expect(getFunctionName(call[1])).toBe(
        'features/llmTranslationQueue:processLlmTranslationForCard',
      );
      // The tier picked the pool and is not forwarded to the worker, which
      // makes no scheduling decisions of its own.
      expect(call[2]).toEqual({ ...baseArgs(textId), claimId });
      // It does ride in the completion context, so the Google fallback can't
      // jump onto the interactive pool.
      const opts = call[3] as any;
      expect(opts.context.llmPriority).toBe('background');

      const workId = await (mockWarmEnqueue.mock.results[0]
        .value as Promise<string>);
      expect((await getClaim(t, textId))?.workId).toBe(workId);
    });

    it('still enqueues when no claim is held (nothing to stamp)', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        { args: baseArgs(textId) },
      );
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('skips enqueueing when a fresh claim is owned by another live job', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: claimedBefore,
          workId: 'live-owner',
        });
      });

      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        { args: baseArgs(textId) },
      );

      // No duplicate job, and the live owner keeps its claim untouched.
      // This guard stops an enqueue that doesn't re-claim from hijacking an
      // in-flight job's claim.
      expect(mockEnqueue).not.toHaveBeenCalled();
      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe('live-owner');
      expect(claim?.claimedAt).toBe(claimedBefore);
    });

    it('re-enqueues over a STALE foreign-owned claim (dead owner) and re-stamps it', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now() - 11 * 60 * 1000,
          workId: 'dead-owner',
        });
      });

      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        { args: baseArgs(textId) },
      );

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const workId = await (mockEnqueue.mock.results[0]
        .value as Promise<string>);
      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe(workId);
    });
  });

  describe('onLlmTranslationComplete', () => {
    const complete = (
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      workId: string,
      result:
        | { kind: 'success'; returnValue: null }
        | { kind: 'failed'; error: string }
        | { kind: 'canceled' },
      llmPriority?: 'interactive' | 'background',
    ) =>
      t.mutation(
        internal.features.llmTranslationQueue.onLlmTranslationComplete,
        {
          workId: workId as WorkId,
          context: {
            textId,
            sourceLanguage: 'en',
            targetLanguage: 'de',
            text: 'Hi.',
            audioSpeakerGender: 'male',
            llmPriority,
          },
          result,
        },
      );

    it('success with matching workId deletes the claim and enqueues nothing', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          workId: 'llm-w-1',
        });
      });

      await complete(t, textId, 'llm-w-1', {
        kind: 'success',
        returnValue: null,
      });

      expect(await getClaim(t, textId)).toBeNull();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('canceled with matching workId deletes the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          workId: 'llm-w-1',
        });
      });

      await complete(t, textId, 'llm-w-1', { kind: 'canceled' });

      expect(await getClaim(t, textId)).toBeNull();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('success deletes a legacy claim without a workId', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
        });
      });

      await complete(t, textId, 'llm-w-1', {
        kind: 'success',
        returnValue: null,
      });

      expect(await getClaim(t, textId)).toBeNull();
    });

    it('success with a mismatched workId leaves a foreign claim untouched', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          workId: 'newer-owner',
        });
      });

      await complete(t, textId, 'superseded', {
        kind: 'success',
        returnValue: null,
      });

      const claim = await getClaim(t, textId);
      expect(claim).not.toBeNull();
      expect(claim?.workId).toBe('newer-owner');
    });

    it('failed enqueues the Google fallback and re-points the owned claim at it', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      const claimId = await t.run(async (ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: claimedBefore,
          workId: 'llm-w-1',
        }),
      );

      await complete(t, textId, 'llm-w-1', {
        kind: 'failed',
        error: 'stage chain failed',
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const call = mockEnqueue.mock.calls[0];
      expect(getFunctionName(call[1])).toBe(
        'features/decks:processTranslationForCard',
      );
      expect(call[2]).toEqual({
        textId,
        sourceLanguage: 'en',
        targetLanguage: 'de',
        text: 'Hi.',
        audioSpeakerGender: 'male',
        // The re-pointed claim keeps its _id, so the fallback inherits the
        // same single-writer token.
        claimId,
      });
      const opts = call[3] as any;
      // The fallback runs on its own tighter retry budget (last resort).
      expect(opts.retry).toEqual({
        maxAttempts: 3,
        initialBackoffMs: 2_000,
        base: 3,
      });
      expect(getFunctionName(opts.onComplete)).toBe(
        'features/llmTranslationQueue:onGoogleFallbackComplete',
      );
      expect(opts.context).toEqual({ textId, targetLanguage: 'de' });

      // Claim survives, re-pointed at the fallback job with fresh claimedAt,
      // so a concurrent reconcile can't re-route the row mid-fallback.
      const fallbackWorkId = await (mockEnqueue.mock.results[0]
        .value as Promise<string>);
      const claim = await getClaim(t, textId);
      expect(claim?._id).toBe(claimId);
      expect(claim?.workId).toBe(fallbackWorkId);
      expect(claim?.claimedAt).toBeGreaterThan(claimedBefore);
    });

    it('failed on a background job keeps the Google fallback on llmWarmPool', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimId = await t.run(async (ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now() - 60_000,
          priority: 'background',
          workId: 'llm-warm-w-1',
        }),
      );

      await complete(
        t,
        textId,
        'llm-warm-w-1',
        { kind: 'failed', error: 'stage chain failed' },
        'background',
      );

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockWarmEnqueue).toHaveBeenCalledTimes(1);
      expect(getFunctionName(mockWarmEnqueue.mock.calls[0][1])).toBe(
        'features/decks:processTranslationForCard',
      );
      const fallbackWorkId = await (mockWarmEnqueue.mock.results[0]
        .value as Promise<string>);
      const claim = await getClaim(t, textId);
      expect(claim?._id).toBe(claimId);
      expect(claim?.workId).toBe(fallbackWorkId);
    });

    it('failed on a superseded job (mismatched workId) skips the fallback and leaves the foreign claim untouched', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: claimedBefore,
          workId: 'newer-owner',
        });
      });

      await complete(t, textId, 'superseded', {
        kind: 'failed',
        error: 'stage chain failed',
      });

      // The newer owner drives its own fallback; an orphan fallback here
      // would race its write and duplicate provider spend.
      expect(mockEnqueue).not.toHaveBeenCalled();
      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe('newer-owner');
      expect(claim?.claimedAt).toBe(claimedBefore);
    });

    it('failed with the claim already gone skips the fallback', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await complete(t, textId, 'llm-w-1', {
        kind: 'failed',
        error: 'stage chain failed',
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('onGoogleFallbackComplete', () => {
    const complete = (
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      workId: string,
      result:
        | { kind: 'success'; returnValue: null }
        | { kind: 'failed'; error: string }
        | { kind: 'canceled' },
    ) =>
      t.mutation(
        internal.features.llmTranslationQueue.onGoogleFallbackComplete,
        {
          workId: workId as WorkId,
          context: { textId, targetLanguage: 'de' },
          result,
        },
      );

    it('success with matching workId deletes the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          workId: 'g-w-1',
        });
      });

      await complete(t, textId, 'g-w-1', {
        kind: 'success',
        returnValue: null,
      });

      expect(await getClaim(t, textId)).toBeNull();
    });

    it('terminal failure KEEPS the claim (staleness window acts as re-drive backoff)', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          workId: 'g-w-1',
        });
      });

      await complete(t, textId, 'g-w-1', {
        kind: 'failed',
        error: 'google also failed',
      });

      const claim = await getClaim(t, textId);
      expect(claim).not.toBeNull();
      expect(claim?.workId).toBe('g-w-1');
    });

    it('success with a mismatched workId leaves a foreign claim untouched', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          workId: 'newer-owner',
        });
      });

      await complete(t, textId, 'superseded', {
        kind: 'success',
        returnValue: null,
      });

      expect((await getClaim(t, textId))?.workId).toBe('newer-owner');
    });
  });

  describe('processLlmTranslationForCard (action)', () => {
    const originalKey = process.env.OPENROUTER_API_KEY;

    beforeEach(() => {
      vi.mocked(generateText).mockReset();
      process.env.OPENROUTER_API_KEY = 'test-key';
    });
    afterEach(() => {
      if (originalKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalKey;
      }
    });

    function mockGenerateTextOk(
      content: string,
      finishReason: string = 'stop',
    ) {
      vi.mocked(generateText).mockResolvedValue({
        text: content,
        finishReason,
        usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
      } as any);
    }

    it('on LLM success: writes a translations row and leaves the claim for onComplete', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      // The claim belongs to the pool job. The worker must not touch it.
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          claimedAt: Date.now(),
          workId: 'pool-w-1',
        });
      });

      mockGenerateTextOk('Haben Sie ins Handschuhfach geschaut?');

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        baseArgs(textId),
      );

      // Translations row created (first stage won: the Sol default is a
      // single call, no sampling, no judge).
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'de'),
          )
          .collect(),
      );
      expect(translations.length).toBe(1);
      expect(translations[0].translatedText).toBe(
        'Haben Sie ins Handschuhfach geschaut?',
      );
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);

      // Claim untouched. Release is onLlmTranslationComplete's job.
      const claim = await getClaim(t, textId);
      expect(claim).not.toBeNull();
      expect(claim?.workId).toBe('pool-w-1');
    });

    it('returns success (null) without calling the LLM when the text row was cascade-deleted', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.delete(textId);
      });

      await expect(
        t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          baseArgs(textId),
        ),
      ).resolves.toBeNull();

      expect(vi.mocked(generateText)).not.toHaveBeenCalled();
    });

    it('on truncation (finishReason=length) on every stage: THROWS, the pool owns retries', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      vi.mocked(generateText).mockResolvedValue({
        text: '',
        finishReason: 'length',
        usage: { inputTokens: 120, outputTokens: 5000, totalTokens: 5120 },
      } as any);

      await expect(
        t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          baseArgs(textId),
        ),
      ).rejects.toThrow(/stage chain failed/);

      // 'de' resolves to the sol_minimal chain: Sol floor + Sol standard
      // (one call each) + 3 parallel Luna bo3 candidates (all truncated → no
      // judge) + the single-call Gemini fallback. All tried before the
      // worker gives up and throws.
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(6);

      // No translation written, and the worker did NOT enqueue the Google
      // fallback itself. That belongs to onLlmTranslationComplete after the
      // pool's retry budget is spent.
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'de'),
          )
          .collect(),
      );
      expect(translations.length).toBe(0);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('on empty response on every stage: THROWS', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      vi.mocked(generateText).mockResolvedValue({
        text: '',
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      } as any);

      await expect(
        t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          { ...baseArgs(textId), text: 'Hi.' },
        ),
      ).rejects.toThrow(/stage chain failed/);
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(6);
    });

    it('on HTTP error on every stage: THROWS', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      vi.mocked(generateText).mockRejectedValue(
        new Error('status=500 internal server error'),
      );

      await expect(
        t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          { ...baseArgs(textId), text: 'Hi.' },
        ),
      ).rejects.toThrow(/stage chain failed/);
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(6);

      const translations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'de'),
          )
          .collect(),
      );
      expect(translations.length).toBe(0);
    });

    it('a stage failure followed by a fallback-stage success still writes the translation', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      // The Sol floor (flex) stage truncates, then the Sol standard-endpoint
      // fallback succeeds: the sentence stays on Sol, one retry later.
      const truncated = {
        text: '',
        finishReason: 'length',
        usage: { inputTokens: 120, outputTokens: 5000, totalTokens: 5120 },
      } as any;
      vi.mocked(generateText)
        .mockResolvedValueOnce(truncated)
        .mockResolvedValueOnce({
          text: 'Haben Sie ins Handschuhfach geschaut?',
          finishReason: 'stop',
          usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
        } as any);

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        baseArgs(textId),
      );

      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
      const translations = await t.run(async (ctx) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'de'),
          )
          .collect(),
      );
      expect(translations.length).toBe(1);
      expect(translations[0].translatedText).toBe(
        'Haben Sie ins Handschuhfach geschaut?',
      );
    });

    it('a non-openrouter language reaching the worker throws a NonRetryableError without calling the LLM', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await expect(
        t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          // Unknown language → translation config resolves to the Google
          // provider, which must never reach the LLM worker.
          { ...baseArgs(textId), targetLanguage: 'xx' },
        ),
      ).rejects.toThrow(/non-openrouter language reached worker/);

      expect(vi.mocked(generateText)).not.toHaveBeenCalled();
    });

    it('omits <addressee_gender> and <register> from the prompt when addressesSomeone=false', async () => {
      const t = convexTest(schema, modules);
      // Seed a descriptive sentence, addressesSomeone=false.
      const { textId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'It is raining today.',
          language: 'en',
          userCreated: false,
          collectionId,
          collectionRank: 1,
          addressesSomeone: false,
          addresseeNumber: 'not_applicable',
          referentGender: 'male',
        });
        return { textId };
      });

      mockGenerateTextOk('Es regnet heute.');

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        {
          textId,
          sourceLanguage: 'en',
          targetLanguage: 'de',
          text: 'It is raining today.',
        },
      );

      // Inspect what was sent to OpenRouter.
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      const prompt = callArg.prompt as string;
      expect(prompt).not.toContain('<addressee_gender>');
      expect(prompt).not.toContain('<register>');
      // But <referent_gender> is always present.
      expect(prompt).toContain('<referent_gender>male</referent_gender>');
    });
  });

  describe('retranslation audit resolution at the completion tail', () => {
    /**
     * A pending cardEditRetranslations row plus the minimum scaffolding its
     * schema demands. Hand-inserted rather than driven through editCard: these
     * tests exercise the pool's onComplete handlers in isolation, and the
     * write choke point's own resolution paths are covered in
     * cardEditAudit.test.ts.
     */
    async function seedAuditRow(
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      status: 'enqueued' | 'applied' = 'enqueued',
    ) {
      return t.run(async (ctx) => {
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en'],
          targetLanguages: ['de'],
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          // The card's collection is whatever collection the text was seeded
          // into (required field since the collection-origin narrowing).
          collectionId: (await ctx.db.get(textId))!.collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now(),
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        const cardEditId = await ctx.db.insert('cardEdits', {
          userId: 'user_A',
          courseId,
          kind: 'manual_edit',
          path: 'in_place',
          cardIdBefore: cardId,
          cardIdAfter: cardId,
          textIdBefore: textId,
          textIdAfter: textId,
          textWasUserCreated: false,
          sourceLanguage: 'en',
          sourceText: 'Hi.',
          baseLanguages: ['en'],
          targetLanguages: ['de'],
          changes: [],
        });
        const auditId = await ctx.db.insert('cardEditRetranslations', {
          cardEditId,
          userId: 'user_A',
          language: 'de',
          role: 'target',
          textId,
          sourceLanguage: 'en',
          sourceText: 'Hi.',
          beforeText: 'Hallo.',
          flagCountAfter: 1,
          status,
        });
        return auditId;
      });
    }

    const complete = (
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      auditId: Id<'cardEditRetranslations'>,
      result:
        | { kind: 'success'; returnValue: null }
        | { kind: 'failed'; error: string }
        | { kind: 'canceled' },
    ) =>
      t.mutation(
        internal.features.llmTranslationQueue.onLlmTranslationComplete,
        {
          workId: 'llm-w-1' as WorkId,
          context: {
            textId,
            sourceLanguage: 'en',
            targetLanguage: 'de',
            text: 'Hi.',
            audioSpeakerGender: 'male',
            retranslationAuditId: auditId,
          },
          result,
        },
      );

    const getStatus = (
      t: TestConvex<typeof schema>,
      auditId: Id<'cardEditRetranslations'>,
    ) => t.run(async (ctx) => (await ctx.db.get(auditId))?.status);

    it('resolves a still-pending row as dropped_text_deleted when the text vanished mid-flight', async () => {
      // The worker returns SUCCESS for a cascade-deleted text without ever
      // reaching the write choke point, so the row would otherwise read
      // "still in flight" in the admin QC view forever.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const auditId = await seedAuditRow(t, textId);
      await t.run(async (ctx) => ctx.db.delete(textId));

      await complete(t, textId, auditId, {
        kind: 'success',
        returnValue: null,
      });

      expect(await getStatus(t, auditId)).toBe('dropped_text_deleted');
    });

    it('resolves a still-pending row as failed when the job was canceled', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const auditId = await seedAuditRow(t, textId);

      await complete(t, textId, auditId, { kind: 'canceled' });

      expect(await getStatus(t, auditId)).toBe('failed');
    });

    it('never overwrites the verdict the write choke point already recorded', async () => {
      // The normal success path: storeTranslationAndScheduleTTS stamped
      // 'applied' before this onComplete ran. The tail cleanup must be a
      // no-op, not a downgrade to 'failed'.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const auditId = await seedAuditRow(t, textId, 'applied');

      await complete(t, textId, auditId, {
        kind: 'success',
        returnValue: null,
      });

      expect(await getStatus(t, auditId)).toBe('applied');
    });

    it('resolves failed on terminal Google-fallback failure', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const auditId = await seedAuditRow(t, textId);

      await t.mutation(
        internal.features.llmTranslationQueue.onGoogleFallbackComplete,
        {
          workId: 'google-w-1' as WorkId,
          context: {
            textId,
            targetLanguage: 'de',
            retranslationAuditId: auditId,
          },
          result: { kind: 'failed', error: 'quota' },
        },
      );

      expect(await getStatus(t, auditId)).toBe('failed');
    });
  });
});
