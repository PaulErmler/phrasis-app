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
import {
  claimLlmTranslationIfAvailable,
  versioningChanges,
} from '../../features/llmTranslationQueue';
import type { WorkId } from '@convex-dev/workpool';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import {
  liveTranslation,
  translationRevisions,
} from '../../db/translationReads';
import { SOURCE_VERBATIM_TRANSLATION_SOURCE } from '../../../lib/translationProvenance';

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
      audioSpeakerGender: 'male',
      register: 'neutral',
      addresseeNumber: 'singular',
    });
    return { textId };
  });
}

/** The primary key of the seeded text in German: male voice, T form. */
const KEY = 'male|t';

const getClaim = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  targetLanguage = 'de',
  variantKey: string | undefined = KEY,
) =>
  t.run(async (ctx) =>
    ctx.db
      .query('llmTranslationClaims')
      .withIndex('by_text_language_variant', (q) =>
        q
          .eq('textId', textId)
          .eq('targetLanguage', targetLanguage)
          .eq('variantKey', variantKey),
      )
      .first(),
  );

const baseArgs = (textId: Id<'texts'>) => ({
  textId,
  sourceLanguage: 'en',
  targetLanguage: 'de',
  text: 'Have you looked in the glove compartment?',
  renderingKeys: [KEY],
});

describe('features/llmTranslationQueue', () => {
  describe('claimLlmTranslationIfAvailable', () => {
    const claim = (
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      priority?: 'interactive' | 'background',
    ) =>
      t.run(async (ctx) =>
        claimLlmTranslationIfAvailable(
          ctx as any,
          textId,
          'de',
          priority,
          KEY,
        ),
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
          variantKey: KEY,
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
          variantKey: KEY,
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
          variantKey: KEY,
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
          variantKey: KEY,
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
          variantKey: KEY,
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
          variantKey: KEY,
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
        claimIds: [{ key: KEY, claimId }],
      });
      const opts = call[3] as any;
      expect(getFunctionName(opts.onComplete)).toBe(
        'features/llmTranslationQueue:onLlmTranslationComplete',
      );
      // The context carries the keys the completion handler releases.
      expect(opts.context).toEqual({
        textId,
        sourceLanguage: 'en',
        targetLanguage: 'de',
        text: 'Have you looked in the glove compartment?',
        renderingKeys: [KEY],
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
          variantKey: KEY,
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
      expect(call[2]).toEqual({
        ...baseArgs(textId),
        claimIds: [{ key: KEY, claimId }],
      });
      // It does ride in the completion context.
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

    it('drops a key another live job owns and enqueues the rest', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          variantKey: 'male|v',
          claimedAt: Date.now() - 60_000,
          workId: 'live-owner',
        });
      });
      await t.mutation(
        internal.features.llmTranslationQueue.enqueueLlmTranslation,
        { args: { ...baseArgs(textId), renderingKeys: [KEY, 'male|v'] } },
      );
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect((mockEnqueue.mock.calls[0][2] as any).renderingKeys).toEqual([
        KEY,
      ]);
    });

    it('skips enqueueing when a fresh claim is owned by another live job', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          variantKey: KEY,
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
          variantKey: KEY,
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
            renderingKeys: [KEY],
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
          variantKey: KEY,
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
          variantKey: KEY,
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
          variantKey: KEY,
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
          variantKey: KEY,
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

    it('failed keeps the owned claim marked failed for the cooldown: there is no fallback producer', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      const claimId = await t.run(async (ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          variantKey: KEY,
          claimedAt: claimedBefore,
          workId: 'llm-w-1',
        }),
      );

      await complete(t, textId, 'llm-w-1', {
        kind: 'failed',
        error: 'stage chain failed',
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockWarmEnqueue).not.toHaveBeenCalled();
      const claim = await getClaim(t, textId);
      expect(claim?._id).toBe(claimId);
      expect(claim?.workId).toBeUndefined();
      expect(claim?.variantFailedAt).toBeGreaterThan(claimedBefore);
      // The held claim blocks a new attempt for the cooldown.
      const again = await t.run((ctx) =>
        claimLlmTranslationIfAvailable(ctx as any, textId, 'de', undefined, KEY),
      );
      expect(again).toBeNull();
    });

    it('failed marks every key the job rendered', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      for (const key of [KEY, 'male|v']) {
        await t.run((ctx) =>
          ctx.db.insert('llmTranslationClaims', {
            textId,
            targetLanguage: 'de',
            variantKey: key,
            claimedAt: Date.now() - 60_000,
            workId: 'llm-w-2',
          }),
        );
      }
      await t.mutation(
        internal.features.llmTranslationQueue.onLlmTranslationComplete,
        {
          workId: 'llm-w-2' as WorkId,
          context: {
            textId,
            sourceLanguage: 'en',
            targetLanguage: 'de',
            text: 'Hi.',
            renderingKeys: [KEY, 'male|v'],
          },
          result: { kind: 'failed', error: 'stage chain failed' },
        },
      );
      expect((await getClaim(t, textId, 'de', KEY))?.variantFailedAt).toBeDefined();
      expect(
        (await getClaim(t, textId, 'de', 'male|v'))?.variantFailedAt,
      ).toBeDefined();
    });

    it('failed on a superseded job (mismatched workId) leaves the foreign claim untouched', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          variantKey: KEY,
          claimedAt: claimedBefore,
          workId: 'newer-owner',
        });
      });

      await complete(t, textId, 'superseded', {
        kind: 'failed',
        error: 'stage chain failed',
      });

      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe('newer-owner');
      expect(claim?.claimedAt).toBe(claimedBefore);
      expect(claim?.variantFailedAt).toBeUndefined();
    });

    it('failed with the claim already gone does nothing', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await complete(t, textId, 'llm-w-1', {
        kind: 'failed',
        error: 'stage chain failed',
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(await getClaim(t, textId)).toBeNull();
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
          variantKey: KEY,
          claimedAt: Date.now(),
          workId: 'pool-w-1',
        });
      });

      mockGenerateTextOk('Haben Sie ins Handschuhfach geschaut?');

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        baseArgs(textId),
      );

      // Translations row created under the job's key (first stage won: the
      // Sol default is a single call, no sampling, no judge), then one
      // classifier call verified it.
      const translations = await t.run(async (ctx) =>
        translationRevisions(ctx, textId, 'de', KEY),
      );
      expect(translations.length).toBe(1);
      expect(translations[0].translatedText).toBe(
        'Haben Sie ins Handschuhfach geschaut?',
      );
      expect(translations[0].variantKey).toBe(KEY);
      expect(translations[0].speakerGender).toBe('male');
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);

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

      // No translation written, and the worker enqueued nothing itself:
      // the failure belongs to onLlmTranslationComplete after the pool's
      // retry budget is spent.
      const translations = await t.run(async (ctx) =>
        translationRevisions(ctx, textId, 'de', KEY),
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
        translationRevisions(ctx, textId, 'de', KEY),
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

      // Two translation calls, then the verification.
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(3);
      const translations = await t.run(async (ctx) =>
        translationRevisions(ctx, textId, 'de', KEY),
      );
      expect(translations.length).toBe(1);
      expect(translations[0].translatedText).toBe(
        'Haben Sie ins Handschuhfach geschaut?',
      );
    });

    it('verifies the wording against its key and retries once on a mismatch', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const classified = (gender: string, politeness: string) =>
        ({
          text: JSON.stringify([{ i: 1, gender, politeness }]),
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }) as any;
      const translated = (text: string) =>
        ({
          text,
          finishReason: 'stop',
          usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
        }) as any;
      vi.mocked(generateText)
        // The first wording came back in the Sie form for a T key.
        .mockResolvedValueOnce(translated('Haben Sie nachgeschaut?'))
        .mockResolvedValueOnce(classified('unmarked', 'polite'))
        // The retry honours the key.
        .mockResolvedValueOnce(translated('Hast du nachgeschaut?'))
        .mockResolvedValueOnce(classified('unmarked', 'casual'));

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        baseArgs(textId),
      );

      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(4);
      const retryPrompt = (vi.mocked(generateText).mock.calls[2][0] as any)
        .prompt as string;
      expect(retryPrompt).toContain('<prior>Haben Sie nachgeschaut?</prior>');
      const row = await t.run((ctx) => liveTranslation(ctx, textId, 'de', KEY));
      expect(row).toMatchObject({
        translatedText: 'Hast du nachgeschaut?',
        renderingVerified: true,
      });
    });

    it('a second mismatch is stored as it is, marked unverified', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      vi.mocked(generateText).mockResolvedValue({
        text: 'Haben Sie nachgeschaut?',
        finishReason: 'stop',
        usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
      } as any);
      vi.mocked(generateText)
        .mockResolvedValueOnce({
          text: 'Haben Sie nachgeschaut?',
          finishReason: 'stop',
          usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
        } as any)
        .mockResolvedValueOnce({
          text: JSON.stringify([{ i: 1, gender: 'unmarked', politeness: 'polite' }]),
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        } as any)
        .mockResolvedValueOnce({
          text: 'Haben Sie nachgeschaut?',
          finishReason: 'stop',
          usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
        } as any)
        .mockResolvedValueOnce({
          text: JSON.stringify([{ i: 1, gender: 'unmarked', politeness: 'polite' }]),
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        } as any);

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        baseArgs(textId),
      );
      const row = await t.run((ctx) => liveTranslation(ctx, textId, 'de', KEY));
      expect(row).toMatchObject({
        translatedText: 'Haben Sie nachgeschaut?',
        renderingVerified: false,
      });
    });

    it('renders the primary first and versions the other key from its wording, in one job', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const translated = (text: string) =>
        ({
          text,
          finishReason: 'stop',
          usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135 },
        }) as any;
      const ok = (politeness: string) =>
        ({
          text: JSON.stringify([{ i: 1, gender: 'unmarked', politeness }]),
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }) as any;
      vi.mocked(generateText)
        .mockResolvedValueOnce(translated('Hast du nachgeschaut?'))
        .mockResolvedValueOnce(ok('casual'))
        .mockResolvedValueOnce(translated('Haben Sie nachgeschaut?'))
        .mockResolvedValueOnce(ok('polite'));

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        // The versioned key first in the list: the worker still renders
        // the primary before it.
        { ...baseArgs(textId), renderingKeys: ['male|v', KEY] },
      );

      const versioningPrompt = (vi.mocked(generateText).mock.calls[2][0] as any)
        .prompt as string;
      expect(versioningPrompt).toContain(
        '<translation>Hast du nachgeschaut?</translation>',
      );
      expect(versioningPrompt).toContain('Polite · Sie');
      const primary = await t.run((ctx) =>
        liveTranslation(ctx, textId, 'de', KEY),
      );
      const versioned = await t.run((ctx) =>
        liveTranslation(ctx, textId, 'de', 'male|v'),
      );
      expect(primary?.translatedText).toBe('Hast du nachgeschaut?');
      expect(primary?.versionedFromText).toBeUndefined();
      expect(versioned).toMatchObject({
        translatedText: 'Haben Sie nachgeschaut?',
        versionedFromText: 'Hast du nachgeschaut?',
        renderingVerified: true,
      });
    });

    it('adopts the legacy row for the primary key when it verifies, without translating', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run((ctx) =>
        ctx.db.insert('translations', {
          textId,
          targetLanguage: 'de',
          translatedText: 'Hast du ins Handschuhfach geschaut?',
          romanizedText: '',
          translationSource: 'openai/gpt-5.6-sol:floor-minimal',
          speakerGender: 'male',
          translationVersion: 99,
        }),
      );
      vi.mocked(generateText).mockResolvedValueOnce({
        text: JSON.stringify([{ i: 1, gender: 'unmarked', politeness: 'casual' }]),
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      } as any);

      await t.action(
        internal.features.llmTranslationQueue.processLlmTranslationForCard,
        { ...baseArgs(textId), adoptLegacy: true },
      );

      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);
      const row = await t.run((ctx) => liveTranslation(ctx, textId, 'de', KEY));
      expect(row).toMatchObject({
        translatedText: 'Hast du ins Handschuhfach geschaut?',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        renderingVerified: true,
        variantKey: KEY,
      });
    });

    describe('accent rewrite (en sentence on an en_gb course)', () => {
      async function seedEnglish(t: TestConvex<typeof schema>, text: string) {
        return t.run(async (ctx) => {
          const collectionId = await ctx.db.insert('collections', {
            name: 'A1',
            textCount: 1,
          });
          return ctx.db.insert('texts', {
            text,
            language: 'en',
            userCreated: false,
            collectionId,
            collectionRank: 1,
            addressesSomeone: true,
            addresseeGender: 'male',
            referentGender: 'female',
            speakerGender: 'neutral',
            register: 'formal',
          });
        });
      }

      it('runs the rewrite prompt on the accent chain, whatever rule override the job carries', async () => {
        const t = convexTest(schema, modules);
        const textId = await seedEnglish(t, 'What is your favorite color?');
        mockGenerateTextOk('What is your favourite colour?');

        await t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          {
            textId,
            sourceLanguage: 'en',
            targetLanguage: 'en_gb',
            text: 'What is your favorite color?',
            ruleOverride: 'retranslation_high',
            renderingKeys: ['male|none'],
          },
        );

        const call = vi.mocked(generateText).mock.calls[0][0] as any;
        expect(call.model.modelId).toBe('openai/gpt-5.6-luna:nitro');
        expect(call.prompt).toContain('British readers');
        expect(call.prompt).toContain(
          '<source>What is your favorite color?</source>',
        );
        expect(call.prompt).not.toContain('<politeness_form>');
        expect(call.providerOptions.openrouter.reasoning).toEqual({
          enabled: false,
        });
        // An accent rewrite marks no axis, so no classifier call follows.
        expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);
        const row = await t.run((ctx) =>
          liveTranslation(ctx, textId, 'en_gb', 'male|none'),
        );
        expect(row).toMatchObject({
          translatedText: 'What is your favourite colour?',
          translationSource: 'openai/gpt-5.6-luna:nitro-none',
        });
      });

      it('stores an unchanged answer as a verbatim row, so the audio clip stays shared', async () => {
        const t = convexTest(schema, modules);
        const textId = await seedEnglish(t, 'Good afternoon.');
        mockGenerateTextOk('"Good afternoon."');

        await t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          {
            textId,
            sourceLanguage: 'en',
            targetLanguage: 'en_gb',
            text: 'Good afternoon.',
            renderingKeys: ['male|none'],
          },
        );

        const row = await t.run((ctx) =>
          liveTranslation(ctx, textId, 'en_gb', 'male|none'),
        );
        expect(row).toMatchObject({
          translatedText: 'Good afternoon.',
          translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
        });
      });

      it('a German sentence with an en_gb target is still a translation on the language rule', async () => {
        const t = convexTest(schema, modules);
        const textId = await t.run(async (ctx) => {
          const collectionId = await ctx.db.insert('collections', {
            name: 'custom',
            textCount: 1,
          });
          return ctx.db.insert('texts', {
            text: 'Guten Morgen',
            language: 'de',
            userCreated: true,
            userId: 'user_A',
            collectionId,
            collectionRank: 1,
            referentGender: 'male',
          });
        });
        mockGenerateTextOk('Good morning');

        await t.action(
          internal.features.llmTranslationQueue.processLlmTranslationForCard,
          {
            textId,
            sourceLanguage: 'de',
            targetLanguage: 'en_gb',
            text: 'Guten Morgen',
            renderingKeys: ['male|none'],
          },
        );

        const call = vi.mocked(generateText).mock.calls[0][0] as any;
        expect(call.prompt).toContain('translator');
        expect(call.prompt).not.toContain('British readers');
        const row = await t.run((ctx) =>
          liveTranslation(ctx, textId, 'en_gb', 'male|none'),
        );
        expect(row?.translationSource).not.toBe(
          SOURCE_VERBATIM_TRANSLATION_SOURCE,
        );
      });

      it('when every stage fails, onComplete stores the source text verbatim and releases the claim', async () => {
        const t = convexTest(schema, modules);
        const textId = await seedEnglish(t, 'Hello world');
        const claimId = await t.run((ctx) =>
          ctx.db.insert('llmTranslationClaims', {
            textId,
            targetLanguage: 'en_gb',
            variantKey: 'female|none',
            claimedAt: Date.now(),
            workId: 'llm-w-accent',
          }),
        );
        mockEnqueue.mockClear();

        await t.mutation(
          internal.features.llmTranslationQueue.onLlmTranslationComplete,
          {
            workId: 'llm-w-accent' as WorkId,
            context: {
              textId,
              sourceLanguage: 'en',
              targetLanguage: 'en_gb',
              text: 'Hello world',
              renderingKeys: ['female|none'],
            },
            result: { kind: 'failed', error: 'stage chain failed' },
          },
        );

        expect(mockEnqueue).not.toHaveBeenCalled();
        const row = await t.run((ctx) =>
          liveTranslation(ctx, textId, 'en_gb', 'female|none'),
        );
        expect(row).toMatchObject({
          translatedText: 'Hello world',
          translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
          speakerGender: 'female',
        });
        expect(await t.run((ctx) => ctx.db.get(claimId))).toBeNull();
      });
    });

    it('omits <addressee_gender> and any form tag from the prompt when addressesSomeone=false', async () => {
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
          renderingKeys: ['male|none'],
        },
      );

      // Inspect what was sent to OpenRouter.
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      const prompt = callArg.prompt as string;
      expect(prompt).not.toContain('<addressee_gender>');
      expect(prompt).not.toContain('<politeness_form>');
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
            renderingKeys: [KEY],
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

    it('resolves failed when the retry budget is spent', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const auditId = await seedAuditRow(t, textId);
      await t.run((ctx) =>
        ctx.db.insert('llmTranslationClaims', {
          textId,
          targetLanguage: 'de',
          variantKey: KEY,
          claimedAt: Date.now(),
          workId: 'llm-w-1',
        }),
      );

      await complete(t, textId, auditId, {
        kind: 'failed',
        error: 'stage chain failed',
      });

      expect(await getStatus(t, auditId)).toBe('failed');
    });
  });
});

describe('versioningChanges', () => {
  it('names only the axes the key changes on a language that marks them', () => {
    // Turkish: the voice changes but the wording never does.
    expect(versioningChanges('tr', 'female|v', 'male|v')).toEqual({
      form: false,
      gender: false,
    });
    // French inflects the first person: the voice change is a rewrite.
    expect(versioningChanges('fr', 'female|v', 'male|v')).toEqual({
      form: false,
      gender: true,
    });
    // Japanese: another form, the same voice.
    expect(versioningChanges('ja', 'male|plain', 'male|desu-masu')).toEqual({
      form: true,
      gender: false,
    });
    expect(versioningChanges('tr', 'female|none', 'male|none')).toEqual({
      form: false,
      gender: false,
    });
  });
});
