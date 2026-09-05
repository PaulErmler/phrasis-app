/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import type { Doc, Id } from '../../_generated/dataModel';
import { api, internal } from '../../_generated/api';
import { createCardsFromTexts } from '../../features/collectionCardAdding';
import {
  cardRowLanguages,
  liveTranslation,
  translationRevisions,
  viewOfCard,
} from '../../db/translationReads';
import {
  getMixedAccentTextLanguage,
  getTtsProviderForLanguage,
  getVoiceForLanguage,
  pickAccentVariantForText,
} from '../../../lib/languages';
import { llmPool, ttsPool } from '../../lib/workpools';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

const llmEnqueues = () =>
  vi.mocked(llmPool.enqueueAction).mock.calls.map(
    (c) =>
      c[2] as {
        targetLanguage: string;
        translationReason?: string;
        userSuggestedTranslation?: string;
      },
  );
const ttsEnqueues = () =>
  vi
    .mocked(ttsPool.enqueueAction)
    .mock.calls.map((c) => c[2] as { language: string });

beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
  vi.mocked(ttsPool.enqueueAction).mockClear();
});

const SOURCE = 'The color of the elevator';
const GB = 'The colour of the lift';
const ES = 'El color del ascensor';

/**
 * A premade A1 collection (accessible to every course), a course for
 * user_A, its deck, quotas, and an `en` curriculum text whose id hashes to
 * the British accent row (`getMixedAccentTextLanguage`; ids are random, so
 * texts are inserted until one lands on it).
 */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    baseLanguages?: string[];
    targetLanguages?: string[];
    /** Seed the en_gb row (and its clip) as an LLM rewrite or verbatim. */
    accentRow?: 'rewrite' | 'verbatim' | 'none';
    accentAudio?: boolean;
  } = {},
) {
  const base = opts.baseLanguages ?? ['en'];
  const target = opts.targetLanguages ?? ['es'];
  const ids = await t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 1,
      origin: 'premade',
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: base,
      targetLanguages: target,
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 0,
    });
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        card_edits: { balance: 10, included: 10, used: 0, unlimited: false },
        translation_flags: {
          balance: 10,
          included: 10,
          used: 0,
          unlimited: false,
        },
        audio_regenerations: {
          balance: 10,
          included: 10,
          used: 0,
          unlimited: false,
        },
        sentences: { balance: 100, included: 100, used: 0, unlimited: false },
      },
      lastSyncedAt: Date.now(),
    });
    return { collectionId, courseId, deckId };
  });
  let textId: Id<'texts'> | null = null;
  for (let i = 0; i < 200 && textId === null; i++) {
    const candidate = await t.run((ctx) =>
      ctx.db.insert('texts', {
        text: SOURCE,
        language: 'en',
        userCreated: false,
        collectionId: ids.collectionId,
        collectionRank: 1,
        speakerGender: 'female',
        audioSpeakerGender: 'female',
        ipaText: '',
      }),
    );
    if (getMixedAccentTextLanguage('en', candidate) === 'en_gb') {
      textId = candidate;
    } else {
      await t.run((ctx) => ctx.db.delete(candidate));
    }
  }
  if (!textId) throw new Error('no text id hashed to en_gb');
  const resolvedTextId = textId;
  await t.run(async (ctx) => {
    const accentRow = opts.accentRow ?? 'rewrite';
    if (accentRow !== 'none') {
      await ctx.db.insert('translations', {
        textId: resolvedTextId,
        targetLanguage: 'en_gb',
        translatedText: accentRow === 'rewrite' ? GB : SOURCE,
        translationSource:
          accentRow === 'rewrite'
            ? 'openai/gpt-5.6-luna:nitro-none'
            : 'source-verbatim',
        translationVersion: 3,
        ipaText: 'ipa-gb',
        speakerGender: 'female',
      });
      if (opts.accentAudio ?? true) {
        await insertAudioFixture(ctx, {
          textId: resolvedTextId,
          language: 'en_gb',
          voiceName: 'Leda@en-GB',
          spokenText: accentRow === 'rewrite' ? GB : SOURCE,
          ttsProvider: getTtsProviderForLanguage('en_gb'),
          voiceGender: 'female',
          storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
          ttsQuality: 'validated',
          wordTimings: [{ word: 'The', start: 0, end: 0.2 }],
        });
      }
    }
    await insertAudioFixture(ctx, {
      textId: resolvedTextId,
      language: 'en',
      // In the text's own accent, so the drift sweep has nothing to re-voice.
      voiceName: 'Leda@en-GB',
      spokenText: SOURCE,
      ttsProvider: getTtsProviderForLanguage('en'),
      voiceGender: 'female',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([2])])),
      ttsQuality: 'validated',
      wordTimings: [{ word: 'The', start: 0, end: 0.2 }],
    });
    for (const lang of target.filter((l) => l !== 'en')) {
      await ctx.db.insert('translations', {
        textId: resolvedTextId,
        targetLanguage: lang,
        translatedText: lang === 'es' ? ES : `${lang} wording`,
        translationSource: 'openai/gpt-5.6-luna:nitro-none',
        ipaText: '',
        speakerGender: 'female',
      });
      await insertAudioFixture(ctx, {
        textId: resolvedTextId,
        language: lang,
        ttsProvider: getTtsProviderForLanguage(lang),
        voiceGender: 'female',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([3])])),
        ttsQuality: 'validated',
        wordTimings: [{ word: 'El', start: 0, end: 0.2 }],
      });
    }
  });
  return { ...ids, textId: resolvedTextId };
}

/** Add the text to the deck the way the app does, and return the card. */
async function addCard(
  t: TestConvex<typeof schema>,
  ids: Awaited<ReturnType<typeof seed>>,
): Promise<Doc<'cards'>> {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(ids.textId))!;
    const deck = (await ctx.db.get(ids.deckId))!;
    const course = (await ctx.db.get(ids.courseId))!;
    await createCardsFromTexts(ctx, [text], deck, ids.collectionId, course);
    const card = await ctx.db
      .query('cards')
      .withIndex('by_deckId_and_textId', (q) =>
        q.eq('deckId', ids.deckId).eq('textId', ids.textId),
      )
      .first();
    return card!;
  });
}

const audioRows = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  language: string,
) =>
  t.run((ctx) =>
    ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', textId).eq('language', language),
      )
      .collect(),
  );

describe('cards.accentLanguage', () => {
  it('a new card on a Mixed English course stores the accent its text speaks in', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const card = await addCard(t, ids);
    expect(card.accentLanguage).toBe('en_gb');
    expect(card.accentLanguage).toBe(
      pickAccentVariantForText('en', ids.textId),
    );
    // The search string holds the British words from the start.
    expect(card.searchableText).toContain('colour of the lift');
  });

  it("a card on a course that does not show the text's own language stores none", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, {
      baseLanguages: ['de'],
      targetLanguages: ['en_gb'],
    });
    const card = await addCard(t, ids);
    expect(card.accentLanguage).toBeUndefined();
  });

  it('cardRowLanguages swaps the source slot for the accent row, and only then', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const card = await addCard(t, ids);
    const text = await t.run((ctx) => ctx.db.get(ids.textId));
    expect(cardRowLanguages(text!, viewOfCard(card), ['en', 'es'])).toEqual([
      'en_gb',
      'es',
    ]);
    expect(
      cardRowLanguages(text!, { accentLanguage: 'en_us' }, ['en', 'es']),
    ).toEqual(['en', 'es']);
    expect(cardRowLanguages(text!, {}, ['en', 'es'])).toEqual(['en', 'es']);
  });
});

describe('editing a Mixed English card', () => {
  it('fixing only the Spanish line is a Spanish-only edit: the copy keeps the British wording and clip', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const card = await addCard(t, ids);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.scheduling.editCard, {
      cardId: card._id,
      // Every line, as the dialog submits them: the English one untouched.
      translations: [
        { language: 'en', text: GB },
        { language: 'es', text: 'El color del ascensor.' },
      ],
      timezone: 'UTC',
    });

    const after = (await t.run((ctx) => ctx.db.get(card._id)))!;
    const copy = (await t.run((ctx) => ctx.db.get(after.textId)))!;
    // Forked (shared text), the copy shows what the learner saw.
    expect(after.textId).not.toBe(ids.textId);
    expect(copy.userCreated).toBe(true);
    expect(copy.text).toBe(GB);
    expect(copy.ipaText).toBe('ipa-gb');
    // The copy has no accent rows of its own.
    expect(after.accentLanguage).toBeUndefined();
    // The audit names only the Spanish line.
    const edits = await t.run((ctx) => ctx.db.query('cardEdits').collect());
    expect(edits).toHaveLength(1);
    expect(edits[0].changes.map((c) => c.language)).toEqual(['es']);
    expect(edits[0].sourceText).toBe(GB);
    // The English clip travels with the copy: the British one.
    const enAudio = await audioRows(t, after.textId, 'en');
    expect(enAudio).toHaveLength(1);
    const gbAudio = await audioRows(t, ids.textId, 'en_gb');
    expect(enAudio[0].assetId).toBe(gbAudio[0].assetId);
    // The Spanish correction is still offered to the curriculum.
    const esRow = await t.run((ctx) => liveTranslation(ctx, ids.textId, 'es'));
    expect(esRow?.flagCount).toBe(1);
  });

  it('editing the British line corrects the en_gb row, not the catalogue text', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const card = await addCard(t, ids);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.scheduling.editCard, {
      cardId: card._id,
      translations: [
        { language: 'en', text: 'The colour of the elevator' },
        { language: 'es', text: ES },
      ],
      timezone: 'UTC',
    });

    const edits = await t.run((ctx) => ctx.db.query('cardEdits').collect());
    expect(edits[0].changes).toEqual([
      expect.objectContaining({
        language: 'en',
        isSourceLanguage: true,
        before: GB,
        after: 'The colour of the elevator',
        beforeTranslationSource: 'openai/gpt-5.6-luna:nitro-none',
      }),
    ]);
    // The curriculum fix goes to the accent row, with the learner's wording.
    const gbRow = await t.run((ctx) =>
      liveTranslation(ctx, ids.textId, 'en_gb'),
    );
    expect(gbRow?.flagCount).toBe(1);
    const fix = llmEnqueues().find(
      (e) => e.translationReason === 'curriculum_fix',
    );
    expect(fix).toMatchObject({
      targetLanguage: 'en_gb',
      userSuggestedTranslation: 'The colour of the elevator',
    });
    // The shared catalogue text is untouched.
    const original = (await t.run((ctx) => ctx.db.get(ids.textId)))!;
    expect(original.text).toBe(SOURCE);
  });
});

describe('flagging a Mixed English card', () => {
  it('disputes the accent row the card shows, like any translation', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const card = await addCard(t, ids);
    const asUser = t.withIdentity({ subject: 'user_A' });

    const result = await asUser.mutation(
      api.features.scheduling.flagTranslation,
      { cardId: card._id },
    );

    expect(result.retranslated).toBe(true);
    const gbRow = await t.run((ctx) =>
      liveTranslation(ctx, ids.textId, 'en_gb'),
    );
    expect(gbRow?.flagCount).toBe(1);
    expect(
      llmEnqueues()
        .map((e) => e.targetLanguage)
        .sort(),
    ).toEqual(['en_gb', 'es']);
  });
});

describe('regenerating audio', () => {
  it('re-voices the accent clip a Mixed English card plays', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const card = await addCard(t, ids);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.scheduling.regenerateCardAudio, {
      cardId: card._id,
      timezone: 'UTC',
    });

    expect(
      ttsEnqueues()
        .map((e) => e.language)
        .sort(),
    ).toEqual(['en_gb', 'es']);
    // The source clip the card never plays is left alone.
    expect(await audioRows(t, ids.textId, 'en')).toHaveLength(1);
  });

  it("on a course that does not show the text's language, leaves the accent rows of other courses alone", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, {
      baseLanguages: ['de'],
      targetLanguages: ['en_gb'],
    });
    // Another learner's Australian row and clip for the same text.
    await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId: ids.textId,
        targetLanguage: 'en_au',
        translatedText: 'The colour of the lift',
        translationSource: 'openai/gpt-5.6-luna:nitro-none',
        translationVersion: 3,
        speakerGender: 'female',
      });
      await insertAudioFixture(ctx, {
        textId: ids.textId,
        language: 'en_au',
        voiceName: 'Leda@en-AU',
        ttsProvider: getTtsProviderForLanguage('en_au'),
        voiceGender: 'female',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([9])])),
        ttsQuality: 'validated',
      });
      await ctx.db.insert('translations', {
        textId: ids.textId,
        targetLanguage: 'de',
        translatedText: 'Die Farbe des Aufzugs',
        translationSource: 'openai/gpt-5.6-luna:nitro-none',
        speakerGender: 'female',
      });
    });
    const card = await addCard(t, ids);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.scheduling.regenerateCardAudio, {
      cardId: card._id,
      timezone: 'UTC',
    });

    expect(await audioRows(t, ids.textId, 'en_au')).toHaveLength(1);
    expect(ttsEnqueues().map((e) => e.language)).not.toContain('en_au');
  });
});

describe('the accent drift sweep', () => {
  it('leaves a user-created text on the accent it was voiced in', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    // A card-edit copy: user-owned, carrying the shared text's British clip,
    // under a fresh id whose hash may say another accent.
    const copyId = await t.run(async (ctx) => {
      const copyId = await ctx.db.insert('texts', {
        text: GB,
        language: 'en',
        userCreated: true,
        userId: 'user_A',
        collectionId: ids.collectionId,
        collectionRank: 1,
        speakerGender: 'female',
        audioSpeakerGender: 'female',
        ipaText: '',
      });
      await insertAudioFixture(ctx, {
        textId: copyId,
        language: 'en',
        voiceName: 'Leda@en-GB',
        spokenText: GB,
        regionVariant: 'en-GB',
        ttsProvider: getTtsProviderForLanguage('en'),
        voiceGender: 'female',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([7])])),
        ttsQuality: 'validated',
        wordTimings: [{ word: 'The', start: 0, end: 0.2 }],
      });
      await ctx.db.insert('translations', {
        textId: copyId,
        targetLanguage: 'es',
        translatedText: ES,
        translationSource: 'user-provided',
        ipaText: '',
        speakerGender: 'female',
      });
      await insertAudioFixture(ctx, {
        textId: copyId,
        language: 'es',
        ttsProvider: getTtsProviderForLanguage('es'),
        voiceGender: 'female',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([8])])),
        ttsQuality: 'validated',
        wordTimings: [{ word: 'El', start: 0, end: 0.2 }],
      });
      return copyId;
    });

    await t.run(async (ctx) => {
      const { scheduleMissingContent } = await import('../../features/decks');
      const text = (await ctx.db.get(copyId))!;
      await scheduleMissingContent(ctx, copyId, text, ['en'], ['es']);
    });

    expect(await audioRows(t, copyId, 'en')).toHaveLength(1);
    expect(ttsEnqueues()).toEqual([]);
  });
});

describe('the version bump of a verbatim accent row', () => {
  it('replaces the row in place instead of pinning the referencing card to the un-rewritten copy', async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { accentRow: 'verbatim' });
    const card = await addCard(t, ids);

    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId: ids.textId,
      targetLanguage: 'en_gb',
      translatedText: GB,
      voiceName: getVoiceForLanguage('en_gb', 'female'),
      translationSource: 'openai/gpt-5.6-luna:nitro-none',
      speakerGender: 'female',
      replaceExisting: true,
      translationReason: 'version_bump',
      skipTts: true,
    });

    const rows = await t.run((ctx) =>
      translationRevisions(ctx, ids.textId, 'en_gb'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].translatedText).toBe(GB);
    expect(rows[0].supersededAt).toBeUndefined();
    // The card reads the rewrite.
    const content = await t.run(async (ctx) => {
      const { buildTextContentBatchForLanguages } =
        await import('../../lib/cardContent');
      const text = (await ctx.db.get(ids.textId))!;
      const map = await buildTextContentBatchForLanguages(
        ctx,
        [
          {
            key: 'k',
            textId: ids.textId,
            sourceText: text.text,
            sourceLanguage: 'en',
            userCreated: false,
            view: viewOfCard(card),
          },
        ],
        ['en'],
        ['es'],
      );
      return map.get('k')!;
    });
    expect(content.translations.find((tr) => tr.language === 'en')?.text).toBe(
      GB,
    );
  });
});

describe('the collection preview audio button', () => {
  it("voices the accent row the preview shows for the text's own language", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { accentAudio: false });
    const asUser = t.withIdentity({ subject: 'user_A' });

    const result = await asUser.mutation(
      api.features.collections.requestPreviewAudio,
      { textId: ids.textId, language: 'en' },
    );

    expect(result.scheduled).toBe(true);
    expect(ttsEnqueues().map((e) => e.language)).toEqual(['en_gb']);
  });
});
