import { convexTest } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import schema from '../../../schema';
import { api } from '../../../_generated/api';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * transcribeAudio's language fork: writing-mode dictation pins one language
 * (skipping the course-language sweep and threading `regionVariant`), chat
 * voice input auto-detects across the course languages. The STT vendor call
 * itself is mocked — this pins the args each mode hands it, plus the recovery
 * when Azure's language-ID refuses a recording that mixes languages.
 */

const runSttMock = vi.hoisted(() => vi.fn());
const reserveSlotMock = vi.hoisted(() => vi.fn());

class FakeMultipleLanguagesError extends Error {}

vi.mock('../../../lib/stt', () => ({
  transcribeAudio: runSttMock,
  reserveAzureSttSlot: reserveSlotMock,
  AzureMultipleLanguagesError: FakeMultipleLanguagesError,
}));

async function seedCourse(
  t: ReturnType<typeof convexTest>,
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

async function seedQuota(t: ReturnType<typeof convexTest>) {
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

describe('features/chat/transcribe', () => {
  beforeEach(() => {
    runSttMock.mockReset();
    reserveSlotMock.mockReset().mockResolvedValue(undefined);
    runSttMock.mockResolvedValue({ text: 'hola', audioDurationMs: 900 });
  });

  it('pins the given language and threads regionVariant, skipping auto-detect', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    const text = await asUser.action(
      api.features.chat.transcribe.transcribeAudio,
      {
        audio: new ArrayBuffer(4),
        mimeType: 'audio/webm',
        language: 'es_mixed',
        regionVariant: 'es-MX',
      },
    );

    expect(text).toBe('hola');
    expect(runSttMock).toHaveBeenCalledTimes(1);
    const [, language, opts] = runSttMock.mock.calls[0];
    expect(language).toBe('es_mixed');
    expect(opts).toEqual({ regionVariant: 'es-MX' });
  });

  it('auto-detects over course languages when no language is pinned', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['en'], ['sv']);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: new ArrayBuffer(4),
      mimeType: 'audio/webm',
    });

    const [, language, opts] = runSttMock.mock.calls[0];
    expect(language).toBeUndefined();
    expect(opts).toEqual({ autoDetectCourseLanguages: ['en', 'sv'] });
  });

  it('auto-detects with an empty sweep list when there is no active course', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: new ArrayBuffer(4),
      mimeType: 'audio/webm',
    });

    const [, language, opts] = runSttMock.mock.calls[0];
    expect(language).toBeUndefined();
    // The MODE is auto-detect: regionVariant absent, sweep key present.
    expect(opts).toEqual({ autoDetectCourseLanguages: [] });
  });

  it('retries pinned to the target language when language-ID refuses mixed audio', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['en'], ['sv']);
    const asUser = t.withIdentity({ subject: 'user_A' });

    runSttMock
      .mockRejectedValueOnce(
        new FakeMultipleLanguagesError('Azure STT API error: 422'),
      )
      .mockResolvedValueOnce({ text: 'hej hello', audioDurationMs: 900 });

    const text = await asUser.action(
      api.features.chat.transcribe.transcribeAudio,
      { audio: new ArrayBuffer(4), mimeType: 'audio/webm' },
    );

    expect(text).toBe('hej hello');
    expect(runSttMock).toHaveBeenCalledTimes(2);
    const [, language, opts] = runSttMock.mock.calls[1];
    expect(language).toBe('sv');
    expect(opts).toEqual({});
    // Both attempts reserve an Azure slot; neither bypasses the rate limiter.
    expect(reserveSlotMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the multi-lingual model when there is no target to pin', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    runSttMock
      .mockRejectedValueOnce(
        new FakeMultipleLanguagesError('Azure STT API error: 422'),
      )
      .mockResolvedValueOnce({ text: 'bonjour hello', audioDurationMs: 900 });

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: new ArrayBuffer(4),
      mimeType: 'audio/webm',
    });

    const [, language, opts] = runSttMock.mock.calls[1];
    expect(language).toBeUndefined();
    expect(opts).toEqual({ forceMultilingualModel: true });
  });

  it('does not retry a pinned-language transcription', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    runSttMock.mockRejectedValue(
      new FakeMultipleLanguagesError('Azure STT API error: 422'),
    );

    await expect(
      asUser.action(api.features.chat.transcribe.transcribeAudio, {
        audio: new ArrayBuffer(4),
        language: 'sv',
      }),
    ).rejects.toThrow();
    expect(runSttMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-language STT failure without retrying', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    await seedCourse(t, ['en'], ['sv']);
    const asUser = t.withIdentity({ subject: 'user_A' });

    runSttMock.mockRejectedValue(new Error('Azure STT API error: 500'));

    await expect(
      asUser.action(api.features.chat.transcribe.transcribeAudio, {
        audio: new ArrayBuffer(4),
      }),
    ).rejects.toThrow();
    expect(runSttMock).toHaveBeenCalledTimes(1);
  });

  it('consumes a transcription unit before calling the vendor', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });
    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: new ArrayBuffer(4),
      language: 'es',
    });
    const doc = await t.run(async (ctx) =>
      ctx.db
        .query('usageQuotas')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .unique(),
    );
    expect(doc!.features.transcriptions.balance).toBe(9);
  });
});
