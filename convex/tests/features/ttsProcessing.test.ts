/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import schema from '../../schema';
import { internal } from '../../_generated/api';
import { Id } from '../../_generated/dataModel';

// Mock the Gemini validator at the module boundary so tests control its
// verdict without touching the OpenRouter SDK or network.
vi.mock('../../lib/ttsSemanticValidation', () => ({
  textsMatchSemantic: vi.fn(),
}));

// Mock the rate limiter at the module boundary. The real component requires
// `t.registerComponent` setup (flagged fragile in this project) and would
// pull in the @convex-dev/rate-limiter component's tables. Permissive
// defaults are (re)installed in the beforeEach below; tests that need a
// specific verdict override `mockLimit` / `mockCheck`.
vi.mock('../../rateLimiter', () => ({
  rateLimiter: {
    limit: vi.fn(),
    check: vi.fn(),
  },
  TTS_RATE_LIMIT_BY_PROVIDER: {
    google: 'googleTts',
    gemini: 'geminiTts',
  },
}));

// Cost events are asserted on (the backfill path emits its own `ai_cost`
// event); the rest of the module stays real so nothing else changes shape.
vi.mock('../../lib/posthogAi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/posthogAi')>()),
  captureGeneration: vi.fn(),
}));

import { textsMatchSemantic } from '../../lib/ttsSemanticValidation';
import { captureGeneration } from '../../lib/posthogAi';
import { rateLimiter } from '../../rateLimiter';
// The workpools are module-mocked globally (tests/convexTestSetup.ts, outside convex/ on purpose, see vitest.config.ts):
// `enqueueAction` is a vi.fn() resolving to unique fake workIds
// ('test-tts-work-N'), so tests can assert claim→workId stamping and drive
// the onComplete handlers by hand.
import { ttsPool, ttsWarmPool } from '@/convex/lib/workpools';
import type { WorkId } from '@convex-dev/workpool';
import { claimTtsIfAvailable } from '../../features/ttsProcessing';
import { resolveAudioPayload } from '../../lib/audioAssets';
import { insertAudioFixture } from '../lib/audioFixtures';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { getTtsProviderForLanguage } from '../../../lib/languages';
import { openrouterSttBody, isOpenrouterSttUrl } from '../lib/sttFixtures';

const mockSemantic = vi.mocked(textsMatchSemantic);
const mockCapture = vi.mocked(captureGeneration);
const mockLimit = vi.mocked(rateLimiter.limit);
const mockCheck = vi.mocked(rateLimiter.check);
const mockEnqueue = vi.mocked(ttsPool.enqueueAction);
const mockWarmEnqueue = vi.mocked(ttsWarmPool.enqueueAction);
const mockWarmCancel = vi.mocked(ttsWarmPool.cancel);

const modules = import.meta.glob('/convex/**/*.ts');

// Some flows still run 0ms scheduled work. Drain it inside the test context
// so its logs don't race vitest teardown.
drainSchedulerAfterEach();

beforeEach(() => {
  mockCapture.mockReset().mockResolvedValue(undefined);
  // Fresh call counts + permissive defaults per test: token reserves succeed
  // instantly unless a test overrides the verdicts.
  mockLimit.mockReset();
  mockLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
  mockCheck.mockReset();
  mockCheck.mockResolvedValue({ ok: true, retryAfter: 0 });
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
      text: 'Hola',
      language: 'es',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    return { textId };
  });
}

const getClaim = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  language = 'es',
) =>
  t.run(async (ctx) =>
    ctx.db
      .query('ttsGenerationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', textId).eq('language', language),
      )
      .first(),
  );

const baseJobArgs = (textId: Id<'texts'>) => ({
  textId,
  text: 'Hola',
  language: 'es',
  voiceName: 'es-ES-Chirp3-HD-Leda',
  voiceGender: 'female' as const,
  speed: 1,
});

describe('features/ttsProcessing', () => {
  describe('claimTtsIfAvailable', () => {
    const claim = (t: TestConvex<typeof schema>, textId: Id<'texts'>) =>
      t.run(async (ctx) => claimTtsIfAvailable(ctx as any, textId, 'es'));

    it("acquires and returns the new claim's id when none exists", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimId = await claim(t, textId);
      expect(claimId).not.toBeNull();
      const row = await getClaim(t, textId);
      expect(row?._id).toBe(claimId);
    });

    it('returns null while a fresh claim holds the slot', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
        });
      });
      expect(await claim(t, textId)).toBeNull();
    });

    it('interactive request takes over a fresh background-held claim and cancels the warm job', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const warmClaimId = await t.run(async (ctx) =>
        ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          priority: 'background',
          workId: 'warm-work-1',
        }),
      );
      const newId = await claim(t, textId);
      expect(newId).not.toBeNull();
      expect(newId).not.toBe(warmClaimId);
      expect(mockWarmCancel).toHaveBeenCalledTimes(1);
      expect(mockWarmCancel.mock.calls[0][1]).toBe('warm-work-1');
      const row = await getClaim(t, textId);
      expect(row?._id).toBe(newId);
      expect(row?.priority).toBeUndefined();
    });

    it('takes over a workId-less background claim (latch case) without cancelling anything', async () => {
      // A claim inserted whose enqueue subtransaction then failed latches
      // with no workId; interactive demand still reclaims it immediately.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          priority: 'background',
        });
      });
      expect(await claim(t, textId)).not.toBeNull();
      expect(mockWarmCancel).not.toHaveBeenCalled();
    });

    it('background request does NOT take over a fresh background-held claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          priority: 'background',
          workId: 'warm-work-2',
        });
      });
      const result = await t.run(async (ctx) =>
        claimTtsIfAvailable(ctx as any, textId, 'es', 'background'),
      );
      expect(result).toBeNull();
      expect(mockWarmCancel).not.toHaveBeenCalled();
    });

    it('a claim several minutes old is still fresh, staleness is 10 minutes', async () => {
      // Under the pre-workpool 30s window this claim would have been
      // reclaimed; the pool's guaranteed onComplete owns the release now, so
      // staleness is only a catastrophic backstop.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now() - 5 * 60 * 1000,
        });
      });
      expect(await claim(t, textId)).toBeNull();
    });

    it('reclaims a claim older than 10 minutes', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const staleId = await t.run(async (ctx) =>
        ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now() - 11 * 60 * 1000,
        }),
      );
      const newId = await claim(t, textId);
      expect(newId).not.toBeNull();
      expect(newId).not.toBe(staleId);
      const rows = await t.run(async (ctx) =>
        ctx.db.query('ttsGenerationClaims').collect(),
      );
      expect(rows.length).toBe(1);
      expect(rows[0]._id).toBe(newId);
    });
  });

  describe('releaseTtsClaim', () => {
    it('no-ops when no claim exists', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const res = await t.mutation(
        internal.features.ttsProcessing.releaseTtsClaim,
        { textId, language: 'es' },
      );
      expect(res).toBeNull();
    });

    it('deletes an existing claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
        });
      });
      await t.mutation(internal.features.ttsProcessing.releaseTtsClaim, {
        textId,
        language: 'es',
      });
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('leaves a pool-owned claim (workId set) untouched', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // A stale backfill's claim was reclaimed and stamped by a live pool job
      // mid-flight; the backfill's finally-release must not delete it. The
      // pool job's onComplete owns it now.
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          workId: 'pool-owner',
        });
      });
      await t.mutation(internal.features.ttsProcessing.releaseTtsClaim, {
        textId,
        language: 'es',
      });
      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe('pool-owner');
    });
  });

  describe('storeTtsMismatch', () => {
    it('inserts a mismatch row', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      await t.mutation(internal.features.ttsProcessing.storeTtsMismatch, {
        textId,
        language: 'es',
        voiceName: 'es-ES-Chirp3-HD-Leda',
        storageId,
        expectedText: 'Hola',
        transcribedText: 'Ola',
        attempt: 1,
      });
      const row = await t.run(async (ctx) =>
        ctx.db
          .query('ttsMismatches')
          .withIndex('by_textId', (q) => q.eq('textId', textId))
          .first(),
      );
      expect(row?.transcribedText).toBe('Ola');
      expect(row?.attempt).toBe(1);
    });
  });

  describe('updateAudioRecordingQuality', () => {
    it('no-ops when no audio row exists', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const res = await t.mutation(
        internal.features.ttsProcessing.updateAudioRecordingQuality,
        { textId, language: 'es', ttsQuality: 'validated' },
      );
      expect(res).toBeNull();
    });

    it('updates quality on an existing in-flight asset', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const { assetId } = await t.run(async (ctx) =>
        insertAudioFixture(ctx, {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId,
          ttsQuality: 'unknown',
        }),
      );
      await t.mutation(
        internal.features.ttsProcessing.updateAudioRecordingQuality,
        { textId, language: 'es', ttsQuality: 'validated' },
      );
      const updated = await t.run(async (ctx) => ctx.db.get(assetId));
      expect(updated?.ttsQuality).toBe('validated');
    });
  });

  describe('enqueueTtsJob', () => {
    it('enqueues processTTSForCard into ttsPool and stamps the workId onto the held claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: claimedBefore,
        });
      });

      await t.mutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: 'google',
        args: baseJobArgs(textId),
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const call = mockEnqueue.mock.calls[0];
      expect(getFunctionName(call[1])).toBe(
        'features/ttsProcessing:processTTSForCard',
      );
      expect(call[2]).toEqual({ ...baseJobArgs(textId), provider: 'google' });
      const opts = call[3] as any;
      expect(getFunctionName(opts.onComplete)).toBe(
        'features/ttsProcessing:onTtsJobComplete',
      );
      expect(opts.context).toEqual({ textId, language: 'es' });

      // The pool's workId is stamped onto the claim (same transaction) with a
      // fresh claimedAt, so the claim lives exactly as long as this pool job.
      const workId = await (mockEnqueue.mock.results[0]
        .value as Promise<string>);
      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe(workId);
      expect(claim?.claimedAt).toBeGreaterThan(claimedBefore);
    });

    it("routes priority 'background' into ttsWarmPool (and stamps the warm workId)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now() - 60_000,
        });
      });

      await t.mutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: 'google',
        args: { ...baseJobArgs(textId), priority: 'background' },
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockWarmEnqueue).toHaveBeenCalledTimes(1);
      // The worker also receives the priority so it picks the near-zero
      // rate-limit wait cap.
      expect(mockWarmEnqueue.mock.calls[0][2]).toEqual({
        ...baseJobArgs(textId),
        priority: 'background',
        provider: 'google',
      });
      const workId = await (mockWarmEnqueue.mock.results[0]
        .value as Promise<string>);
      expect((await getClaim(t, textId))?.workId).toBe(workId);
    });

    it('routes priority-less (interactive) jobs into ttsPool, not the warm pool', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: 'google',
        args: baseJobArgs(textId),
      });
      expect(mockWarmEnqueue).not.toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });

    it('still enqueues when no claim row exists (nothing to stamp)', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: 'google',
        args: baseJobArgs(textId),
      });
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('skips enqueueing when a fresh claim is owned by another live job', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const claimedBefore = Date.now() - 60_000;
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: claimedBefore,
          workId: 'live-owner',
        });
      });

      await t.mutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: 'google',
        args: baseJobArgs(textId),
      });

      // No duplicate synthesis, and the live owner keeps its claim.
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
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now() - 11 * 60 * 1000,
          workId: 'dead-owner',
        });
      });

      await t.mutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: 'google',
        args: baseJobArgs(textId),
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const workId = await (mockEnqueue.mock.results[0]
        .value as Promise<string>);
      const claim = await getClaim(t, textId);
      expect(claim?.workId).toBe(workId);
    });
  });

  describe('onTtsJobComplete', () => {
    const complete = (
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      workId: string,
      result:
        | { kind: 'success'; returnValue: null }
        | { kind: 'failed'; error: string }
        | { kind: 'canceled' },
    ) =>
      t.mutation(internal.features.ttsProcessing.onTtsJobComplete, {
        workId: workId as WorkId,
        context: { textId, language: 'es' },
        result,
      });

    it('success with matching workId deletes the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          workId: 'w-1',
        });
      });
      await complete(t, textId, 'w-1', { kind: 'success', returnValue: null });
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('failed with matching workId also deletes the claim (self-heal can re-drive)', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          workId: 'w-1',
        });
      });
      await complete(t, textId, 'w-1', { kind: 'failed', error: 'boom' });
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('canceled with matching workId deletes the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          workId: 'w-1',
        });
      });
      await complete(t, textId, 'w-1', { kind: 'canceled' });
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('a mismatched workId leaves a foreign claim untouched', async () => {
      // A superseded job's completion must not delete a newer owner's claim.
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
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

    it('a claim without a workId (legacy row) is deleted', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
        });
      });
      await complete(t, textId, 'w-1', { kind: 'success', returnValue: null });
      expect(await getClaim(t, textId)).toBeNull();
    });
  });

  describe('processTTSForCard', () => {
    /**
     * Run the worker action against fully mocked provider HTTP: Google TTS
     * returns fake audio, STT returns `opts.transcribed` (default:
     * the exact source text, i.e. validation passes strictly).
     */
    async function runPipeline(
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      opts: { transcribed?: string; sttStatus?: number } = {},
    ) {
      vi.stubEnv('GOOGLE_TTS_API_KEY', 'dummy');

      const transcribed = opts.transcribed ?? 'Hola';
      const googleBody = JSON.stringify({
        audioContent: Buffer.from('fake-mp3-bytes').toString('base64'),
      });
      const sttBody = openrouterSttBody(transcribed);
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('texttospeech.googleapis.com')) {
          return new Response(googleBody, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (isOpenrouterSttUrl(u)) {
          if (opts.sttStatus !== undefined && opts.sttStatus !== 200) {
            return new Response('{"error":"nope"}', {
              status: opts.sttStatus,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(sttBody, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.processTTSForCard, {
          textId,
          text: 'Hola',
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          provider: 'google' as const,
          voiceGender: 'female' as const,
          speed: 1,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
      return fetchMock;
    }

    // The pipeline writes thin pointer rows into the shared audioAssets
    // store. Resolve to the payload the row actually plays.
    async function getAudio(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
      return t.run(async (ctx) => {
        const row = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'es'),
          )
          .first();
        return row ? resolveAudioPayload(ctx, row) : null;
      });
    }

    async function getMismatches(
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
    ) {
      return t.run(async (ctx) =>
        ctx.db
          .query('ttsMismatches')
          .withIndex('by_textId', (q) => q.eq('textId', textId))
          .collect(),
      );
    }

    it('full pipeline: synthesizes, transcribes, validates and stores audio row', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      mockSemantic.mockReset();

      const fetchMock = await runPipeline(t, textId);

      const audio = await getAudio(t, textId);
      expect(audio?.ttsQuality).toBe('validated');
      expect(audio?.voiceName).toBe('es-ES-Chirp3-HD-Leda');
      expect(audio?.voiceGender).toBe('female');
      expect(audio?.speed).toBe(1);
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((c) => c.includes('texttospeech'))).toBe(true);
      expect(calls.some((c) => isOpenrouterSttUrl(c))).toBe(true);
    });

    it('a pool job leaves the claim in place, release belongs to onTtsJobComplete', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      mockSemantic.mockReset();
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
          workId: 'test-owner',
        });
      });

      await runPipeline(t, textId);

      const claim = await getClaim(t, textId);
      expect(claim).not.toBeNull();
      expect(claim?.workId).toBe('test-owner');
    });

    describe('validation retries', () => {
      it('attempt 1 strict passes → no Gemini call, no mismatch recorded', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();

        await runPipeline(t, textId, { transcribed: 'Hola' });

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe('validated');
        expect(mockSemantic).not.toHaveBeenCalled();
        expect((await getMismatches(t, textId)).length).toBe(0);
      });

      it('strict fails + Gemini match on attempt 1 → validated with no mismatch logged', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValueOnce('match');

        // Transcription differs by > 1 edit → strict fails; Gemini rescues it
        // before any mismatch row is written.
        await runPipeline(t, textId, { transcribed: 'Ola amigo' });

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe('validated');
        expect(mockSemantic).toHaveBeenCalledTimes(1);
        expect((await getMismatches(t, textId)).length).toBe(0);
      });

      it('both attempts strict+Gemini mismatch → unvalidated, 2 mismatches, 2 Gemini calls', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue('mismatch');

        await runPipeline(t, textId, { transcribed: 'Ola amigo' });

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe('unvalidated');
        // One Gemini call per attempt. Strict fails first, then Gemini runs.
        expect(mockSemantic).toHaveBeenCalledTimes(2);
        const mismatches = await getMismatches(t, textId);
        expect(mismatches.length).toBe(2);
        expect(mismatches.map((m) => m.attempt).sort()).toEqual([1, 2]);
      });

      it('STT itself failing keeps the clip: no re-synthesis, stored unchecked without timings', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();

        // A non-retryable STT status so the client throws at once (a 429
        // would take the same path after its backoff retries).
        const fetchMock = await runPipeline(t, textId, { sttStatus: 400 });

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe('unchecked');
        expect(audio?.wordTimings).toBeUndefined();
        expect(mockSemantic).not.toHaveBeenCalled();
        expect((await getMismatches(t, textId)).length).toBe(0);
        // One synthesis, not one per validation attempt.
        const calls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(calls.filter((c) => c.includes('texttospeech'))).toHaveLength(1);
      });

      it("Gemini error on every attempt → audio unvalidated (bad audio isn't silently accepted)", async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue('error');

        await runPipeline(t, textId, { transcribed: 'Ola amigo' });

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe('unvalidated');
        expect(mockSemantic).toHaveBeenCalledTimes(2);
        expect((await getMismatches(t, textId)).length).toBe(2);
      });

      it('Chinese homophone swap passes strict via pinyin match → no Gemini call', async () => {
        // Seed a Chinese text. seedText uses 'es', so insert a fresh one.
        const t = convexTest(schema, modules);
        const zhTextId = await t.run(async (ctx) => {
          const collectionId = await ctx.db.insert('collections', {
            name: 'A1',
            textCount: 1,
          });
          return ctx.db.insert('texts', {
            text: '他在家',
            language: 'zh',
            userCreated: false,
            collectionId,
            collectionRank: 1,
          });
        });
        mockSemantic.mockReset();

        vi.stubEnv('GOOGLE_TTS_API_KEY', 'dummy');
        const googleBody = JSON.stringify({
          audioContent: Buffer.from('fake').toString('base64'),
        });
        // STT transcription swaps 他 → 她 (same pinyin: "tā"). Strict
        // on hanzi would fail (edit distance 1 is the limit, but the
        // normalized hanzi are clearly different characters). Pinyin of
        // both is "tā zài jiā". Identical, so strict passes at
        // distance 0.
        const sttBody = openrouterSttBody('她在家');
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === 'string' ? url : url.toString();
          if (u.includes('texttospeech.googleapis.com')) {
            return new Response(googleBody, { status: 200 });
          }
          if (isOpenrouterSttUrl(u)) {
            return new Response(sttBody, { status: 200 });
          }
          throw new Error(`Unexpected fetch to ${u}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        try {
          await t.action(internal.features.ttsProcessing.processTTSForCard, {
            textId: zhTextId,
            text: '他在家',
            language: 'zh',
            voiceName: 'zh-CN-Chirp3-HD-Leda',
            provider: 'google' as const,
            voiceGender: 'female' as const,
            speed: 1,
          });
        } finally {
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }

        const audio = await t.run(async (ctx) => {
          const row = await ctx.db
            .query('audioRecordings')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', zhTextId).eq('language', 'zh'),
            )
            .first();
          return row ? resolveAudioPayload(ctx, row) : null;
        });
        expect(audio?.ttsQuality).toBe('validated');
        expect(mockSemantic).not.toHaveBeenCalled();
      });

      it('Serbian validates against the Latin-script transcript the model returns', async () => {
        // The app stores Serbian in Cyrillic; STT returns Latin whatever the
        // hint. The transcript is converted before the strict compare, so a
        // correct reading passes at distance 0 with no judge call.
        const t = convexTest(schema, modules);
        const srTextId = await t.run(async (ctx) => {
          const collectionId = await ctx.db.insert('collections', {
            name: 'A1',
            textCount: 1,
          });
          return ctx.db.insert('texts', {
            text: 'Данас је леп дан.',
            language: 'sr',
            userCreated: false,
            collectionId,
            collectionRank: 1,
          });
        });
        mockSemantic.mockReset();

        vi.stubEnv('GOOGLE_TTS_API_KEY', 'dummy');
        const googleBody = JSON.stringify({
          audioContent: Buffer.from('fake').toString('base64'),
        });
        const sttBody = openrouterSttBody('Danas je lep dan.', {
          words: [
            { word: 'Danas', start: 0, end: 0.3 },
            { word: 'je', start: 0.3, end: 0.4 },
            { word: 'lep', start: 0.4, end: 0.6 },
            { word: 'dan.', start: 0.6, end: 0.9 },
          ],
          language: 'sr',
        });
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === 'string' ? url : url.toString();
          if (u.includes('texttospeech.googleapis.com')) {
            return new Response(googleBody, { status: 200 });
          }
          if (isOpenrouterSttUrl(u)) {
            return new Response(sttBody, { status: 200 });
          }
          throw new Error(`Unexpected fetch to ${u}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        try {
          await t.action(internal.features.ttsProcessing.processTTSForCard, {
            textId: srTextId,
            text: 'Данас је леп дан.',
            language: 'sr',
            voiceName: 'sr-RS-Chirp3-HD-Leda',
            provider: 'google' as const,
            voiceGender: 'female' as const,
            speed: 1,
          });
        } finally {
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }

        const audio = await t.run(async (ctx) => {
          const row = await ctx.db
            .query('audioRecordings')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', srTextId).eq('language', 'sr'),
            )
            .first();
          return row ? resolveAudioPayload(ctx, row) : null;
        });
        expect(audio?.ttsQuality).toBe('validated');
        expect(mockSemantic).not.toHaveBeenCalled();
        // Stored timings carry the converted words, so they align with the
        // Cyrillic sentence they belong to.
        expect(audio?.wordTimings?.map((w) => w.word)).toEqual([
          'Данас',
          'је',
          'леп',
          'дан.',
        ]);
      });
    });

    describe('rate-limit token metering', () => {
      it('reserves a provider token for EVERY synthesis attempt, validation re-synthesis is metered', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue('mismatch');

        // Mismatch on both attempts → two syntheses (attempt 1 + validation
        // retry), each of which must reserve a googleTts token; each STT
        // validation call reserves an openrouterStt token.
        await runPipeline(t, textId, { transcribed: 'Ola amigo' });

        const limitBuckets = mockLimit.mock.calls.map((c) => c[1]);
        expect(limitBuckets.filter((b) => b === 'googleTts').length).toBe(2);
        expect(limitBuckets.filter((b) => b === 'openrouterStt').length).toBe(
          2,
        );
        // The fast-fail peek (non-consuming check) runs once per synthesis.
        const checkBuckets = mockCheck.mock.calls.map((c) => c[1]);
        expect(checkBuckets.filter((b) => b === 'googleTts').length).toBe(2);
      });

      it("throws without consuming a token when the bucket's projected wait exceeds the cap", async () => {
        // Bucket saturated: projected wait (60s) > TTS_TOKEN_MAX_WAIT_MS
        // (15s). The worker must throw (freeing its pool slot for other
        // providers) instead of sleeping. The pool's backoff retries later.
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockCheck.mockResolvedValue({ ok: true, retryAfter: 60_000 });

        const fetchMock = vi.fn(async () => {
          throw new Error('no HTTP call expected when the bucket is saturated');
        });
        vi.stubGlobal('fetch', fetchMock);
        try {
          await expect(
            t.action(internal.features.ttsProcessing.processTTSForCard, {
              ...baseJobArgs(textId),
              provider: 'google' as const,
            }),
          ).rejects.toThrow(/Rate limit googleTts busy/);
        } finally {
          vi.unstubAllGlobals();
        }

        expect(fetchMock).not.toHaveBeenCalled();
        // Fast-fail uses check (non-consuming) BEFORE limit. A rejected call
        // must not burn a reservation it walks away from.
        expect(mockLimit).not.toHaveBeenCalled();
      });

      it('a saturated openrouterStt bucket throws out of the worker instead of sleeping in-slot or accepting unvalidated audio', async () => {
        // The STT-validation reservation is capped too (STT_TOKEN_MAX_WAIT_MS)
        // and sits OUTSIDE the transcription try/catch: backpressure must
        // free the pool slot for the pool's backoff to retry, not burn a
        // re-synthesis and land the row at 'unknown' quality.
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockCheck.mockImplementation(async (_ctx, name) =>
          name === 'openrouterStt'
            ? { ok: true, retryAfter: 60_000 }
            : { ok: true, retryAfter: 0 },
        );

        vi.stubEnv('GOOGLE_TTS_API_KEY', 'dummy');
        const googleBody = JSON.stringify({
          audioContent: Buffer.from('fake-mp3-bytes').toString('base64'),
        });
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === 'string' ? url : url.toString();
          if (u.includes('texttospeech.googleapis.com')) {
            return new Response(googleBody, { status: 200 });
          }
          throw new Error(`No STT HTTP call expected when saturated: ${u}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        try {
          await expect(
            t.action(internal.features.ttsProcessing.processTTSForCard, {
              ...baseJobArgs(textId),
              provider: 'google' as const,
            }),
          ).rejects.toThrow(/Rate limit openrouterStt busy/);
        } finally {
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }

        // Synthesis ran once (its bucket was fine); the rejected STT reserve
        // consumed nothing.
        const limitBuckets = mockLimit.mock.calls.map((c) => c[1]);
        expect(limitBuckets.filter((b) => b === 'googleTts').length).toBe(1);
        expect(limitBuckets.filter((b) => b === 'openrouterStt').length).toBe(
          0,
        );
      });

      it('a provider 429 propagates to the pool, no self-re-enqueue', async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);

        vi.stubEnv('GOOGLE_TTS_API_KEY', 'dummy');
        const fetchMock = vi.fn(
          async () => new Response('quota exceeded', { status: 429 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        try {
          await expect(
            t.action(internal.features.ttsProcessing.processTTSForCard, {
              ...baseJobArgs(textId),
              provider: 'google' as const,
            }),
          ).rejects.toThrow();
        } finally {
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }

        // Retries are pool-owned: the worker neither schedules its own retry
        // nor enqueues a new pool job.
        const scheduled = await t.run((ctx) =>
          ctx.db.system.query('_scheduled_functions').collect(),
        );
        expect(
          scheduled.filter((s) => s.name.includes('enqueueTtsJob')).length,
        ).toBe(0);
        expect(mockEnqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe('scheduleMissingContent sweep', () => {
    // Swahili (sw) runs on Gemini, which per lib/ttsPrecedence.ts overrides
    // Google/Azure/ElevenLabs rows. Swahili-Tanzania (sw_tz) runs on Azure,
    // which overrides only ElevenLabs and leaves Google rows untouched. These
    // tests drive both branches via `prepareCardContent`.
    it("deletes a row whose ttsProvider is in the current provider's override list", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // Force a stable audioSpeakerGender so the sweep compares like-for-like.
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
      );
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const { rowId: audioId } = await t.run(async (ctx) =>
        insertAudioFixture(ctx, {
          textId,
          language: 'sw',
          voiceName: 'RILOU7YmBhvwJGDGjNmP', // ElevenLabs voice id (Jane)
          storageId,
          ttsQuality: 'validated',
          ttsProvider: 'elevenlabs',
          voiceGender: 'female',
          speed: 0.9,
        }),
      );

      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ['sw'],
        targetLanguages: ['sw'],
      });

      const left = await t.run(async (ctx) => ctx.db.get(audioId));
      expect(left).toBeNull();
    });

    it("keeps an existing row when the language's active provider doesn't override its provider", async () => {
      // yue is on MiniMax, whose override list never includes Gemini, so a
      // stray Gemini row for a MiniMax-routed language must be kept as-is.
      // (The fixture carries no ttsVersion stamp, so the "undefined ===
      // current" rule keeps it out of the version-stale sweep too; since bn /
      // zh_traditional / sw_tz moved to Gemini there is no active Azure
      // language left, so this is the remaining cross-provider keep case.)
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
      );
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const { rowId: audioId } = await t.run(async (ctx) =>
        insertAudioFixture(ctx, {
          textId,
          language: 'yue',
          voiceName: 'Leda',
          storageId,
          ttsQuality: 'validated',
          ttsProvider: 'gemini',
          voiceGender: 'female',
          speed: 0.9,
        }),
      );

      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ['yue'],
        targetLanguages: ['yue'],
      });

      const left = await t.run(async (ctx) => ctx.db.get(audioId));
      expect(left).not.toBeNull();
    });

    it('deletes a dangling pointer row whose asset is gone', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
      );
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const audioId = await t.run(async (ctx) => {
        const { assetId, rowId } = await insertAudioFixture(ctx, {
          textId,
          language: 'es',
          storageId,
          ttsQuality: 'validated',
        });
        // Simulate a dangling pointer (asset vanished out from under the row).
        await ctx.db.delete(assetId);
        return rowId;
      });

      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ['es'],
        targetLanguages: ['es'],
      });

      const left = await t.run(async (ctx) => ctx.db.get(audioId));
      expect(left).toBeNull();
    });

    it('schedules a backfill for an unchecked clip, and stops once its attempts are used up', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
      );
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const { assetId } = await t.run(async (ctx) =>
        insertAudioFixture(ctx, {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId,
          ttsQuality: 'unchecked',
          ttsProvider: getTtsProviderForLanguage('es'),
          voiceGender: 'female',
          // Timings present: only the verdict is missing.
          wordTimings: [{ word: 'Hola', start: 0, end: 0.4 }],
        }),
      );

      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ['en'],
        targetLanguages: ['es'],
      });
      // The backfill holds a TTS claim while scheduled.
      expect(await getClaim(t, textId)).not.toBeNull();

      // The same clip after three failed backfills: left alone.
      await t.run(async (ctx) => {
        const claims = await ctx.db.query('ttsGenerationClaims').collect();
        for (const c of claims) await ctx.db.delete(c._id);
        await ctx.db.patch(assetId, { revalidationAttempts: 3 });
      });
      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ['en'],
        targetLanguages: ['es'],
      });
      expect(await getClaim(t, textId)).toBeNull();
    });
  });

  describe('persistBackfilledWordTimings', () => {
    it('no-ops when no audio row exists', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const fakeStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      const res = await t.mutation(
        internal.features.ttsProcessing.persistBackfilledWordTimings,
        {
          textId,
          language: 'es',
          storageId: fakeStorageId,
          wordTimings: [{ word: 'hola', start: 0, end: 0.5 }],
        },
      );
      expect(res).toBeNull();
    });

    it('no-ops when storageId differs (stale-blob guard)', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const liveStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      const staleStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([2])])),
      );
      const { assetId } = await t.run(async (ctx) =>
        insertAudioFixture(ctx, {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId: liveStorageId,
          ttsQuality: 'validated',
        }),
      );
      await t.mutation(
        internal.features.ttsProcessing.persistBackfilledWordTimings,
        {
          textId,
          language: 'es',
          storageId: staleStorageId, // doesn't match the live asset
          wordTimings: [{ word: 'hola', start: 0, end: 0.5 }],
        },
      );
      const after = await t.run(async (ctx) => ctx.db.get(assetId));
      expect(after?.wordTimings).toBeUndefined();
    });

    it('patches wordTimings when storageId matches and leaves other fields intact', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      const { assetId } = await t.run(async (ctx) =>
        insertAudioFixture(ctx, {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId,
          ttsQuality: 'validated',
          voiceGender: 'female',
          speed: 0.9,
        }),
      );
      const wordTimings = [
        { word: 'hola', start: 0, end: 0.5 },
        { word: 'mundo', start: 0.5, end: 1.0 },
      ];
      await t.mutation(
        internal.features.ttsProcessing.persistBackfilledWordTimings,
        { textId, language: 'es', storageId, wordTimings },
      );
      const after = await t.run(async (ctx) => ctx.db.get(assetId));
      expect(after?.wordTimings).toEqual(wordTimings);
      expect(after?.voiceName).toBe('es-ES-Chirp3-HD-Leda');
      expect(after?.voiceGender).toBe('female');
      expect(after?.speed).toBe(0.9);
      expect(after?.ttsQuality).toBe('validated');
    });
  });

  describe('backfillWordTimings', () => {
    /** Insert audio row + TTS claim. Returns ids for use in the action call. */
    async function seedAudioAndClaim(
      t: TestConvex<typeof schema>,
      opts: {
        ttsQuality?: 'validated' | 'unchecked';
        spokenText?: string;
      } = {},
    ) {
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      await t.run(async (ctx) => {
        await insertAudioFixture(ctx, {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId,
          ttsQuality: opts.ttsQuality ?? 'validated',
          ...(opts.spokenText !== undefined
            ? { spokenText: opts.spokenText }
            : {}),
        });
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
        });
      });
      return { textId, storageId };
    }

    async function getAudio(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
      return t.run(async (ctx) => {
        const row = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'es'),
          )
          .first();
        return row ? resolveAudioPayload(ctx, row) : null;
      });
    }

    it('persists timings on success and releases the TTS claim', async () => {
      const t = convexTest(schema, modules);
      const { textId, storageId } = await seedAudioAndClaim(t);
      const sttBody = openrouterSttBody('Hola mundo', {
        words: [
          { word: 'Hola', start: 0, end: 0.4 },
          { word: 'mundo', start: 0.5, end: 1 },
        ],
      });
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (isOpenrouterSttUrl(u)) {
          return new Response(sttBody, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
          requestedByUserId: 'user_sweep',
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      const after = await getAudio(t, textId);
      expect(after?.wordTimings).toEqual([
        { word: 'Hola', start: 0, end: 0.4 },
        { word: 'mundo', start: 0.5, end: 1.0 },
      ]);
      expect(await getClaim(t, textId)).toBeNull();

      // The STT call is billed like every other pipeline call: one ai_cost
      // event, the provider's exact charge, attributed to the requester.
      const backfillEvents = mockCapture.mock.calls
        .map((c) => c[1])
        .filter((e) => e.feature === 'word_timing_backfill');
      expect(backfillEvents).toHaveLength(1);
      expect(backfillEvents[0]).toMatchObject({
        distinctId: 'user_sweep',
        provider: 'openrouter',
        model: 'microsoft/mai-transcribe-2',
        sharedContent: true,
        isError: false,
        extra: expect.objectContaining({
          language: 'es',
          word_count: 2,
          billed_seconds: 1,
          cost_source: 'usage',
        }),
      });
      expect(backfillEvents[0].costUsd).toBeCloseTo((1 / 3600) * 0.1, 10);
    });

    it('skips persistence on empty wordTimings but still releases the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId, storageId } = await seedAudioAndClaim(t);
      const fetchMock = vi.fn(
        async () =>
          new Response(openrouterSttBody('', { words: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      const after = await getAudio(t, textId);
      expect(after?.wordTimings).toBeUndefined();
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('returns early without calling STT when the storage blob is missing, but still releases the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
        });
        await ctx.storage.delete(storageId);
      });

      const fetchMock = vi.fn(async () => {
        throw new Error('STT should not be called when blob is missing');
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('still releases the claim when transcribeAudio throws, and bills the failed call', async () => {
      const t = convexTest(schema, modules);
      const { textId, storageId } = await seedAudioAndClaim(t);
      // 400 rather than 5xx: a 5xx is retried with a real backoff, which
      // this test has no reason to sit through.
      const fetchMock = vi.fn(
        async () =>
          new Response('boom', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      const after = await getAudio(t, textId);
      expect(after?.wordTimings).toBeUndefined();
      expect(await getClaim(t, textId)).toBeNull();

      const backfillEvents = mockCapture.mock.calls
        .map((c) => c[1])
        .filter((e) => e.feature === 'word_timing_backfill');
      expect(backfillEvents).toHaveLength(1);
      expect(backfillEvents[0]).toMatchObject({
        isError: true,
        error: expect.stringMatching(/OpenRouter STT API error: 400/),
        costUsd: undefined,
      });
    });

    describe('re-validation of an unchecked clip', () => {
      const mismatchRows = (
        t: TestConvex<typeof schema>,
        textId: Id<'texts'>,
      ) =>
        t.run(async (ctx) =>
          ctx.db
            .query('ttsMismatches')
            .withIndex('by_textId', (q) => q.eq('textId', textId))
            .collect(),
        );

      async function runBackfill(
        t: TestConvex<typeof schema>,
        textId: Id<'texts'>,
        storageId: Id<'_storage'>,
        stt: { transcribed?: string; status?: number },
      ) {
        const sttBody = openrouterSttBody(stt.transcribed ?? 'Hola', {
          words: [{ word: stt.transcribed ?? 'Hola', start: 0, end: 0.4 }],
        });
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === 'string' ? url : url.toString();
          if (isOpenrouterSttUrl(u)) {
            if (stt.status !== undefined && stt.status !== 200) {
              return new Response('{"error":"nope"}', { status: stt.status });
            }
            return new Response(sttBody, {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`Unexpected fetch to ${u}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        try {
          await t.action(internal.features.ttsProcessing.backfillWordTimings, {
            textId,
            language: 'es',
            storageId,
          });
        } finally {
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }
      }

      it('a matching transcript settles the clip as validated, with its timings', async () => {
        const t = convexTest(schema, modules);
        mockSemantic.mockReset();
        const { textId, storageId } = await seedAudioAndClaim(t, {
          ttsQuality: 'unchecked',
          spokenText: 'Hola',
        });

        await runBackfill(t, textId, storageId, { transcribed: 'Hola' });

        const after = await getAudio(t, textId);
        expect(after?.ttsQuality).toBe('validated');
        expect(after?.wordTimings).toEqual([
          { word: 'Hola', start: 0, end: 0.4 },
        ]);
        expect(await mismatchRows(t, textId)).toHaveLength(0);
        expect(await getClaim(t, textId)).toBeNull();
      });

      it('a mismatch settles the clip as unvalidated for good and records it', async () => {
        const t = convexTest(schema, modules);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue('mismatch');
        const { textId, storageId } = await seedAudioAndClaim(t, {
          ttsQuality: 'unchecked',
          spokenText: 'Hola',
        });

        await runBackfill(t, textId, storageId, {
          transcribed: 'Adios amigos',
        });

        const after = await getAudio(t, textId);
        expect(after?.ttsQuality).toBe('unvalidated');
        // Timings stored anyway, so nothing asks for this clip again.
        expect(after?.wordTimings).toHaveLength(1);
        expect(mockSemantic).toHaveBeenCalledTimes(1);
        expect(await mismatchRows(t, textId)).toHaveLength(1);
      });

      it('a failing STT counts an attempt; the third failure settles the clip as unvalidated', async () => {
        const t = convexTest(schema, modules);
        mockSemantic.mockReset();
        const { textId, storageId } = await seedAudioAndClaim(t, {
          ttsQuality: 'unchecked',
          spokenText: 'Hola',
        });

        for (let i = 1; i <= 3; i++) {
          if (!(await getClaim(t, textId))) {
            await t.run(async (ctx) => {
              await ctx.db.insert('ttsGenerationClaims', {
                textId,
                language: 'es',
                claimedAt: Date.now(),
              });
            });
          }
          await runBackfill(t, textId, storageId, { status: 400 });
          const after = await getAudio(t, textId);
          expect(after?.asset.revalidationAttempts).toBe(i);
          expect(after?.ttsQuality).toBe(i < 3 ? 'unchecked' : 'unvalidated');
        }
        expect(await getClaim(t, textId)).toBeNull();
      });
    });
  });
});
