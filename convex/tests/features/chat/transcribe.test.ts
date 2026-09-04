import { convexTest, type TestConvex } from 'convex-test';
import { ConvexError, type Value } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import schema from '../../../schema';
import { api } from '../../../_generated/api';
import { MP4_HEADER, WAV_HEADER, WEBM_HEADER } from '../../lib/sttFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * transcribeAudio's order of operations and language handling: the
 * container gate runs before the quota, writing-mode dictation pins one
 * language, chat voice input auto-detects, and the transcript comes back in
 * the script the app expects. The STT vendor call itself is mocked; the
 * script helpers run for real.
 */

const runSttMock = vi.hoisted(() => vi.fn());
const reserveSlotMock = vi.hoisted(() => vi.fn());
const captureMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/stt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/stt')>();
  return {
    ...actual,
    transcribeAudio: runSttMock,
    reserveSttSlot: reserveSlotMock,
  };
});
vi.mock('../../../lib/posthogAi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/posthogAi')>()),
  captureGeneration: captureMock,
}));

async function seedCourse(
  t: TestConvex<typeof schema>,
  baseLanguages: string[],
  targetLanguages: string[],
) {
  await t.run(async (ctx) => {
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages,
      targetLanguages,
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
  });
}

async function seedQuota(t: TestConvex<typeof schema>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        transcriptions: {
          balance: 10,
          included: 10,
          used: 0,
          unlimited: false,
        },
      },
      lastSyncedAt: Date.now(),
    });
  });
}

async function quotaBalance(t: TestConvex<typeof schema>) {
  const doc = await t.run(async (ctx) =>
    ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
      .unique(),
  );
  return doc!.features.transcriptions.balance;
}

// Fresh buffers per call: `v.bytes()` args are transferred, not shared.
const wavBytes = () => WAV_HEADER.slice().buffer;
const WEBM_BYTES = WEBM_HEADER.slice().buffer;
const MP4_BYTES = MP4_HEADER.slice().buffer;

/** The structured code a rejected action carried, whatever shape convex-test hands it back in. */
async function rejectionCode(
  pending: Promise<unknown>,
): Promise<string | undefined> {
  const err: unknown = await pending.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConvexError);
  const data = (err as ConvexError<Value>).data;
  const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;
  return (parsed as { code?: string } | null)?.code;
}

const sttResult = (overrides: Record<string, unknown> = {}) => ({
  text: 'hola',
  wordTimings: [],
  audioDurationMs: 900,
  billedSeconds: 1,
  costUsd: 0.0000278,
  detectedLanguage: 'es',
  ...overrides,
});

describe('features/chat/transcribe', () => {
  beforeEach(() => {
    runSttMock.mockReset();
    reserveSlotMock.mockReset().mockResolvedValue(undefined);
    captureMock.mockReset().mockResolvedValue(undefined);
    runSttMock.mockResolvedValue(sttResult());
  });

  it('forwards a pinned language to the vendor with a single retry', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    const text = await asUser.action(
      api.features.chat.transcribe.transcribeAudio,
      { audio: wavBytes(), mimeType: 'audio/wav', language: 'es_mixed' },
    );

    expect(text).toBe('hola');
    expect(runSttMock).toHaveBeenCalledTimes(1);
    const [blob, language, opts] = runSttMock.mock.calls[0];
    expect((blob as Blob).type).toBe('audio/wav');
    expect(language).toBe('es_mixed');
    expect(opts).toEqual({ maxRetries: 1 });
    expect(reserveSlotMock).toHaveBeenCalledTimes(1);
  });

  it('bills the call with the exact cost OpenRouter reported', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: wavBytes(),
      language: 'es',
    });

    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][1]).toMatchObject({
      distinctId: 'user_A',
      feature: 'chat_voice_input',
      provider: 'openrouter',
      model: 'microsoft/mai-transcribe-2',
      costUsd: 0.0000278,
      extra: expect.objectContaining({
        billed_seconds: 1,
        cost_source: 'usage',
        detected_language: 'es',
        pinned_language: 'es',
        transcript_chars: 4,
      }),
    });
  });

  it('falls back to the rate table when the response carries no cost', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });
    runSttMock.mockResolvedValue(
      sttResult({ costUsd: undefined, billedSeconds: 2 }),
    );

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: wavBytes(),
      language: 'es',
    });

    const event = captureMock.mock.calls[0][1];
    expect(event.costUsd).toBeCloseTo((2 / 3600) * 0.1, 10);
    expect(event.extra.cost_source).toBe('rate_table');
  });

  it('auto-detects (no language) when none is pinned', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['en'], ['sv']);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: wavBytes(),
      mimeType: 'audio/wav',
    });

    const [, language] = runSttMock.mock.calls[0];
    expect(language).toBeUndefined();
  });

  it('rejects WebM before the quota is consumed or the vendor is called', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    expect(
      await rejectionCode(
        asUser.action(api.features.chat.transcribe.transcribeAudio, {
          audio: WEBM_BYTES,
          mimeType: 'audio/webm;codecs=opus',
        }),
      ),
    ).toBe('UNSUPPORTED_AUDIO');

    expect(runSttMock).not.toHaveBeenCalled();
    expect(await quotaBalance(t)).toBe(10);
  });

  it('rejects MP4 the same way', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    expect(
      await rejectionCode(
        asUser.action(api.features.chat.transcribe.transcribeAudio, {
          audio: MP4_BYTES,
          mimeType: 'audio/mp4',
        }),
      ),
    ).toBe('UNSUPPORTED_AUDIO');

    expect(runSttMock).not.toHaveBeenCalled();
    expect(await quotaBalance(t)).toBe(10);
  });

  it('consumes a transcription unit before calling the vendor', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: wavBytes(),
      language: 'es',
    });

    expect(await quotaBalance(t)).toBe(9);
  });

  it('surfaces a vendor failure once, with no action-level retry', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['en'], ['sv']);
    const asUser = t.withIdentity({ subject: 'user_A' });

    runSttMock.mockRejectedValue(new Error('OpenRouter STT API error: 500'));

    await expect(
      asUser.action(api.features.chat.transcribe.transcribeAudio, {
        audio: wavBytes(),
      }),
    ).rejects.toThrow();
    expect(runSttMock).toHaveBeenCalledTimes(1);
  });

  it('returns a pinned Serbian transcript in Cyrillic', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });
    runSttMock.mockResolvedValue(
      sttResult({ text: 'Danas je lep dan.', detectedLanguage: 'sr' }),
    );

    const text = await asUser.action(
      api.features.chat.transcribe.transcribeAudio,
      { audio: wavBytes(), language: 'sr' },
    );

    expect(text).toBe('Данас је леп дан.');
  });

  it('returns detected Serbian in Cyrillic even without a pin', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['en'], ['sr']);
    const asUser = t.withIdentity({ subject: 'user_A' });
    runSttMock.mockResolvedValue(
      sttResult({ text: 'Hajdemo u park.', detectedLanguage: 'sr' }),
    );

    const text = await asUser.action(
      api.features.chat.transcribe.transcribeAudio,
      { audio: wavBytes() },
    );

    expect(text).toBe('Хајдемо у парк.');
  });

  it('converts detected Mandarin to Traditional when the course is zh_traditional', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['en'], ['zh_traditional']);
    const asUser = t.withIdentity({ subject: 'user_A' });
    runSttMock.mockResolvedValue(
      sttResult({ text: '这个电话很贵。', detectedLanguage: 'zh' }),
    );

    const text = await asUser.action(
      api.features.chat.transcribe.transcribeAudio,
      { audio: wavBytes() },
    );

    expect(text).toBe('這個電話很貴。');
  });

  it('leaves detected Mandarin alone when the course has both scripts', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['zh'], ['zh_traditional']);
    const asUser = t.withIdentity({ subject: 'user_A' });
    runSttMock.mockResolvedValue(
      sttResult({ text: '这个电话很贵。', detectedLanguage: 'zh' }),
    );

    const text = await asUser.action(
      api.features.chat.transcribe.transcribeAudio,
      { audio: wavBytes() },
    );

    expect(text).toBe('这个电话很贵。');
  });
});
