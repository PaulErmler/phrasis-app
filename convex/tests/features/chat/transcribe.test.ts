import { convexTest } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import schema from '../../../schema';
import { api } from '../../../_generated/api';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * transcribeAudio's language fork: writing-mode dictation pins one language
 * (skipping the course-language sweep and threading `regionVariant`), chat
 * voice input auto-detects across the course languages. The STT vendor call
 * itself is mocked — this pins the args each mode hands it.
 */

const runSttMock = vi.hoisted(() => vi.fn());
const reserveSlotMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/stt', () => ({
  transcribeAudio: runSttMock,
  reserveAzureSttSlot: reserveSlotMock,
}));

async function seedQuota(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        transcriptions: { balance: 10, included: 10, used: 0, unlimited: false },
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

    const text = await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: new ArrayBuffer(4),
      mimeType: 'audio/webm',
      language: 'es_mixed',
      regionVariant: 'es-MX',
    });

    expect(text).toBe('hola');
    expect(runSttMock).toHaveBeenCalledTimes(1);
    const [, language, opts] = runSttMock.mock.calls[0];
    expect(language).toBe('es_mixed');
    expect(opts).toEqual({ regionVariant: 'es-MX' });
  });

  it('auto-detects over course languages when no language is pinned', async () => {
    const t = convexTest(schema, modules);
    await seedQuota(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.action(api.features.chat.transcribe.transcribeAudio, {
      audio: new ArrayBuffer(4),
      mimeType: 'audio/webm',
    });

    const [, language, opts] = runSttMock.mock.calls[0];
    expect(language).toBeUndefined();
    // No active course seeded: the sweep list is empty, but the MODE is
    // auto-detect — regionVariant is absent and the sweep key is present.
    expect(opts).toEqual({ autoDetectCourseLanguages: [] });
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
