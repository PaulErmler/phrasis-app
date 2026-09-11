/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { scheduleAudioForLanguage } from '../../features/decks';
import { deleteAudioRowsForTextLanguage } from '../../lib/audio';
import { findAudioAssetByKey, upsertAudioPointer } from '../../lib/audioAssets';
import { ensureTextContent } from '../../lib/contentScheduling';
import { audioPointer } from '../../db/translationReads';
import {
  getCurrentTranslationVersion,
  getCurrentTtsVersion,
  getTtsProviderForLanguage,
} from '../../../lib/languages';
import { CURRENT_SENTENCE_METADATA_SOURCE } from '../../../lib/sentenceMetadataSource';
import { insertAudioFixture } from '../lib/audioFixtures';
// The workpools are module-mocked globally (tests/convexTestSetup.ts):
// `enqueueAction` is a vi.fn() resolving to unique fake workIds, so tests can
// assert the enqueue payload directly.
import { ttsPool } from '../../lib/workpools';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const mockEnqueueTts = vi.mocked(ttsPool.enqueueAction);

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

beforeEach(() => {
  mockEnqueueTts.mockClear();
});

/** Seed a text with a resolved female voice gender. */
async function seedText(
  t: TestConvex<typeof schema>,
  text: string,
  opts?: { gender?: 'male' | 'female' },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    return ctx.db.insert('texts', {
      text,
      language: 'es',
      userCreated: false,
      collectionId,
      collectionRank: 1,
      speakerGender: opts?.gender ?? 'female',
      audioSpeakerGender: opts?.gender ?? 'female',
    });
  });
}

async function storeBlob(t: TestConvex<typeof schema>, byte: number) {
  return t.run(async (ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([byte])])),
  );
}

/** Simulate a TTS job's final write for (textId, 'es'). */
async function storeFinal(
  t: TestConvex<typeof schema>,
  args: {
    textId: Id<'texts'>;
    spokenText: string;
    storageId: Id<'_storage'>;
    ttsQuality?: 'unknown' | 'validated' | 'unvalidated';
    voiceGender?: 'male' | 'female';
    wordTimings?: { word: string; start: number; end: number }[];
  },
) {
  await t.mutation(internal.features.decks.storeAudioRecording, {
    textId: args.textId,
    language: 'es',
    voiceName: 'Leda',
    storageId: args.storageId,
    ttsQuality: args.ttsQuality ?? 'validated',
    ttsProvider: 'gemini',
    voiceGender: args.voiceGender ?? 'female',
    speed: 1,
    wordTimings: args.wordTimings,
    spokenText: args.spokenText,
  });
}

async function getRow(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', textId).eq('language', 'es'),
      )
      .first(),
  );
}

async function getAllAssets(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => ctx.db.query('audioAssets').collect());
}

async function getClaim(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('ttsGenerationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', textId).eq('language', 'es'),
      )
      .first(),
  );
}

async function blobExists(
  t: TestConvex<typeof schema>,
  storageId: Id<'_storage'>,
) {
  return t.run(async (ctx) => (await ctx.storage.getUrl(storageId)) !== null);
}

describe('audioAssets content-addressed cache', () => {
  describe('cache reuse at scheduleAudioForLanguage', () => {
    it('second text with the identical string attaches to the asset, no claim, no TTS job', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const blob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: blob,
      });

      const textB = await seedText(t, 'Hola');
      const scheduled = await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, 'es', 'female', null);
      });

      expect(scheduled).toBe(true);
      expect(mockEnqueueTts).not.toHaveBeenCalled();
      expect(await getClaim(t, textB)).toBeNull();

      const rowA = await getRow(t, textA);
      const rowB = await getRow(t, textB);
      expect(rowB?.assetId).toBeDefined();
      expect(rowB?.assetId).toBe(rowA?.assetId);
      expect((await getAllAssets(t)).length).toBe(1);
    });

    it('a different gender is a different key, no reuse, job enqueued', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: await storeBlob(t, 1),
      });

      const textB = await seedText(t, 'Hola', { gender: 'male' });
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, 'es', 'male', null);
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(await getClaim(t, textB)).not.toBeNull();
    });

    it('a whitespace variant is a different key, the raw string is never normalized', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: await storeBlob(t, 1),
      });

      const textB = await seedText(t, ' Hola');
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, 'es', 'female', null);
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
    });

    it('forceRegen bypasses a fresh asset and threads the flag into the job', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: await storeBlob(t, 1),
      });

      const textB = await seedText(t, 'Hola');
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, 'es', 'female', null, {
          forceRegen: true,
        });
      });

      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(mockEnqueueTts.mock.calls[0][2]).toMatchObject({
        forceRegen: true,
      });
      expect(await getClaim(t, textB)).not.toBeNull();
    });

    it('a version bump creates a sibling asset: the old asset and blob stay, and the old setup still finds it', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const oldBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: oldBlob,
      });
      // Age the asset below the language's current ttsVersion: the clip of
      // the previous prompt version.
      const oldAssetId = await t.run(async (ctx) => {
        const asset = (await ctx.db.query('audioAssets').collect())[0];
        await ctx.db.patch(asset._id, { ttsVersion: 0 });
        return asset._id;
      });

      const textB = await seedText(t, 'Hola');
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, 'es', 'female', null);
      });
      // A clip of another setup is invisible → miss → real job enqueued.
      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);

      // Simulate that job's final write: same key, new blob.
      const newBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textB,
        spokenText: 'Hola',
        storageId: newBlob,
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(2);
      const old = assets.find((a) => a._id === oldAssetId)!;
      const fresh = assets.find((a) => a._id !== oldAssetId)!;
      expect(old.storageId).toBe(oldBlob);
      expect(old.ttsVersion).toBe(0);
      expect(fresh.storageId).toBe(newBlob);
      expect(fresh.ttsVersion).toBe(getCurrentTtsVersion('es'));
      // Retained: the old asset still owns its blob, so even the delayed
      // reference-checked delete leaves it alone.
      expect(await blobExists(t, oldBlob)).toBe(true);
      await t.mutation(
        internal.features.ttsProcessing.deleteBlobIfUnreferencedJob,
        { storageId: oldBlob },
      );
      expect(await blobExists(t, oldBlob)).toBe(true);
      // Text A keeps its pointer until the validity sweep re-points it; B
      // got the new asset.
      expect((await getRow(t, textA))?.assetId).toBe(oldAssetId);
      expect((await getRow(t, textB))?.assetId).toBe(fresh._id);

      // Each setup finds its own clip; 'any' finds one.
      const key = {
        language: 'es',
        voiceGender: 'female' as const,
        regionVariant: old.regionVariant,
        spokenText: 'Hola',
      };
      const found = await t.run(async (ctx) => ({
        current: await findAudioAssetByKey(ctx, key),
        previous: await findAudioAssetByKey(ctx, key, {
          provider: 'gemini',
          version: 0,
        }),
        any: await findAudioAssetByKey(ctx, key, 'any'),
      }));
      expect(found.current?._id).toBe(fresh._id);
      expect(found.previous?._id).toBe(oldAssetId);
      expect(found.any).not.toBeNull();
    });
  });

  describe('TTS setup retention in the validity sweep', () => {
    /**
     * A German text with a complete Spanish translation whose clip was made
     * under `ttsVersion`. The German clip is current, so only the Spanish
     * pointer is up for the sweep.
     */
    async function seedSpanishClip(
      t: TestConvex<typeof schema>,
      opts: { ttsVersion: number },
    ) {
      return t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hallo',
          language: 'de',
          userCreated: false,
          collectionId,
          collectionRank: 1,
          speakerGender: 'female',
          audioSpeakerGender: 'female',
          metadataSource: CURRENT_SENTENCE_METADATA_SOURCE,
          ipaText: 'haˈloː',
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'es',
          translatedText: 'Hola',
          speakerGender: 'female',
          translationVersion: getCurrentTranslationVersion('es'),
          ipaText: 'ˈola',
        });
        await insertAudioFixture(ctx, {
          textId,
          language: 'de',
          storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
          ttsQuality: 'validated',
          ttsProvider: getTtsProviderForLanguage('de'),
          voiceGender: 'female',
          ttsVersion: getCurrentTtsVersion('de'),
          spokenText: 'Hallo',
        });
        const esBlob = await ctx.storage.store(new Blob([new Uint8Array([2])]));
        const { assetId } = await insertAudioFixture(ctx, {
          textId,
          language: 'es',
          storageId: esBlob,
          ttsQuality: 'validated',
          ttsProvider: getTtsProviderForLanguage('es'),
          voiceGender: 'female',
          ttsVersion: opts.ttsVersion,
          spokenText: 'Hola',
        });
        return { textId, esAssetId: assetId, esBlob };
      });
    }

    it('a version-stale canonical pointer is detached, the asset and blob stay, and TTS is re-enqueued', async () => {
      const t = convexTest(schema, modules);
      const { textId, esAssetId, esBlob } = await seedSpanishClip(t, {
        ttsVersion: 0,
      });

      // A legacy card's view: the legacy pointer is this card's to maintain.
      const scheduled = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return ensureTextContent(ctx, textId, text, ['de'], ['es'], {
          card: {},
        });
      });

      expect(scheduled.audioScheduled).toBe(1);
      expect(mockEnqueueTts).toHaveBeenCalledTimes(1);
      expect(mockEnqueueTts.mock.calls[0][2]).toMatchObject({
        textId,
        language: 'es',
        text: 'Hola',
      });
      expect(await t.run((ctx) => audioPointer(ctx, textId, 'es'))).toBeNull();
      expect(await t.run((ctx) => ctx.db.get(esAssetId))).not.toBeNull();
      expect(await blobExists(t, esBlob)).toBe(true);
    });

    it('a current canonical pointer is left alone', async () => {
      const t = convexTest(schema, modules);
      const { textId, esAssetId } = await seedSpanishClip(t, {
        ttsVersion: getCurrentTtsVersion('es'),
      });

      // A legacy card's view: the legacy pointer is this card's to maintain.
      const scheduled = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return ensureTextContent(ctx, textId, text, ['de'], ['es'], {
          card: {},
        });
      });

      expect(scheduled.audioScheduled).toBe(0);
      expect(mockEnqueueTts).not.toHaveBeenCalled();
      expect(
        (await t.run((ctx) => audioPointer(ctx, textId, 'es')))?.assetId,
      ).toBe(esAssetId);
    });
  });

  describe('storeAudioRecording replace rules', () => {
    it('refuses to write when the incoming blob no longer exists (no dead asset born)', async () => {
      // Regression (2026-08-20): a job's blob can be garbage-collected before
      // its completion write lands. Writing anyway created an asset that
      // looked valid but served a null URL — the forever-spinner state.
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const blob = await storeBlob(t, 1);
      await t.run(async (ctx) => ctx.storage.delete(blob));

      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: blob,
      });

      expect(await getAllAssets(t)).toEqual([]);
      expect(await getRow(t, textA)).toBeNull();
    });

    it("attempt-0 creates the asset as 'unknown' with a pointer row", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const blob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: blob,
        ttsQuality: 'unknown',
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe('unknown');
      expect((await getRow(t, textA))?.assetId).toBe(assets[0]._id);
    });

    it("a mid-flight 'unknown' write never clobbers completed audio, pointer only, incoming blob SPARED for the running job", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const goodBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: goodBlob,
      });

      const textB = await seedText(t, 'Hola');
      const incomingBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textB,
        spokenText: 'Hola',
        storageId: incomingBlob,
        ttsQuality: 'unknown',
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe('validated');
      expect(assets[0].storageId).toBe(goodBlob);
      expect((await getRow(t, textB))?.assetId).toBe(assets[0]._id);
      // The incoming blob must NOT be deleted immediately: the job that
      // stored it is still running and references it in its final write
      // (see the 'kept' branch in storeAudioRecording). It is scheduled for
      // the delayed reference-checked delete instead.
      expect(await blobExists(t, incomingBlob)).toBe(true);
    });

    it("circle-breaker: after a 'kept' early write, the job's final write still lands with its blob intact", async () => {
      // The forever-spinner loop (2026-08-20): the 'kept' branch used to
      // delete the early write's blob immediately, killing it under the
      // running job; the final write then either birthed a dead asset or
      // was refused, and the ensure retried the same doomed sequence
      // forever. The full job sequence must now converge.
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const corpseBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: corpseBlob,
      });
      // Make the completed asset a corpse (its blob deleted), as observed live.
      await t.run(async (ctx) => ctx.storage.delete(corpseBlob));

      // A fresh job for another text of the same string: early write, then
      // final validated write with the SAME blob — the real job's sequence.
      const textB = await seedText(t, 'Hola');
      const jobBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textB,
        spokenText: 'Hola',
        storageId: jobBlob,
        ttsQuality: 'unknown',
      });
      await storeFinal(t, {
        textId: textB,
        spokenText: 'Hola',
        storageId: jobBlob,
        ttsQuality: 'validated',
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe('validated');
      expect(assets[0].storageId).toBe(jobBlob);
      expect(await blobExists(t, jobBlob)).toBe(true);
      expect((await getRow(t, textB))?.assetId).toBe(assets[0]._id);
      expect((await getRow(t, textA))?.assetId).toBe(assets[0]._id);
    });

    it("a completed 'unvalidated' write replaces 'validated' audio, a regeneration always lands", async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const blob1 = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: blob1,
        wordTimings: [{ word: 'Hola', start: 0, end: 0.5 }],
      });

      const blob2 = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: blob2,
        ttsQuality: 'unvalidated',
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].ttsQuality).toBe('unvalidated');
      expect(assets[0].storageId).toBe(blob2);
      // Timings belonged to the replaced blob.
      expect(assets[0].wordTimings).toBeUndefined();
      // Grace window: the replaced blob survives until the delayed job fires.
      expect(await blobExists(t, blob1)).toBe(true);
      await t.mutation(
        internal.features.ttsProcessing.deleteBlobIfUnreferencedJob,
        { storageId: blob1 },
      );
      expect(await blobExists(t, blob1)).toBe(false);
    });
  });

  describe('pointer deletes and asset lifecycle', () => {
    it('deleting one sharer keeps the asset and blob; deleting the last pointer removes both', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const blob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: blob,
      });

      const textB = await seedText(t, 'Hola');
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, 'es', 'female', null);
      });

      await t.run(async (ctx) =>
        deleteAudioRowsForTextLanguage(ctx, textA, 'es'),
      );
      expect((await getAllAssets(t)).length).toBe(1);
      expect(await blobExists(t, blob)).toBe(true);
      expect((await getRow(t, textB))?.assetId).toBeDefined();

      await t.run(async (ctx) =>
        deleteAudioRowsForTextLanguage(ctx, textB, 'es'),
      );
      expect((await getAllAssets(t)).length).toBe(0);
      expect(await blobExists(t, blob)).toBe(false);
    });

    it('repointing the last pointer to a different asset cleans up the orphan (delayed blob delete)', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const femaleBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: femaleBlob,
      });

      // A racing job under the male gender key completes for the same
      // (text, language): the row repoints to the new asset, and the female
      // asset. Now pointerless. Must not leak.
      const maleBlob = await storeBlob(t, 2);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: maleBlob,
        voiceGender: 'male',
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(1);
      expect(assets[0].voiceGender).toBe('male');
      expect((await getRow(t, textA))?.assetId).toBe(assets[0]._id);
      // The orphan's blob survives the grace window, then goes.
      expect(await blobExists(t, femaleBlob)).toBe(true);
      await t.mutation(
        internal.features.ttsProcessing.deleteBlobIfUnreferencedJob,
        { storageId: femaleBlob },
      );
      expect(await blobExists(t, femaleBlob)).toBe(false);
    });

    it('repointing away from a still-shared asset leaves it untouched', async () => {
      const t = convexTest(schema, modules);
      const textA = await seedText(t, 'Hola');
      const femaleBlob = await storeBlob(t, 1);
      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: femaleBlob,
      });
      const textB = await seedText(t, 'Hola');
      await t.run(async (ctx) => {
        const text = await ctx.db.get(textB);
        return scheduleAudioForLanguage(ctx, text!, 'es', 'female', null);
      });

      await storeFinal(t, {
        textId: textA,
        spokenText: 'Hola',
        storageId: await storeBlob(t, 2),
        voiceGender: 'male',
      });

      const assets = await getAllAssets(t);
      expect(assets.length).toBe(2);
      const female = assets.find((a) => a.voiceGender === 'female');
      expect(female?.storageId).toBe(femaleBlob);
      expect((await getRow(t, textB))?.assetId).toBe(female?._id);
      expect(await blobExists(t, femaleBlob)).toBe(true);
    });
  });
});

describe('upsertAudioPointer and the rendering key', () => {
  it('an unkeyed upsert re-points the row and leaves its key alone', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t, 'Hola');
    await storeFinal(t, {
      textId,
      spokenText: 'Hola',
      storageId: await storeBlob(t, 1),
    });
    const first = (await getRow(t, textId))!;
    await t.run((ctx) =>
      upsertAudioPointer(ctx, textId, 'es', first.assetId, 'female'),
    );
    expect((await getRow(t, textId))?.variantKey).toBe('female');

    // Same asset, no key (a job enqueued before the keys existed): a
    // no-op, not a demotion to a legacy pointer.
    await t.run((ctx) => upsertAudioPointer(ctx, textId, 'es', first.assetId));
    expect((await getRow(t, textId))?.variantKey).toBe('female');

    // Another asset, no key: re-pointed, key kept.
    const other = await seedText(t, 'Adiós');
    await storeFinal(t, {
      textId: other,
      spokenText: 'Adiós',
      storageId: await storeBlob(t, 2),
    });
    const otherAsset = (await getRow(t, other))!.assetId;
    await t.run((ctx) => upsertAudioPointer(ctx, textId, 'es', otherAsset));
    expect(await getRow(t, textId)).toMatchObject({
      assetId: otherAsset,
      variantKey: 'female',
    });
  });
});
