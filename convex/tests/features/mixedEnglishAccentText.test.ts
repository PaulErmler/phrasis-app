/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import { api } from '../../_generated/api';
import { scheduleMissingContent } from '../../features/decks';
import { scheduleMissingTranslationsForText } from '../../features/collections';
import {
  buildCardSearchableText,
  buildTextContentBatchForLanguages,
} from '../../lib/cardContent';
import {
  liveTranslation,
  servedSourceText,
  type SourceView,
} from '../../db/translationReads';
import {
  getCurrentTranslationVersion,
  getMixedAccentTextLanguage,
} from '../../../lib/languages';
import { llmPool, ttsPool } from '../../lib/workpools';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

const llmEnqueues = () =>
  vi
    .mocked(llmPool.enqueueAction)
    .mock.calls.map((c) => c[2] as { targetLanguage: string });

beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
  vi.mocked(ttsPool.enqueueAction).mockClear();
});

/** A card that stored the British accent at creation. */
const GB_CARD: SourceView = { accentLanguage: 'en_gb' };
/** A card that stored the American accent: reads the catalogue as is. */
const US_CARD: SourceView = { accentLanguage: 'en_us' };
/** A card from before the accent field existed. */
const OLD_CARD: SourceView = {};

/**
 * A premade `en` sentence whose id hashes to the wanted accent row
 * (`getMixedAccentTextLanguage`): ids are random, so texts are inserted
 * until one lands on it (a handful of tries on a three-accent pool).
 */
async function seedEnglishTextWithAccentRow(
  t: TestConvex<typeof schema>,
  wanted: string | undefined,
  opts?: { userCreated?: boolean },
): Promise<Id<'texts'>> {
  for (let i = 0; i < 200; i++) {
    const textId = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 0,
      });
      return ctx.db.insert('texts', {
        text: 'The color of the elevator',
        language: 'en',
        userCreated: opts?.userCreated ?? false,
        ...(opts?.userCreated ? { userId: 'user_A' } : {}),
        collectionId,
        collectionRank: 1,
        speakerGender: 'female',
        audioSpeakerGender: 'female',
      });
    });
    if (getMixedAccentTextLanguage('en', textId) === wanted) return textId;
    await t.run((ctx) => ctx.db.delete(textId));
  }
  throw new Error(`no text id hashed to ${wanted}`);
}

async function sweep(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    return scheduleMissingContent(ctx, textId, text, ['en'], ['es']);
  });
}

/** Seed the en_gb rewrite row with its audio, plus the source `en` audio. */
async function seedAccentRowAndAudio(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'en_gb',
      translatedText: 'The colour of the lift',
      translationSource: 'openai/gpt-5.6-luna:nitro-none',
      translationVersion: getCurrentTranslationVersion('en_gb'),
      ipaText: 'ipa-gb',
      speakerGender: 'female',
    });
    await insertAudioFixture(ctx, {
      textId,
      language: 'en_gb',
      voiceName: 'Leda@en-GB',
      spokenText: 'The colour of the lift',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
      ttsQuality: 'validated',
      wordTimings: [{ word: 'The', start: 0, end: 0.2 }],
    });
    await insertAudioFixture(ctx, {
      textId,
      language: 'en',
      voiceName: 'Leda@en-US',
      spokenText: 'The color of the elevator',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([2])])),
      ttsQuality: 'validated',
      wordTimings: [{ word: 'The', start: 0, end: 0.2 }],
    });
    // The course's Spanish side, complete, so `hasMissingContent` is
    // driven by the English slot alone.
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'es',
      translatedText: 'El color del ascensor',
      ipaText: 'ipa-es',
    });
    await insertAudioFixture(ctx, {
      textId,
      language: 'es',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([3])])),
      ttsQuality: 'validated',
      wordTimings: [{ word: 'El', start: 0, end: 0.2 }],
    });
  });
}

async function englishSlot(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  view: SourceView | null,
  opts?: { userCreated?: boolean },
) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const map = await buildTextContentBatchForLanguages(
      ctx,
      [
        {
          key: 'k',
          textId,
          sourceText: text.text,
          sourceLanguage: 'en',
          sourceIpa: 'ipa-source',
          userCreated: opts?.userCreated ?? text.userCreated,
          view,
        },
      ],
      ['en'],
      ['es'],
    );
    const result = map.get('k')!;
    return {
      text: result.translations.find((tr) => tr.language === 'en')!,
      audio: result.audioRecordings.find((a) => a.language === 'en')!,
      hasMissingContent: result.hasMissingContent,
      missingTranslationLanguages: result.missingTranslationLanguages,
    };
  });
}

describe('Mixed English reads the accent row its card stored', () => {
  describe('the ensure sweep', () => {
    it('asks for the en_gb rewrite of a British-voiced text on a Mixed English course', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');

      await sweep(t, textId);

      expect(
        llmEnqueues()
          .map((e) => e.targetLanguage)
          .sort(),
      ).toEqual(['en_gb', 'es']);
    });

    it('leaves a US-voiced text on the catalogue wording', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, undefined);

      await sweep(t, textId);

      expect(llmEnqueues().map((e) => e.targetLanguage)).toEqual(['es']);
    });

    it('never rewrites a user-created sentence', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb', {
        userCreated: true,
      });

      await sweep(t, textId);

      expect(llmEnqueues().map((e) => e.targetLanguage)).toEqual(['es']);
    });

    it('does not derive the row when the course does not use Mixed English', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');

      await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return scheduleMissingContent(ctx, textId, text, ['de'], ['es']);
      });

      expect(
        llmEnqueues()
          .map((e) => e.targetLanguage)
          .sort(),
      ).toEqual(['de', 'es']);
    });
  });

  describe('card content', () => {
    it('a card with the British accent reads the British wording, its annotations and its clip', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, GB_CARD);

      expect(slot.text.text).toBe('The colour of the lift');
      expect(slot.text.ipa).toBe('ipa-gb');
      expect(slot.audio.voiceName).toBe('Leda@en-GB');
      expect(slot.audio.url).not.toBeNull();
      expect(slot.hasMissingContent).toBe(false);
      expect(slot.missingTranslationLanguages).toEqual([]);
    });

    it('a card from before the accent field keeps the source wording and its own clip for good', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, OLD_CARD);

      expect(slot.text.text).toBe('The color of the elevator');
      expect(slot.text.ipa).toBe('ipa-source');
      expect(slot.audio.voiceName).toBe('Leda@en-US');
      expect(slot.hasMissingContent).toBe(false);
    });

    it('a reader with no card (preview) reads the accent row', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, null);

      expect(slot.text.text).toBe('The colour of the lift');
    });

    it('a user-created sentence is always shown as typed', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb', {
        userCreated: true,
      });
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, GB_CARD);

      expect(slot.text.text).toBe('The color of the elevator');
      expect(slot.audio.voiceName).toBe('Leda@en-US');
    });

    it('while the accent row is missing the card shows the source wording and asks for the row', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await t.run(async (ctx) => {
        await insertAudioFixture(ctx, {
          textId,
          language: 'en',
          voiceName: 'Leda@en-US',
          storageId: await ctx.storage.store(new Blob([new Uint8Array([2])])),
          ttsQuality: 'validated',
          wordTimings: [{ word: 'The', start: 0, end: 0.2 }],
        });
        await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'es',
          translatedText: 'El color del ascensor',
          ipaText: 'ipa-es',
        });
        await insertAudioFixture(ctx, {
          textId,
          language: 'es',
          storageId: await ctx.storage.store(new Blob([new Uint8Array([3])])),
          ttsQuality: 'validated',
          wordTimings: [{ word: 'El', start: 0, end: 0.2 }],
        });
      });

      const slot = await englishSlot(t, textId, GB_CARD);

      expect(slot.text.text).toBe('The color of the elevator');
      expect(slot.audio.voiceName).toBe('Leda@en-US');
      expect(slot.hasMissingContent).toBe(true);
      // The preview's request list names the source language for it.
      expect(slot.missingTranslationLanguages).toEqual(['en']);
    });

    it('a preview lists the source language when its accent row is version-stale', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);
      await t.run(async (ctx) => {
        const row = (await liveTranslation(ctx, textId, 'en_gb'))!;
        await ctx.db.patch(row._id, {
          translationVersion: getCurrentTranslationVersion('en_gb') - 1,
        });
      });

      const missing = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        const map = await buildTextContentBatchForLanguages(
          ctx,
          [
            {
              key: 'k',
              textId,
              sourceText: text.text,
              sourceLanguage: 'en',
              userCreated: false,
              view: null,
            },
          ],
          ['en'],
          ['es'],
          { markVersionStale: true },
        );
        return map.get('k')!.missingTranslationLanguages;
      });

      expect(missing).toEqual(['en']);
    });

    it('a card with the American accent reads the source wording', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, US_CARD);

      expect(slot.text.text).toBe('The color of the elevator');
      expect(slot.audio.voiceName).toBe('Leda@en-US');
      expect(slot.hasMissingContent).toBe(false);
    });
  });

  describe('every other reader follows the same accessor', () => {
    it('servedSourceText: the accent row for a card with the accent, the source text without, and while the row is missing', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      const before = await t.run(async (ctx) =>
        servedSourceText(ctx, (await ctx.db.get(textId))!, GB_CARD),
      );
      expect(before).toMatchObject({
        text: 'The color of the elevator',
        language: 'en',
        served: null,
      });
      await seedAccentRowAndAudio(t, textId);
      const [withAccent, oldCard, preview] = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return Promise.all([
          servedSourceText(ctx, text, GB_CARD),
          servedSourceText(ctx, text, OLD_CARD),
          servedSourceText(ctx, text, null),
        ]);
      });
      expect(withAccent).toMatchObject({
        text: 'The colour of the lift',
        language: 'en_gb',
        ipaText: 'ipa-gb',
      });
      expect(withAccent.served?.row.targetLanguage).toBe('en_gb');
      expect(oldCard.text).toBe('The color of the elevator');
      expect(preview.text).toBe('The colour of the lift');
    });

    it('search text holds the British words for a card with the accent, the source words for an old card', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);
      const [withAccent, oldCard] = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return Promise.all([
          buildCardSearchableText(ctx, textId, ['en', 'es'], {
            text,
            view: GB_CARD,
          }),
          buildCardSearchableText(ctx, textId, ['en', 'es'], {
            text,
            view: OLD_CARD,
          }),
        ]);
      });
      expect(withAccent.searchableText).toContain('colour of the lift');
      expect(withAccent.searchableText).not.toContain('color of the elevator');
      expect(oldCard.searchableText).toContain('color of the elevator');
      expect(oldCard.searchableText).not.toContain('colour');
    });

    it('the placement test renders and voices the accent row', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);
      await t.run((ctx) =>
        ctx.db.insert('placementTestSentences', {
          level: 1,
          position: 1,
          textId,
        }),
      );
      const sentence = await t.query(
        api.features.placementTest.getPlacementSentence,
        {
          level: 1,
          position: 1,
          targetLanguage: 'es',
          sourceLanguage: 'en',
        },
      );
      expect(sentence).toMatchObject({
        sourceText: 'The colour of the lift',
        sourceLanguage: 'en',
        targetText: 'El color del ascensor',
      });
      expect(sentence?.sourceAudioUrl).not.toBeNull();
      const preview = await t.query(
        api.features.placementTest.getPlacementPreviewSentences,
        { targetLanguage: 'en', sourceLanguage: 'es' },
      );
      expect(preview.map((row) => row.targetText)).toEqual([
        'The colour of the lift',
      ]);
    });

    it('the placement test falls back to the source text on the target side while the accent row is missing', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await t.run((ctx) =>
        ctx.db.insert('placementTestSentences', {
          level: 1,
          position: 1,
          textId,
        }),
      );
      const sentence = await t.query(
        api.features.placementTest.getPlacementSentence,
        {
          level: 1,
          position: 1,
          targetLanguage: 'en',
          sourceLanguage: 'es',
        },
      );
      expect(sentence?.targetText).toBe('The color of the elevator');
      const preview = await t.query(
        api.features.placementTest.getPlacementPreviewSentences,
        { targetLanguage: 'en', sourceLanguage: 'es' },
      );
      expect(preview.map((row) => row.targetText)).toEqual([
        'The color of the elevator',
      ]);
    });

    it('the collection preview requests the accent row too', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        await scheduleMissingTranslationsForText(ctx, text, ['en', 'es']);
      });
      expect(
        llmEnqueues()
          .map((e) => e.targetLanguage)
          .sort(),
      ).toEqual(['en_gb', 'es']);
    });
  });
});
