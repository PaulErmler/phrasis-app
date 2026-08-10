/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../../schema';
import { api, internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { sha256Hex } from '../../../lib/sha256';
import { resolveAudioSpeakerGender } from '../../../../lib/voices';

const modules = import.meta.glob('/convex/**/*.ts');

const SPOKEN_ES = 'Tengo un perro.';
const SPOKEN_EN = 'I have a dog.';

async function seedApproval(t: TestConvex<typeof schema>, userId = 'user_A') {
  return t.run(async (ctx) =>
    ctx.db.insert('cardApprovals', {
      threadId: 'thread_1',
      messageId: 'm1',
      toolCallId: 'tc1',
      translations: [
        { language: 'en', text: SPOKEN_EN },
        { language: 'es', text: SPOKEN_ES },
      ],
      userId,
      status: 'pending',
    }),
  );
}

async function insertAsset(
  t: TestConvex<typeof schema>,
  args: {
    language: string;
    voiceGender: 'male' | 'female';
    spokenText: string;
    ttsQuality?: 'unknown' | 'validated' | 'unvalidated';
  },
) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(['audio-bytes']));
    const assetId = await ctx.db.insert('audioAssets', {
      language: args.language,
      voiceGender: args.voiceGender,
      spokenTextHash: sha256Hex(args.spokenText),
      spokenText: args.spokenText,
      storageId,
      voiceName: 'es-ES-Test',
      ttsProvider: 'google',
      ttsQuality: args.ttsQuality ?? 'validated',
      speed: 1,
    });
    return { assetId, storageId };
  });
}

/** The deterministic per-approval speaker the backend derives from the id. */
function primaryGender(approvalId: Id<'cardApprovals'>): 'male' | 'female' {
  return resolveAudioSpeakerGender(undefined, approvalId);
}

describe('features/chat/approvalAudio', () => {
  describe('getApprovalAudio', () => {
    it('returns [] for unauthenticated and for non-owners', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedApproval(t);
      expect(
        await t.query(api.features.chat.approvalAudio.getApprovalAudio, {
          approvalId,
        }),
      ).toEqual([]);
      const asOther = t.withIdentity({ subject: 'user_B' });
      expect(
        await asOther.query(api.features.chat.approvalAudio.getApprovalAudio, {
          approvalId,
        }),
      ).toEqual([]);
    });

    it('serves a cached asset regardless of which gender it was synthesized with', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedApproval(t);
      // Deliberately the NON-primary gender: the lookup must check both, so
      // audio synthesized by any other path (cards, previews) is reused.
      const other = primaryGender(approvalId) === 'male' ? 'female' : 'male';
      await insertAsset(t, {
        language: 'es',
        voiceGender: other,
        spokenText: SPOKEN_ES,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      const lines = await asUser.query(
        api.features.chat.approvalAudio.getApprovalAudio,
        { approvalId },
      );
      expect(lines.find((l) => l.language === 'es')?.url).toBeTruthy();
      expect(lines.find((l) => l.language === 'en')?.url).toBeNull();
    });
  });

  describe('requestApprovalAudio', () => {
    it('no-ops on a cache hit, schedules synthesis on a miss', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedApproval(t);
      await insertAsset(t, {
        language: 'es',
        voiceGender: primaryGender(approvalId),
        spokenText: SPOKEN_ES,
      });
      const asUser = t.withIdentity({ subject: 'user_A' });
      expect(
        await asUser.mutation(
          api.features.chat.approvalAudio.requestApprovalAudio,
          { approvalId, language: 'es' },
        ),
      ).toEqual({ scheduled: false });
      // No asset for the English line yet → synthesis gets scheduled. The
      // scheduled action is deliberately NOT drained here (it would hit the
      // real TTS provider); the save path is covered directly below.
      expect(
        await asUser.mutation(
          api.features.chat.approvalAudio.requestApprovalAudio,
          { approvalId, language: 'en' },
        ),
      ).toEqual({ scheduled: true });
    });

    it('dedupes repeat clicks while a synthesis is in flight, but not for edited text', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedApproval(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const request = () =>
        asUser.mutation(api.features.chat.approvalAudio.requestApprovalAudio, {
          approvalId,
          language: 'en',
        });
      expect(await request()).toEqual({ scheduled: true });
      // The asset hasn't landed yet (the scheduled action is never drained),
      // so without the in-flight marker this would pay for a SECOND
      // synthesis of the same line.
      expect(await request()).toEqual({ scheduled: false });

      // A hand-edited line is different content — the stale marker must not
      // block its (first) synthesis.
      await t.run(async (ctx) => {
        await ctx.db.patch(approvalId, {
          translations: [
            { language: 'en', text: 'I have a cat.' },
            { language: 'es', text: SPOKEN_ES },
          ],
        });
      });
      expect(await request()).toEqual({ scheduled: true });
    });

    it('rejects non-owners and unknown languages', async () => {
      const t = convexTest(schema, modules);
      const approvalId = await seedApproval(t);
      const asOther = t.withIdentity({ subject: 'user_B' });
      await expect(
        asOther.mutation(api.features.chat.approvalAudio.requestApprovalAudio, {
          approvalId,
          language: 'es',
        }),
      ).rejects.toThrow(/not found/i);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(api.features.chat.approvalAudio.requestApprovalAudio, {
          approvalId,
          language: 'fr',
        }),
      ).rejects.toThrow(/language/i);
    });
  });

  describe('saveApprovalAudioAsset', () => {
    it('creates an unvalidated speed-1 asset for a fresh key', async () => {
      const t = convexTest(schema, modules);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(['fresh-audio'])),
      );
      await t.mutation(
        internal.features.chat.approvalAudio.saveApprovalAudioAsset,
        {
          language: 'es',
          voiceGender: 'female',
          spokenText: SPOKEN_ES,
          storageId,
          voiceName: 'es-ES-Test',
          provider: 'google',
        },
      );
      const asset = await t.run(async (ctx) =>
        ctx.db
          .query('audioAssets')
          .withIndex('by_key', (q) =>
            q
              .eq('language', 'es')
              .eq('voiceGender', 'female')
              .eq('regionVariant', undefined)
              .eq('spokenTextHash', sha256Hex(SPOKEN_ES)),
          )
          .first(),
      );
      expect(asset?.storageId).toBe(storageId);
      expect(asset?.ttsQuality).toBe('unvalidated');
      expect(asset?.speed).toBe(1);
    });

    it('defers to completed audio that landed first and drops its own blob', async () => {
      const t = convexTest(schema, modules);
      const { assetId, storageId: existingBlob } = await insertAsset(t, {
        language: 'es',
        voiceGender: 'female',
        spokenText: SPOKEN_ES,
        ttsQuality: 'validated',
      });
      const loserBlob = await t.run(async (ctx) =>
        ctx.storage.store(new Blob(['late-preview-audio'])),
      );
      await t.mutation(
        internal.features.chat.approvalAudio.saveApprovalAudioAsset,
        {
          language: 'es',
          voiceGender: 'female',
          spokenText: SPOKEN_ES,
          storageId: loserBlob,
          voiceName: 'es-ES-Other',
          provider: 'google',
        },
      );
      await t.run(async (ctx) => {
        const asset = await ctx.db.get(assetId);
        // The validated pipeline audio stays; the preview's blob is deleted.
        expect(asset?.storageId).toBe(existingBlob);
        expect(asset?.ttsQuality).toBe('validated');
        expect(await ctx.storage.getUrl(loserBlob)).toBeNull();
      });
    });
  });
});
