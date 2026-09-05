/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import {
  scheduleAudioForLanguage,
  scheduleMissingContent,
} from '../../features/decks';
import { liveTranslation } from '../../db/translationReads';
import { findAudioAssetInAnyAccent } from '../../lib/audioAssets';
import { SOURCE_VERBATIM_TRANSLATION_SOURCE } from '../../../lib/translationProvenance';
import { getVoiceLocale, pickAccentForText } from '../../../lib/voices';
import { llmPool, ttsPool } from '../../lib/workpools';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

const llmEnqueues = () =>
  vi
    .mocked(llmPool.enqueueAction)
    .mock.calls.map((c) => c[2] as { targetLanguage: string });
const ttsEnqueues = () =>
  vi
    .mocked(ttsPool.enqueueAction)
    .mock.calls.map((c) => c[2] as { language: string; voiceName: string });

beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
  vi.mocked(ttsPool.enqueueAction).mockClear();
});

/** A premade English curriculum sentence with a resolved female voice. */
async function seedEnglishText(t: TestConvex<typeof schema>, text: string) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    return ctx.db.insert('texts', {
      text,
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
      speakerGender: 'female',
      audioSpeakerGender: 'female',
    });
  });
}

async function sweep(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    return scheduleMissingContent(
      ctx,
      textId,
      text,
      baseLanguages,
      targetLanguages,
    );
  });
}

describe('English accent variants', () => {
  describe('verbatim text', () => {
    it('an en sentence on an English (US) course gets a verbatim row, American audio, and no LLM job', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishText(t, 'Hello world');

      await sweep(t, textId, ['en_us'], ['es']);

      const row = await t.run((ctx) => liveTranslation(ctx, textId, 'en_us'));
      expect(row).toMatchObject({
        translatedText: 'Hello world',
        translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
        translationVersion: 2,
        speakerGender: 'female',
      });
      // Only Spanish went to a model.
      expect(llmEnqueues().map((e) => e.targetLanguage)).toEqual(['es']);
      // Audio for the US course speaks in an American voice; the source `en`
      // audio (always filled) speaks in the text's deterministic accent.
      const tts = ttsEnqueues();
      const us = tts.find((e) => e.language === 'en_us');
      expect(us).toBeDefined();
      expect(getVoiceLocale(us!.voiceName)).toBe('en-US');
      const en = tts.find((e) => e.language === 'en');
      expect(en).toBeDefined();
      expect(getVoiceLocale(en!.voiceName)).toBe(
        pickAccentForText('en', textId),
      );
      // Nothing claimed a model slot for the verbatim row.
      const claims = await t.run((ctx) =>
        ctx.db.query('llmTranslationClaims').collect(),
      );
      expect(claims.map((c) => c.targetLanguage)).toEqual(['es']);
    });

    it('an en sentence on an English (UK) course is sent to the accent rewrite like a translation', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishText(t, 'Hello world');

      await sweep(t, textId, ['en_gb'], ['es']);

      // No row yet: the wording comes from the model, not from a copy.
      expect(await t.run((ctx) => liveTranslation(ctx, textId, 'en_gb'))).toBe(
        null,
      );
      const jobs = llmEnqueues() as {
        targetLanguage: string;
        sourceLanguage?: string;
      }[];
      expect(jobs.map((e) => e.targetLanguage).sort()).toEqual(['en_gb', 'es']);
      expect(jobs.find((e) => e.targetLanguage === 'en_gb')).toMatchObject({
        sourceLanguage: 'en',
      });
      // The rewrite holds a model slot like any translation; its audio waits
      // for the wording. The source `en` audio is filled regardless.
      const claims = await t.run((ctx) =>
        ctx.db.query('llmTranslationClaims').collect(),
      );
      expect(claims.map((c) => c.targetLanguage).sort()).toEqual([
        'en_gb',
        'es',
      ]);
      expect(ttsEnqueues().map((e) => e.language)).toEqual(['en']);
    });

    it('an old verbatim copy on a UK course is replaced in place by the accent rewrite on the version sweep', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishText(t, 'The color of the elevator');
      const rowId = await t.run((ctx) =>
        ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en_gb',
          translatedText: 'The color of the elevator',
          translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
          translationVersion: 2,
          speakerGender: 'female',
        }),
      );

      await sweep(t, textId, ['en_gb'], []);

      // The row keeps serving until the new wording lands (silent bump).
      const row = await t.run((ctx) => liveTranslation(ctx, textId, 'en_gb'));
      expect(row?._id).toBe(rowId);
      expect(llmEnqueues()).toMatchObject([
        {
          targetLanguage: 'en_gb',
          replaceExisting: true,
          translationReason: 'version_bump',
        },
      ]);
    });

    it('a custom German sentence with an en_gb target is still translated by a model', async () => {
      const t = convexTest(schema, modules);
      const textId = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'custom',
          textCount: 0,
        });
        return ctx.db.insert('texts', {
          text: 'Guten Morgen',
          language: 'de',
          userCreated: true,
          userId: 'user_A',
          collectionId,
          collectionRank: 1,
          speakerGender: 'female',
          audioSpeakerGender: 'female',
        });
      });

      await sweep(t, textId, ['en_gb'], []);

      expect(await t.run((ctx) => liveTranslation(ctx, textId, 'en_gb'))).toBe(
        null,
      );
      expect(llmEnqueues().map((e) => e.targetLanguage)).toEqual(['en_gb']);
    });

    it('a custom sentence typed on a UK course is served verbatim to a Mixed English base', async () => {
      const t = convexTest(schema, modules);
      // Custom texts carry the course code they were typed under.
      const textId = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'custom',
          textCount: 0,
        });
        return ctx.db.insert('texts', {
          text: 'Mind the gap',
          language: 'en_gb',
          userCreated: true,
          userId: 'user_A',
          collectionId,
          collectionRank: 1,
          speakerGender: 'female',
          audioSpeakerGender: 'female',
        });
      });

      await sweep(t, textId, ['en'], ['es']);

      const row = await t.run((ctx) => liveTranslation(ctx, textId, 'en'));
      expect(row).toMatchObject({
        translatedText: 'Mind the gap',
        translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
      });
      // Only Spanish went to a model; English was not "translated" into English.
      expect(llmEnqueues().map((e) => e.targetLanguage)).toEqual(['es']);
    });
  });

  describe('one audio cache across accents', () => {
    async function storeMixedEnglishClip(
      t: TestConvex<typeof schema>,
      textId: Id<'texts'>,
      spokenText: string,
      voiceName: string,
    ) {
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      await t.mutation(internal.features.decks.storeAudioRecording, {
        textId,
        language: 'en',
        voiceName,
        storageId,
        ttsQuality: 'validated',
        ttsProvider: 'gemini',
        voiceGender: 'female',
        speed: 1,
        spokenText,
      });
      return storageId;
    }

    it('a British clip made for mixed English is stored under en + en-GB and reused by a UK course', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishText(t, 'Hello world');
      await storeMixedEnglishClip(t, textId, 'Hello world', 'Leda@en-GB');

      const assets = await t.run((ctx) =>
        ctx.db.query('audioAssets').collect(),
      );
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({
        language: 'en',
        regionVariant: 'en-GB',
        voiceName: 'Leda@en-GB',
      });

      const translationId = await t.run((ctx) =>
        ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en_gb',
          translatedText: 'Hello world',
          translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
          speakerGender: 'female',
        }),
      );
      const filled = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        const translation = (await ctx.db.get(translationId))!;
        return scheduleAudioForLanguage(
          ctx,
          text,
          'en_gb',
          'female',
          translation,
        );
      });
      expect(filled).toBe(true);
      expect(ttsEnqueues()).toEqual([]);
      const pointer = await t.run((ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'en_gb'),
          )
          .first(),
      );
      expect(pointer?.assetId).toBe(assets[0]._id);
    });

    it('a UK-course clip is reused by mixed English only for texts whose accent is British', async () => {
      const t = convexTest(schema, modules);
      // Find two texts: one hashing to en-GB, one not, so both branches run.
      const ids: Id<'texts'>[] = [];
      for (let i = 0; i < 30 && ids.length < 2; i++) {
        const id = await seedEnglishText(t, 'Good morning');
        const accent = pickAccentForText('en', id);
        const wantGb = ids.length === 0;
        if ((accent === 'en-GB') === wantGb) ids.push(id);
      }
      const [gbText, otherText] = ids;
      expect(pickAccentForText('en', gbText)).toBe('en-GB');
      expect(pickAccentForText('en', otherText)).not.toBe('en-GB');

      // The UK course's clip: an `en_gb` job storing a British voice.
      const seedText = await seedEnglishText(t, 'Good morning');
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([2])])),
      );
      await t.mutation(internal.features.decks.storeAudioRecording, {
        textId: seedText,
        language: 'en_gb',
        voiceName: 'Leda@en-GB',
        storageId,
        ttsQuality: 'validated',
        ttsProvider: 'gemini',
        voiceGender: 'female',
        speed: 1,
        spokenText: 'Good morning',
      });
      const assets = await t.run((ctx) =>
        ctx.db.query('audioAssets').collect(),
      );
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({
        language: 'en',
        regionVariant: 'en-GB',
      });

      await t.run(async (ctx) => {
        const text = (await ctx.db.get(gbText))!;
        await scheduleAudioForLanguage(ctx, text, 'en', 'female', null);
      });
      expect(ttsEnqueues()).toEqual([]);

      await t.run(async (ctx) => {
        const text = (await ctx.db.get(otherText))!;
        await scheduleAudioForLanguage(ctx, text, 'en', 'female', null);
      });
      const enqueued = ttsEnqueues();
      expect(enqueued).toHaveLength(1);
      expect(getVoiceLocale(enqueued[0].voiceName)).toBe(
        pickAccentForText('en', otherText),
      );
    });
  });

  describe('accent drift: the catalogue becomes mixed without discarding clips', () => {
    /** Two `en` texts with the same sentence: one hashing to US, one not. */
    async function seedUsAndOther(t: TestConvex<typeof schema>) {
      let us: Id<'texts'> | undefined;
      let other: Id<'texts'> | undefined;
      for (let i = 0; i < 40 && !(us && other); i++) {
        const id = await seedEnglishText(t, 'Take care');
        if (pickAccentForText('en', id) === 'en-US') us ??= id;
        else other ??= id;
      }
      return { us: us!, other: other! };
    }

    it('re-voices a GB/AU text pointing at a US clip and keeps the clip; a US text is untouched', async () => {
      const t = convexTest(schema, modules);
      const { us, other } = await seedUsAndOther(t);
      // Both texts point at one pre-fix American clip (backfilled to en-US).
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([7])])),
      );
      const assetId = await t.run(async (ctx) => {
        const { assetId } = await insertAudioFixture(ctx, {
          textId: us,
          language: 'en',
          voiceName: 'Leda@en-GB',
          storageId,
          ttsQuality: 'validated',
          ttsProvider: 'gemini',
          voiceGender: 'female',
          spokenText: 'Take care',
          regionVariant: 'en-US',
        });
        await insertAudioFixture(ctx, {
          textId: other,
          language: 'en',
          storageId,
          assetId,
        });
        return assetId;
      });

      await sweep(t, us, ['en'], []);
      expect(ttsEnqueues()).toEqual([]);

      await sweep(t, other, ['en'], []);
      const jobs = ttsEnqueues();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].language).toBe('en');
      expect(getVoiceLocale(jobs[0].voiceName)).toBe(
        pickAccentForText('en', other),
      );
      // The US text still plays the old clip, and the clip itself survives
      // for it and for English (US) courses.
      const pointers = await t.run((ctx) =>
        ctx.db.query('audioRecordings').collect(),
      );
      expect(pointers.map((p) => [p.textId, p.assetId])).toEqual([
        [us, assetId],
      ]);
      expect(await t.run((ctx) => ctx.db.get(assetId))).not.toBeNull();
    });

    it('ignores an un-stamped clip (accent unknown until the backfill runs)', async () => {
      const t = convexTest(schema, modules);
      const { other } = await seedUsAndOther(t);
      await t.run(async (ctx) => {
        await insertAudioFixture(ctx, {
          textId: other,
          language: 'en',
          voiceName: 'Leda@en-GB',
          storageId: await ctx.storage.store(new Blob([new Uint8Array([8])])),
          ttsQuality: 'validated',
          ttsProvider: 'gemini',
          voiceGender: 'female',
          spokenText: 'Take care',
        });
      });
      await sweep(t, other, ['en'], []);
      expect(ttsEnqueues()).toEqual([]);
    });
  });

  describe('any-accent lookup (chat proposals, writing alternatives)', () => {
    it('finds a clip in whatever accent the pool produced, under the cache language', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishText(t, 'See you soon');
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([3])])),
      );
      await t.mutation(internal.features.decks.storeAudioRecording, {
        textId,
        language: 'en_au',
        voiceName: 'Leda@en-AU',
        storageId,
        ttsQuality: 'validated',
        ttsProvider: 'gemini',
        voiceGender: 'female',
        speed: 1,
        spokenText: 'See you soon',
      });

      const [viaMixed, viaUk, wrongGender] = await t.run((ctx) =>
        Promise.all([
          findAudioAssetInAnyAccent(ctx, {
            language: 'en',
            voiceGender: 'female',
            spokenText: 'See you soon',
          }),
          findAudioAssetInAnyAccent(ctx, {
            language: 'en_gb',
            voiceGender: 'female',
            spokenText: 'See you soon',
          }),
          findAudioAssetInAnyAccent(ctx, {
            language: 'en',
            voiceGender: 'male',
            spokenText: 'See you soon',
          }),
        ]),
      );
      expect(viaMixed?.regionVariant).toBe('en-AU');
      // en_gb's pool is British only, so the Australian clip is not offered.
      expect(viaUk).toBeNull();
      expect(wrongGender).toBeNull();
    });
  });

  describe('flagTranslation', () => {
    it('on a US course retranslates only the real translation, the verbatim row is untouched', async () => {
      const t = convexTest(schema, modules);
      const { cardId, gbRowId, esRowId } = await t.run(async (ctx) => {
        const collectionId = await ctx.db.insert('collections', {
          name: 'A1',
          textCount: 0,
        });
        const courseId = await ctx.db.insert('courses', {
          userId: 'user_A',
          baseLanguages: ['en_us'],
          targetLanguages: ['es'],
        });
        await ctx.db.insert('userSettings', {
          userId: 'user_A',
          hasCompletedOnboarding: true,
          activeCourseId: courseId,
        });
        const deckId = await ctx.db.insert('decks', {
          courseId,
          name: 'd',
          cardCount: 1,
        });
        const textId = await ctx.db.insert('texts', {
          text: 'Hello world',
          language: 'en',
          userCreated: false,
          collectionId,
          collectionRank: 1,
          speakerGender: 'female',
          audioSpeakerGender: 'female',
        });
        const gbRowId = await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'en_us',
          translatedText: 'Hello world',
          translationSource: SOURCE_VERBATIM_TRANSLATION_SOURCE,
        });
        const esRowId = await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'es',
          translatedText: 'Hola mundo',
        });
        const cardId = await ctx.db.insert('cards', {
          deckId,
          textId,
          collectionId,
          collectionOrigin: 'premade',
          dueDate: Date.now() - 1000,
          isMastered: false,
          isHidden: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        await ctx.db.insert('usageQuotas', {
          userId: 'user_A',
          features: {
            translation_flags: {
              balance: 10,
              included: 10,
              used: 0,
              unlimited: false,
            },
          },
          lastSyncedAt: Date.now(),
        });
        return { cardId, gbRowId, esRowId };
      });

      const res = await t
        .withIdentity({ subject: 'user_A' })
        .mutation(api.features.scheduling.flagTranslation, { cardId });
      expect(res.retranslated).toBe(true);

      expect(llmEnqueues().map((e) => e.targetLanguage)).toEqual(['es']);
      const [gb, es] = await t.run((ctx) =>
        Promise.all([ctx.db.get(gbRowId), ctx.db.get(esRowId)]),
      );
      expect(gb?.flagCount).toBeUndefined();
      expect(es?.flagCount).toBe(1);
    });
  });
});
