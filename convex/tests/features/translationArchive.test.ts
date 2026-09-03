/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { llmPool } from '@/convex/lib/workpools';
import {
  buildCardSearchableText,
  buildTextContentBatchForLanguages,
} from '../../lib/cardContent';
import { ProbeNeedsWork } from '../../lib/contentScheduling';
import { deleteAudioRow } from '../../lib/audio';
import { scheduleMissingContent } from '../../features/decks';
import { scheduleMissingTranslationsForText } from '../../features/collections';
import {
  forkSharedTextForEdit,
  resolveCardEditPlan,
} from '../../features/cardEditPipeline';
import { cardPinAt, resolveServedFromLive } from '../../db/translationReads';
import {
  getCurrentTranslationVersion,
  getTtsProviderForLanguage,
} from '../../../lib/languages';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

// The workpools are module-mocked globally (tests/convexTestSetup.ts); the
// LLM pool's enqueue calls carry the worker's fnArgs as the third argument.
const llmEnqueues = () =>
  vi.mocked(llmPool.enqueueAction).mock.calls.map(
    (c) =>
      c[2] as {
        textId: Id<'texts'>;
        targetLanguage: string;
        replaceExisting?: boolean;
        translationReason?: string;
        ruleOverride?: string;
        preferredRegionVariant?: string;
        skipTts?: boolean;
      },
  );
beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
});

const OLD_DE = 'Alles in Ordnung?';
const NEW_DE = 'Alles klar?';
const DE_VOICE = 'de-DE-Chirp3-HD-Leda';

/**
 * A learner (user_A, course en→de) with one premade card whose German
 * translation is version-stale (stamped 1, every language is at ≥2) and has
 * audio. The card is pinned one minute in the past so the tests never race
 * the pin against `Date.now()` inside the store mutation.
 */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    withCard?: boolean;
    targetLanguages?: string[];
    extraTranslations?: { lang: string; text: string }[];
    flagsBalance?: number;
  } = {},
) {
  return t.run(async (ctx) => {
    const withCard = opts.withCard ?? true;
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: opts.targetLanguages ?? ['de'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'deck',
      cardCount: withCard ? 1 : 0,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Everything okay?',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
      // Pin the voice gender so the audio validity sweep never coin-flips
      // against the fixtures below, and mark source IPA as attempted so the
      // only content gaps in these tests are the ones the tests create.
      speakerGender: 'female',
      audioSpeakerGender: 'female',
      ipaText: '',
    });
    const translationId = await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'de',
      translatedText: OLD_DE,
      romanizedText: '',
      translationSource: 'openai/gpt-5.6-luna:nitro-none-bo3',
      speakerGender: 'female',
      translationVersion: 1,
    });
    for (const extra of opts.extraTranslations ?? []) {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: extra.lang,
        translatedText: extra.text,
        speakerGender: 'female',
        translationVersion: getCurrentTranslationVersion(extra.lang),
      });
    }
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    const { assetId, rowId: audioRowId } = await insertAudioFixture(ctx, {
      textId,
      language: 'de',
      voiceName: DE_VOICE,
      storageId,
      ttsQuality: 'validated',
      // The language's current provider, so the audio validity sweep has no
      // reason to replace the fixture.
      ttsProvider: getTtsProviderForLanguage('de'),
      voiceGender: 'female',
      spokenText: OLD_DE,
    });
    // Source-language audio, so a fully served card has no audio gap at all.
    await insertAudioFixture(ctx, {
      textId,
      language: 'en',
      voiceName: 'en-US-Chirp3-HD-Leda',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([4, 5])])),
      ttsQuality: 'validated',
      ttsProvider: getTtsProviderForLanguage('en'),
      voiceGender: 'female',
      spokenText: 'Everything okay?',
    });
    const pinAt = Date.now() - 60_000;
    let cardId: Id<'cards'> | null = null;
    if (withCard) {
      const built = await buildCardSearchableText(
        ctx,
        textId,
        'Everything okay?',
        ['en', ...(opts.targetLanguages ?? ['de'])],
      );
      cardId = await ctx.db.insert('cards', {
        deckId,
        textId,
        collectionId,
        collectionOrigin: 'premade',
        dueDate: Date.now() - 1000,
        isMastered: false,
        isHidden: false,
        schedulingPhase: 'preReview',
        preReviewCount: 0,
        translationsAcceptedAt: pinAt,
        ...built,
      });
    }
    const flagsBalance = opts.flagsBalance ?? 10;
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features: {
        translation_flags: {
          balance: flagsBalance,
          included: 10,
          used: 10 - flagsBalance,
          unlimited: false,
        },
      },
      lastSyncedAt: Date.now(),
    });
    return {
      courseId,
      deckId,
      textId,
      translationId,
      assetId,
      audioRowId,
      storageId,
      cardId,
      pinAt,
    };
  });
}

/** A version-bump replacement landing for `de`, as the LLM worker would store it. */
function bump(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  translatedText: string,
  extra: Record<string, unknown> = {},
) {
  return t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
    textId,
    targetLanguage: 'de',
    translatedText,
    voiceName: DE_VOICE,
    translationSource: 'openai/gpt-5.6-sol:floor-minimal',
    replaceExisting: true,
    translationReason: 'version_bump',
    skipTts: true,
    ...extra,
  });
}

function liveRow(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run(
    async (ctx) =>
      (await ctx.db
        .query('translations')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', textId).eq('targetLanguage', 'de'),
        )
        .unique())!,
  );
}

function archiveRows(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run((ctx) =>
    ctx.db
      .query('translationArchive')
      .withIndex('by_text_language_supersededAt', (q) =>
        q.eq('textId', textId).eq('targetLanguage', 'de'),
      )
      .collect(),
  );
}

function audioRows(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run((ctx) =>
    ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', textId).eq('language', 'de'),
      )
      .collect(),
  );
}

/** What a card pinned at `pinAt` is served for de, through the batch hydration. */
async function hydrate(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  pinAt: number | undefined,
  targetLanguages: string[] = ['de'],
) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const map = await buildTextContentBatchForLanguages(
      ctx,
      [
        {
          key: '0',
          textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          // Same tri-state handling as every real caller (`?? undefined`).
          sourceRomanization: text.romanizedText ?? undefined,
          sourceIpa: text.ipaText ?? undefined,
          sourceFurigana: text.furiganaText ?? undefined,
          userCreated: text.userCreated,
          ...(pinAt !== undefined ? { pinAt } : {}),
        },
      ],
      ['en'],
      targetLanguages,
      // Same semantics as the review query: legacy timing-less audio is not
      // a content gap.
      { ignoreMissingWordTimings: true },
    );
    const content = map.get('0')!;
    const de = content.translations.find((tr) => tr.language === 'de')!;
    const deAudio = content.audioRecordings.find((a) => a.language === 'de')!;
    return {
      text: de.text,
      romanization: de.romanization,
      retranslating: de.retranslating,
      audioUrl: deAudio.url,
      hasMissingContent: content.hasMissingContent,
    };
  });
}

describe('storeTranslationAndScheduleTTS with translationReason version_bump', () => {
  it('identical wording: restamps version + source only, keeps audio, writes no archive', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, audioRowId } = await seed(t);

    await bump(t, textId, OLD_DE);

    const row = await liveRow(t, textId);
    expect(row._id).toBe(translationId);
    expect(row.translatedText).toBe(OLD_DE);
    expect(row.translationVersion).toBe(getCurrentTranslationVersion('de'));
    expect(row.translationSource).toBe('openai/gpt-5.6-sol:floor-minimal');
    expect(row.lastArchivedAt).toBeUndefined();
    // The empty-string romanization sentinel survives a restamp untouched.
    expect(row.romanizedText).toBe('');
    expect(await archiveRows(t, textId)).toEqual([]);
    const audio = await audioRows(t, textId);
    expect(audio.map((a) => a._id)).toEqual([audioRowId]);
  });

  it('different wording with a referencing card: archives the old wording + asset, replaces the live row', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, assetId } = await seed(t);

    await bump(t, textId, NEW_DE);

    const row = await liveRow(t, textId);
    expect(row._id).toBe(translationId);
    expect(row.translatedText).toBe(NEW_DE);
    expect(row.translationVersion).toBe(getCurrentTranslationVersion('de'));
    expect(row.lastArchivedAt).toBeTypeOf('number');

    const archived = await archiveRows(t, textId);
    expect(archived.length).toBe(1);
    expect(archived[0]).toMatchObject({
      textId,
      targetLanguage: 'de',
      translatedText: OLD_DE,
      romanizedText: '',
      translationSource: 'openai/gpt-5.6-luna:nitro-none-bo3',
      speakerGender: 'female',
      translationVersion: 1,
      audioAssetId: assetId,
    });
    expect(archived[0].supersededAt).toBe(row.lastArchivedAt);

    // The live pointer was detached (the audio spoke the old wording) but
    // the asset itself survives for the pinned card.
    expect(await audioRows(t, textId)).toEqual([]);
    const asset = await t.run((ctx) => ctx.db.get(assetId));
    expect(asset).not.toBeNull();
  });

  it('different wording with no referencing card: plain replacement, no archive row', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, { withCard: false });

    await bump(t, textId, NEW_DE);

    const row = await liveRow(t, textId);
    expect(row.translatedText).toBe(NEW_DE);
    expect(row.lastArchivedAt).toBeUndefined();
    expect(await archiveRows(t, textId)).toEqual([]);
  });

  it('a flag retranslation still overwrites for everyone without archiving', async () => {
    const t = convexTest(schema, modules);
    const { textId, pinAt } = await seed(t);

    await bump(t, textId, NEW_DE, { translationReason: 'flag' });

    expect((await liveRow(t, textId)).translatedText).toBe(NEW_DE);
    expect(await archiveRows(t, textId)).toEqual([]);
    expect((await hydrate(t, textId, pinAt)).text).toBe(NEW_DE);
  });
});

describe('served revision resolution (convex/db/translationReads.ts)', () => {
  it('cardPinAt: translationsAcceptedAt wins, else _creationTime', () => {
    expect(cardPinAt({ _creationTime: 100, translationsAcceptedAt: 200 })).toBe(
      200,
    );
    expect(cardPinAt({ _creationTime: 100 })).toBe(100);
  });

  it('a card pinned before the bump is served the archived wording and its audio, and reports nothing missing', async () => {
    const t = convexTest(schema, modules);
    const { textId, pinAt } = await seed(t);
    await bump(t, textId, NEW_DE);

    const pinned = await hydrate(t, textId, pinAt);
    expect(pinned.text).toBe(OLD_DE);
    expect(pinned.audioUrl).toEqual(expect.any(String));
    expect(pinned.retranslating).toBe(false);
    // The live row's audio is gone until TTS lands, but the pinned card
    // plays the archived asset and must not ask the self-heal for work.
    expect(pinned.hasMissingContent).toBe(false);

    const unpinned = await hydrate(t, textId, undefined);
    expect(unpinned.text).toBe(NEW_DE);
    expect(unpinned.audioUrl).toBeNull();
    expect(unpinned.hasMissingContent).toBe(true);
  });

  it('a card pinned after the bump is served the live wording', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await bump(t, textId, NEW_DE);
    const after = (await liveRow(t, textId)).lastArchivedAt! + 1;

    expect((await hydrate(t, textId, after)).text).toBe(NEW_DE);
  });

  it('two bumps: each card gets the revision that was live at its pin', async () => {
    const t = convexTest(schema, modules);
    const { textId, pinAt } = await seed(t);
    await bump(t, textId, NEW_DE);
    const between = (await liveRow(t, textId)).lastArchivedAt! + 1;
    // Guarantee the second archive's supersededAt is strictly later.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await bump(t, textId, 'Ist alles gut?');
    const latest = (await liveRow(t, textId)).lastArchivedAt! + 1;

    expect((await archiveRows(t, textId)).map((r) => r.translatedText)).toEqual(
      [OLD_DE, NEW_DE],
    );
    expect((await hydrate(t, textId, pinAt)).text).toBe(OLD_DE);
    expect((await hydrate(t, textId, between)).text).toBe(NEW_DE);
    expect((await hydrate(t, textId, latest)).text).toBe('Ist alles gut?');
  });

  it('resolveServedFromLive costs no archive read for an un-archived row or a later pin', async () => {
    const t = convexTest(schema, modules);
    const { textId, pinAt } = await seed(t);
    const before = await t.run(async (ctx) => {
      const live = (await ctx.db
        .query('translations')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', textId).eq('targetLanguage', 'de'),
        )
        .unique())!;
      return resolveServedFromLive(ctx, live, pinAt);
    });
    expect(before.archived).toBe(false);
    expect(before.revisionId).toBe(before.live._id);
    expect(before.row.translatedText).toBe(OLD_DE);
  });
});

describe('search strings follow the served revision', () => {
  it('buildCardSearchableText with a pin holds the archived words; without, the live ones', async () => {
    const t = convexTest(schema, modules);
    const { textId, pinAt } = await seed(t);
    await bump(t, textId, NEW_DE);

    const { pinned, live } = await t.run(async (ctx) => ({
      pinned: await buildCardSearchableText(
        ctx,
        textId,
        'Everything okay?',
        ['en', 'de'],
        undefined,
        pinAt,
      ),
      live: await buildCardSearchableText(ctx, textId, 'Everything okay?', [
        'en',
        'de',
      ]),
    }));
    expect(pinned.searchableText).toContain('Ordnung');
    expect(pinned.searchableText).not.toContain('klar');
    expect(live.searchableText).toContain('klar');
    expect(live.searchableText).not.toContain('Ordnung');
  });

  it('the debounced rebuild fan-out keeps a pinned card on its archived words', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { textId, cardId } = await seed(t);
      await bump(t, textId, NEW_DE);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const card = await t.run(async (ctx) => (await ctx.db.get(cardId!))!);
      expect(card.searchableText).toContain('Ordnung');
      expect(card.searchableText).not.toContain('klar');
      expect(card.searchableTextLanguages).toEqual(['de']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('version-stale rows regenerate in place', () => {
  it('scheduleMissingContent keeps the row and audio and enqueues a version_bump replacement', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, audioRowId } = await seed(t);

    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });

    expect((await liveRow(t, textId))._id).toBe(translationId);
    expect((await liveRow(t, textId)).translatedText).toBe(OLD_DE);
    expect((await audioRows(t, textId)).map((a) => a._id)).toEqual([
      audioRowId,
    ]);
    const enqueued = llmEnqueues();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]).toMatchObject({
      textId,
      targetLanguage: 'de',
      replaceExisting: true,
      translationReason: 'version_bump',
    });
    // No `<previous_translation>` framing and no rule override: a bump is a
    // fresh rendering on the language's default chain.
    expect(enqueued[0].ruleOverride).toBeUndefined();
    const claim = await t.run((ctx) =>
      ctx.db
        .query('llmTranslationClaims')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', textId).eq('targetLanguage', 'de'),
        )
        .first(),
    );
    expect(claim).not.toBeNull();
  });

  it('a second sweep while the claim is fresh enqueues nothing more', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });
    expect(llmEnqueues().length).toBe(1);
  });

  it('probe mode reports the stale row as work without writing', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await expect(
      t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        await scheduleMissingContent(ctx, textId, text, ['en'], ['de'], {
          probe: true,
        });
      }),
    ).rejects.toBeInstanceOf(ProbeNeedsWork);
    expect(llmEnqueues().length).toBe(0);
    expect((await liveRow(t, textId)).translatedText).toBe(OLD_DE);
  });

  it('a current row is left alone', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(translationId, {
        translationVersion: getCurrentTranslationVersion('de'),
      });
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });
    expect(llmEnqueues().length).toBe(0);
  });

  it('the collection warm path (scheduleMissingTranslationsForText) does the same, translation-only', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, audioRowId } = await seed(t);

    const scheduled = await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      return scheduleMissingTranslationsForText(ctx, text, ['de']);
    });

    expect(scheduled).toBe(1);
    expect((await liveRow(t, textId))._id).toBe(translationId);
    expect((await audioRows(t, textId)).map((a) => a._id)).toEqual([
      audioRowId,
    ]);
    const enqueued = llmEnqueues();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]).toMatchObject({
      textId,
      targetLanguage: 'de',
      replaceExisting: true,
      translationReason: 'version_bump',
      skipTts: true,
    });
  });
});

describe('flagTranslation on a pinned card', () => {
  it('moves the card to the latest wording instead of retranslating, and audits it', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, translationId, pinAt } = await seed(t);
    await bump(t, textId, NEW_DE);
    expect((await hydrate(t, textId, pinAt)).text).toBe(OLD_DE);
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(api.features.scheduling.flagTranslation, {
      cardId: cardId!,
    });

    expect(res).toEqual({ retranslated: false, updatedToLatest: true });
    const card = await t.run(async (ctx) => (await ctx.db.get(cardId!))!);
    expect(card.translationsAcceptedAt).toBeGreaterThan(pinAt);
    expect(card.searchableText).toContain('klar');
    expect((await hydrate(t, textId, cardPinAt(card))).text).toBe(NEW_DE);
    // No complaint was counted against the live row, nothing was enqueued.
    expect((await t.run((ctx) => ctx.db.get(translationId)))!.flagCount).toBe(
      undefined,
    );
    expect(llmEnqueues().length).toBe(0);

    const edits = await t.run((ctx) =>
      ctx.db
        .query('cardEdits')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .collect(),
    );
    expect(edits.length).toBe(1);
    expect(edits[0]).toMatchObject({
      kind: 'accept_latest',
      path: 'none',
      cardIdBefore: cardId,
      cardIdAfter: cardId,
      textIdBefore: textId,
      textIdAfter: textId,
    });
    expect(edits[0].changes).toEqual([
      expect.objectContaining({
        language: 'de',
        role: 'target',
        isSourceLanguage: false,
        before: OLD_DE,
        after: NEW_DE,
        beforeTranslationSource: 'openai/gpt-5.6-luna:nitro-none-bo3',
      }),
    ]);
  });

  it('a card already on the live wording takes the normal retranslation path', async () => {
    const t = convexTest(schema, modules);
    const { cardId, translationId } = await seed(t);
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(api.features.scheduling.flagTranslation, {
      cardId: cardId!,
    });

    expect(res).toEqual({ retranslated: true, updatedToLatest: false });
    expect((await t.run((ctx) => ctx.db.get(translationId)))!.flagCount).toBe(
      1,
    );
    const enqueued = llmEnqueues();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]).toMatchObject({
      targetLanguage: 'de',
      ruleOverride: 'retranslation_high',
      replaceExisting: true,
    });
    const card = await t.run(async (ctx) => (await ctx.db.get(cardId!))!);
    expect(card.translationsAcceptedAt).toBeLessThan(Date.now() - 30_000);
  });

  it('mixed course: the archived language is accepted, the live one is flagged', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, {
      targetLanguages: ['de', 'fr'],
      extraTranslations: [{ lang: 'fr', text: 'Tout va bien ?' }],
    });
    await bump(t, textId, NEW_DE);
    const asUser = t.withIdentity({ subject: 'user_A' });

    const res = await asUser.mutation(api.features.scheduling.flagTranslation, {
      cardId: cardId!,
    });

    expect(res).toEqual({ retranslated: true, updatedToLatest: true });
    const enqueued = llmEnqueues();
    expect(enqueued.map((e) => e.targetLanguage)).toEqual(['fr']);
    const rows = await t.run((ctx) =>
      ctx.db
        .query('translations')
        .withIndex('by_textId', (q) => q.eq('textId', textId))
        .collect(),
    );
    expect(
      Object.fromEntries(rows.map((r) => [r.targetLanguage, r.flagCount])),
    ).toEqual({ de: undefined, fr: 1 });
    const kinds = await t.run(async (ctx) =>
      (
        await ctx.db
          .query('cardEdits')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
          .collect()
      )
        .map((e) => e.kind)
        .sort(),
    );
    expect(kinds).toEqual(['accept_latest', 'flag']);
  });
});

describe('editing a pinned card', () => {
  it('diffs against the served wording and forks the archived wording + asset', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, courseId, assetId } = await seed(t);
    await bump(t, textId, NEW_DE);

    const result = await t.run(async (ctx) => {
      const card = (await ctx.db.get(cardId!))!;
      const text = (await ctx.db.get(textId))!;
      const course = (await ctx.db.get(courseId))!;
      // Resubmitting exactly what the learner sees is not a change ...
      const unchanged = await resolveCardEditPlan(ctx, {
        userId: 'user_A',
        card,
        text,
        course,
        translations: [{ language: 'de', text: OLD_DE }],
        ensureUserOwnedText: true,
        proposedAudioSpeakerGender: undefined,
      });
      // ... while submitting the LIVE wording is one (the card never showed it).
      const changed = await resolveCardEditPlan(ctx, {
        userId: 'user_A',
        card,
        text,
        course,
        translations: [{ language: 'de', text: NEW_DE }],
        ensureUserOwnedText: false,
        proposedAudioSpeakerGender: undefined,
      });
      const forkedTextId = await forkSharedTextForEdit(ctx, {
        userId: 'user_A',
        card,
        text,
        plan: unchanged,
      });
      const forkedDe = await ctx.db
        .query('translations')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', forkedTextId).eq('targetLanguage', 'de'),
        )
        .unique();
      const forkedAudio = await ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', forkedTextId).eq('language', 'de'),
        )
        .collect();
      return {
        unchangedLangs: [...unchanged.changedLanguages],
        unchangedNeedsCopy: unchanged.needsCopy,
        changedLangs: [...changed.changedLanguages],
        forkedDe,
        forkedAudioAssets: forkedAudio.map((a) => a.assetId),
      };
    });

    expect(result.unchangedLangs).toEqual([]);
    expect(result.unchangedNeedsCopy).toBe(true);
    expect(result.changedLangs).toEqual(['de']);
    expect(result.forkedDe).toMatchObject({
      translatedText: OLD_DE,
      translationSource: 'openai/gpt-5.6-luna:nitro-none-bo3',
      translationVersion: 1,
    });
    expect(result.forkedAudioAssets).toEqual([assetId]);
  });
});

describe('archived audio survives garbage collection', () => {
  async function seedSharedAsset(t: TestConvex<typeof schema>) {
    return t.run(async (ctx) => {
      const collectionId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 0,
      });
      const textA = await ctx.db.insert('texts', {
        text: 'a',
        language: 'en',
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      const textB = await ctx.db.insert('texts', {
        text: 'b',
        language: 'en',
        userCreated: true,
        userId: 'user_A',
        collectionId,
        collectionRank: 2,
      });
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([9, 9, 9])]),
      );
      const { assetId, rowId: rowA } = await insertAudioFixture(ctx, {
        textId: textA,
        language: 'de',
        storageId,
        ttsQuality: 'validated',
        ttsProvider: 'google',
        spokenText: OLD_DE,
      });
      const { rowId: rowB } = await insertAudioFixture(ctx, {
        textId: textB,
        language: 'de',
        storageId,
        assetId,
        ttsQuality: 'validated',
        ttsProvider: 'google',
        spokenText: OLD_DE,
      });
      const archiveId = await ctx.db.insert('translationArchive', {
        textId: textA,
        targetLanguage: 'de',
        translatedText: OLD_DE,
        audioAssetId: assetId,
        supersededAt: Date.now(),
      });
      return { assetId, rowA, rowB, archiveId };
    });
  }

  it('deleting the last pointer keeps an asset an archive row still plays', async () => {
    const t = convexTest(schema, modules);
    const { assetId, rowA, rowB } = await seedSharedAsset(t);
    await t.run(async (ctx) => {
      await deleteAudioRow(ctx, (await ctx.db.get(rowA))!);
      await deleteAudioRow(ctx, (await ctx.db.get(rowB))!);
    });
    expect(await t.run((ctx) => ctx.db.get(assetId))).not.toBeNull();
  });

  it('without an archive reference the last pointer delete collects the asset as before', async () => {
    const t = convexTest(schema, modules);
    const { assetId, rowA, rowB, archiveId } = await seedSharedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(archiveId);
      await deleteAudioRow(ctx, (await ctx.db.get(rowA))!);
      await deleteAudioRow(ctx, (await ctx.db.get(rowB))!);
    });
    expect(await t.run((ctx) => ctx.db.get(assetId))).toBeNull();
  });
});

describe('type plumbing', () => {
  it('a Doc<"translationArchive"> carries every field a served row needs', () => {
    // Compile-time check: the archive row shape satisfies the served-row
    // pick used by every card-facing reader.
    const row: Doc<'translationArchive'> = {
      _id: 'x' as Id<'translationArchive'>,
      _creationTime: 0,
      textId: 'y' as Id<'texts'>,
      targetLanguage: 'de',
      translatedText: OLD_DE,
      supersededAt: 0,
    };
    expect(row.translatedText).toBe(OLD_DE);
  });
});
