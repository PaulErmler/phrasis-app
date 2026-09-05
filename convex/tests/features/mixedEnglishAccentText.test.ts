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
import { servedSourceText } from '../../db/translationReads';
import {
  getMixedAccentTextLanguage,
  getMixedAccentTextSince,
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

const SINCE = getMixedAccentTextSince('en')!;

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
      translationVersion: 3,
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
  pinAt: number | undefined,
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
          pinAt,
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
    };
  });
}

describe('Mixed English reads the accent row its voice accent points at', () => {
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
    it('a card pinned after the cutover reads the British wording, its annotations and its clip', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, SINCE + 1);

      expect(slot.text.text).toBe('The colour of the lift');
      expect(slot.text.ipa).toBe('ipa-gb');
      expect(slot.audio.voiceName).toBe('Leda@en-GB');
      expect(slot.audio.url).not.toBeNull();
      expect(slot.hasMissingContent).toBe(false);
    });

    it('a card pinned before the cutover keeps the source wording and its own clip for good', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, SINCE - 1);

      expect(slot.text.text).toBe('The color of the elevator');
      expect(slot.text.ipa).toBe('ipa-source');
      expect(slot.audio.voiceName).toBe('Leda@en-US');
      expect(slot.hasMissingContent).toBe(false);
    });

    it('a reader with no card (preview) reads the accent row', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, undefined);

      expect(slot.text.text).toBe('The colour of the lift');
    });

    it('a user-created sentence is always shown as typed', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb', {
        userCreated: true,
      });
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, SINCE + 1);

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

      const slot = await englishSlot(t, textId, SINCE + 1);

      expect(slot.text.text).toBe('The color of the elevator');
      expect(slot.audio.voiceName).toBe('Leda@en-US');
      expect(slot.hasMissingContent).toBe(true);
    });

    it('a US-voiced text reads the source wording whatever its pin', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, undefined);
      await seedAccentRowAndAudio(t, textId);

      const slot = await englishSlot(t, textId, SINCE + 1);

      expect(slot.text.text).toBe('The color of the elevator');
      expect(slot.audio.voiceName).toBe('Leda@en-US');
    });
  });

  describe('every other reader follows the same accessor', () => {
    it('servedSourceText: accent row after the cutover, source text before, source text while the row is missing', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      const before = await t.run(async (ctx) =>
        servedSourceText(ctx, (await ctx.db.get(textId))!, SINCE + 1),
      );
      expect(before).toMatchObject({
        text: 'The color of the elevator',
        language: 'en',
        served: null,
      });
      await seedAccentRowAndAudio(t, textId);
      const [after, pinnedBefore] = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return Promise.all([
          servedSourceText(ctx, text, SINCE + 1),
          servedSourceText(ctx, text, SINCE - 1),
        ]);
      });
      expect(after).toMatchObject({
        text: 'The colour of the lift',
        language: 'en_gb',
        ipaText: 'ipa-gb',
      });
      expect(after.served?.row.targetLanguage).toBe('en_gb');
      expect(pinnedBefore.text).toBe('The color of the elevator');
    });

    it('search text holds the British words for a card pinned after the cutover, the source words before', async () => {
      const t = convexTest(schema, modules);
      const textId = await seedEnglishTextWithAccentRow(t, 'en_gb');
      await seedAccentRowAndAudio(t, textId);
      const [after, before] = await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return Promise.all([
          buildCardSearchableText(
            ctx,
            textId,
            text.text,
            ['en', 'es'],
            text,
            SINCE + 1,
          ),
          buildCardSearchableText(
            ctx,
            textId,
            text.text,
            ['en', 'es'],
            text,
            SINCE - 1,
          ),
        ]);
      });
      expect(after.searchableText).toContain('colour of the lift');
      expect(after.searchableText).not.toContain('color of the elevator');
      expect(before.searchableText).toContain('color of the elevator');
      expect(before.searchableText).not.toContain('colour');
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
