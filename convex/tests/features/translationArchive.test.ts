/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { llmPool, ttsPool } from '@/convex/lib/workpools';
import {
  buildCardSearchableText,
  buildTextContentBatchForLanguages,
} from '../../lib/cardContent';
import { ProbeNeedsWork } from '../../lib/contentScheduling';
import { IPA_SOURCES } from '../../lib/textAnnotations';
import { deleteAudioRow } from '../../lib/audio';
import { scheduleMissingContent } from '../../features/decks';
import { scheduleMissingTranslationsForText } from '../../features/collections';
import {
  forkSharedTextForEdit,
  resolveCardEditPlan,
} from '../../features/cardEditPipeline';
import {
  cardPinAt,
  liveTranslation,
  resolveServedFromLive,
  splitRevisions,
  translationRevisions,
} from '../../db/translationReads';
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
const ttsEnqueues = () =>
  vi.mocked(ttsPool.enqueueAction).mock.calls.map(
    (c) =>
      c[2] as {
        textId: Id<'texts'>;
        text: string;
        language: string;
        forceRegen?: boolean;
        archivedTranslationId?: Id<'translations'>;
      },
  );
beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
  vi.mocked(ttsPool.enqueueAction).mockClear();
});

/** What the stubbed espeak engine yields for any input (tests/convexTestSetup.ts). */
const MOCK_IPA = 'mˈɒkaɪpiːeɪ';

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
    /** Pre-fill IPA on the seeded German row (so a bump copies a complete revision). */
    ipaText?: string;
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
      ...(opts.ipaText !== undefined
        ? { ipaText: opts.ipaText, ipaSource: IPA_SOURCES.espeakNg }
        : {}),
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
        audio_regenerations: {
          balance: 5,
          included: 5,
          used: 0,
          unlimited: false,
        },
        card_edits: {
          balance: 5,
          included: 5,
          used: 0,
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

/**
 * As if the TTS job a bump enqueued for the new live wording (a card
 * references the text, so `skipTts` is overridden) had completed: release
 * its claim and forget the enqueue, so the assertions below see only the
 * work of the step under test.
 */
async function settleTts(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  await t.run(async (ctx) => {
    const claims = await ctx.db
      .query('ttsGenerationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', textId).eq('language', 'de'),
      )
      .collect();
    for (const claim of claims) await ctx.db.delete(claim._id);
  });
  vi.mocked(ttsPool.enqueueAction).mockClear();
}

function liveRow(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run(async (ctx) => (await liveTranslation(ctx, textId, 'de'))!);
}

/** The superseded `de` revisions of a text, oldest-superseded first. */
function archiveRows(t: TestConvex<typeof schema>, textId: Id<'texts'>) {
  return t.run(
    async (ctx) =>
      splitRevisions(await translationRevisions(ctx, textId, 'de')).superseded,
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

  it('different wording, referencing card, but no audio yet: plain replacement, card reads live and reports audio missing', async () => {
    // A warmed row (preview / warmup, skipTts) replaced before its first TTS.
    // Archiving it would pin the card to a wording nothing ever voices, and
    // archived entries never report gaps, so the card would stay mute.
    const t = convexTest(schema, modules);
    const { textId, translationId, pinAt } = await seed(t);
    await t.run(async (ctx) => {
      for (const row of await ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', textId).eq('language', 'de'),
        )
        .collect()) {
        await deleteAudioRow(ctx, row);
      }
    });

    await bump(t, textId, NEW_DE);

    const row = await liveRow(t, textId);
    expect(row._id).toBe(translationId);
    expect(row.translatedText).toBe(NEW_DE);
    expect(row.lastArchivedAt).toBeUndefined();
    expect(await archiveRows(t, textId)).toEqual([]);

    const pinned = await hydrate(t, textId, pinAt);
    expect(pinned.text).toBe(NEW_DE);
    expect(pinned.audioUrl).toBeNull();
    // The self-heal must be able to fill the new wording's audio.
    expect(pinned.hasMissingContent).toBe(true);
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
    // The seeded row is complete (IPA filled), so the copy is too.
    const { textId, pinAt } = await seed(t, { ipaText: 'ˈaləs' });
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

  it('an archive row without audio is never served (pre-rule rows fall through to live)', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, pinAt } = await seed(t);
    await t.run(async (ctx) => {
      const supersededAt = Date.now();
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'de',
        translatedText: OLD_DE,
        translationVersion: 1,
        supersededAt,
      });
      await ctx.db.patch(translationId, {
        translatedText: NEW_DE,
        lastArchivedAt: supersededAt,
      });
    });

    const pinned = await hydrate(t, textId, pinAt);
    expect(pinned.text).toBe(NEW_DE);
    expect(pinned.retranslating).toBe(false);
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
    // The middle wording gets its audio (the bump above skipped TTS), so the
    // second bump has something to archive; an unvoiced wording is replaced
    // in place instead, see the "no audio yet" case above.
    await t.run(async (ctx) => {
      await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        voiceName: DE_VOICE,
        storageId: await ctx.storage.store(new Blob([new Uint8Array([7])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('de'),
        voiceGender: 'female',
        spokenText: NEW_DE,
      });
    });
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
      const live = (await liveTranslation(ctx, textId, 'de'))!;
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
      const forkedDe = await liveTranslation(ctx, forkedTextId, 'de');
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
      const archiveId = await ctx.db.insert('translations', {
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

describe('the live row is never a superseded one', () => {
  it('liveTranslation skips superseded rows however they were written', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId } = await seed(t);
    await bump(t, textId, NEW_DE);
    const live = await liveRow(t, textId);
    expect(live._id).toBe(translationId);
    expect(live.supersededAt).toBeUndefined();
    const revisions = await t.run((ctx) =>
      translationRevisions(ctx, textId, 'de'),
    );
    expect(revisions.map((r) => r.translatedText)).toEqual([NEW_DE, OLD_DE]);
    expect(revisions[0]._id).toBe(translationId);
  });
});

describe('a superseded revision is content like any other', () => {
  it('its annotation gap is a content gap, filled on the copy right after the bump', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      // The seeded row has no IPA yet, so the copy starts with a gap.
      const { textId, translationId, pinAt } = await seed(t);
      await bump(t, textId, NEW_DE);

      expect((await hydrate(t, textId, pinAt)).hasMissingContent).toBe(true);
      // The archive write scheduled the fill for the COPY's own id.
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const [copy] = await archiveRows(t, textId);
      expect(copy.ipaText).toBe(MOCK_IPA);
      expect(copy.ipaSource).toBe(IPA_SOURCES.espeakNg);
      expect(copy.translatedText).toBe(OLD_DE);
      // The live row is untouched by the copy's fill (its own IPA comes from
      // the replacement's follow-up, against the new wording).
      const live = (await t.run((ctx) => ctx.db.get(translationId)))!;
      expect(live.translatedText).toBe(NEW_DE);
      const pinned = await hydrate(t, textId, pinAt);
      expect(pinned.text).toBe(OLD_DE);
      expect(pinned.hasMissingContent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the ensure sweep fills a superseded revision by row id and leaves the live row alone', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { textId, translationId, assetId } = await seed(t, {
        ipaText: 'live-ipa',
      });
      // A superseded revision written without IPA (as a pre-rule bump or a
      // failed fill would leave it), served by every card pinned before now.
      const supersededId = await t.run(async (ctx) => {
        const supersededAt = Date.now();
        const id = await ctx.db.insert('translations', {
          textId,
          targetLanguage: 'de',
          translatedText: 'Ist alles in Ordnung?',
          romanizedText: '',
          speakerGender: 'female',
          translationVersion: 1,
          audioAssetId: assetId,
          supersededAt,
        });
        await ctx.db.patch(translationId, {
          translationVersion: getCurrentTranslationVersion('de'),
          lastArchivedAt: supersededAt,
        });
        return id;
      });

      // Probe mode reports the gap as work.
      await expect(
        t.run(async (ctx) => {
          const text = (await ctx.db.get(textId))!;
          await scheduleMissingContent(ctx, textId, text, ['en'], ['de'], {
            probe: true,
          });
        }),
      ).rejects.toBeInstanceOf(ProbeNeedsWork);

      await t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const superseded = (await t.run((ctx) => ctx.db.get(supersededId)))!;
      expect(superseded.ipaText).toBe(MOCK_IPA);
      const live = (await t.run((ctx) => ctx.db.get(translationId)))!;
      expect(live.ipaText).toBe('live-ipa');
      expect(live.translatedText).toBe(OLD_DE);
      expect(llmEnqueues().length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('its audio without word timings gets the backfill, persisted by blob onto the archived asset', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, assetId, storageId } = await seed(t, {
      ipaText: 'live-ipa',
    });
    // Live audio already has timings, so only the archived asset needs them.
    const { archivedStorageId, supersededId } = await t.run(async (ctx) => {
      await ctx.db.patch(assetId, {
        wordTimings: [{ word: 'Alles', start: 0, end: 0.4 }],
      });
      const archivedStorageId = await ctx.storage.store(
        new Blob([new Uint8Array([8, 8])]),
      );
      const archivedAssetId = await ctx.db.insert('audioAssets', {
        language: 'de',
        voiceGender: 'female',
        spokenTextHash: 'h',
        spokenText: 'Ist alles in Ordnung?',
        storageId: archivedStorageId,
        voiceName: DE_VOICE,
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('de'),
        speed: 1,
      });
      const supersededAt = Date.now();
      const supersededId = await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'de',
        translatedText: 'Ist alles in Ordnung?',
        romanizedText: '',
        ipaText: 'x',
        speakerGender: 'female',
        translationVersion: 1,
        audioAssetId: archivedAssetId,
        supersededAt,
      });
      await ctx.db.patch(translationId, {
        translationVersion: getCurrentTranslationVersion('de'),
        lastArchivedAt: supersededAt,
      });
      return { archivedStorageId, supersededId };
    });

    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });
    // A backfill holds a workId-less claim; no synthesis was enqueued.
    const claim = await t.run((ctx) =>
      ctx.db
        .query('ttsGenerationClaims')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', textId).eq('language', 'de'),
        )
        .first(),
    );
    expect(claim).not.toBeNull();
    expect(claim!.workId).toBeUndefined();
    expect(ttsEnqueues().length).toBe(0);

    // The transcription lands on the asset that owns the blob.
    await t.mutation(
      internal.features.ttsProcessing.persistBackfilledWordTimings,
      {
        textId,
        language: 'de',
        storageId: archivedStorageId,
        wordTimings: [{ word: 'Ist', start: 0, end: 0.2 }],
      },
    );
    const superseded = (await t.run((ctx) => ctx.db.get(supersededId)))!;
    const archivedAsset = (await t.run((ctx) =>
      ctx.db.get(superseded.audioAssetId!),
    ))!;
    expect(archivedAsset.wordTimings).toEqual([
      { word: 'Ist', start: 0, end: 0.2 },
    ]);
    // The live asset's timings are untouched.
    const liveAsset = (await t.run((ctx) => ctx.db.get(assetId)))!;
    expect(liveAsset.wordTimings).toEqual([
      { word: 'Alles', start: 0, end: 0.4 },
    ]);
    expect(liveAsset.storageId).toBe(storageId);
  });

  it('a lost archived asset is a content gap; the repair job re-voices the wording without touching the live pointer', async () => {
    const t = convexTest(schema, modules);
    const { textId, pinAt, assetId } = await seed(t, { ipaText: 'x' });
    await bump(t, textId, NEW_DE);
    await settleTts(t, textId);
    const [copy] = await archiveRows(t, textId);
    expect(copy.audioAssetId).toBe(assetId);
    // Live wording gets its own complete audio (timings included, so the
    // shared TTS claim is free for the repair); then the archived asset
    // disappears.
    const { liveAssetId } = await t.run(async (ctx) => {
      const { assetId: liveAssetId } = await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        voiceName: DE_VOICE,
        storageId: await ctx.storage.store(new Blob([new Uint8Array([5])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('de'),
        voiceGender: 'female',
        spokenText: NEW_DE,
        wordTimings: [{ word: 'Alles', start: 0, end: 0.3 }],
      });
      await ctx.db.delete(assetId);
      return { liveAssetId };
    });

    const pinned = await hydrate(t, textId, pinAt);
    expect(pinned.text).toBe(OLD_DE);
    expect(pinned.audioUrl).toBeNull();
    expect(pinned.hasMissingContent).toBe(true);

    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });
    const jobs = ttsEnqueues();
    expect(jobs.length).toBe(1);
    expect(jobs[0]).toMatchObject({
      textId,
      language: 'de',
      text: OLD_DE,
      archivedTranslationId: copy._id,
    });
    expect(jobs[0].forceRegen).toBeFalsy();

    // The job's final write: asset recreated by key, revision re-pointed,
    // live pointer untouched.
    const newStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([6, 6])])),
    );
    await t.mutation(internal.features.decks.storeAudioRecording, {
      textId,
      language: 'de',
      voiceName: DE_VOICE,
      storageId: newStorageId,
      ttsQuality: 'validated',
      ttsProvider: getTtsProviderForLanguage('de'),
      voiceGender: 'female',
      speed: 1,
      spokenText: OLD_DE,
      archivedTranslationId: copy._id,
    });
    const repaired = (await t.run((ctx) => ctx.db.get(copy._id)))!;
    expect(repaired.audioAssetId).toBeDefined();
    expect(repaired.audioAssetId).not.toBe(assetId);
    const repairedAsset = (await t.run((ctx) =>
      ctx.db.get(repaired.audioAssetId!),
    ))!;
    expect(repairedAsset.storageId).toBe(newStorageId);
    expect(repairedAsset.spokenText).toBe(OLD_DE);
    expect((await audioRows(t, textId)).map((a) => a.assetId)).toEqual([
      liveAssetId,
    ]);
    const afterRepair = await hydrate(t, textId, pinAt);
    expect(afterRepair.text).toBe(OLD_DE);
    expect(afterRepair.audioUrl).toEqual(expect.any(String));
    expect(afterRepair.hasMissingContent).toBe(false);
  });

  it('an archived asset whose blob is gone is replaced in place', async () => {
    const t = convexTest(schema, modules);
    const { textId, assetId, storageId } = await seed(t, { ipaText: 'x' });
    await bump(t, textId, NEW_DE);
    await settleTts(t, textId);
    const [copy] = await archiveRows(t, textId);
    await t.run(async (ctx) => {
      await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        voiceName: DE_VOICE,
        storageId: await ctx.storage.store(new Blob([new Uint8Array([5])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('de'),
        voiceGender: 'female',
        spokenText: NEW_DE,
        wordTimings: [{ word: 'Alles', start: 0, end: 0.3 }],
      });
      await ctx.storage.delete(storageId);
    });

    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });
    const archivedJobs = ttsEnqueues().filter(
      (j) => j.archivedTranslationId !== undefined,
    );
    expect(archivedJobs.length).toBe(1);
    expect(archivedJobs[0]).toMatchObject({
      archivedTranslationId: copy._id,
      text: OLD_DE,
      forceRegen: true,
    });
    // The asset doc survives for the in-place swap.
    expect(await t.run((ctx) => ctx.db.get(assetId))).not.toBeNull();
  });

  it('"Regenerate audio" on a pinned card re-voices the archived asset and keeps the live pointer', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, assetId } = await seed(t, { ipaText: 'x' });
    await bump(t, textId, NEW_DE);
    await settleTts(t, textId);
    const [copy] = await archiveRows(t, textId);
    const { liveRowId } = await t.run(async (ctx) => {
      const { rowId: liveRowId } = await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        voiceName: DE_VOICE,
        storageId: await ctx.storage.store(new Blob([new Uint8Array([5])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('de'),
        voiceGender: 'female',
        spokenText: NEW_DE,
        wordTimings: [{ word: 'Alles', start: 0, end: 0.3 }],
      });
      return { liveRowId };
    });
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.scheduling.regenerateCardAudio, {
      cardId: cardId!,
      timezone: 'UTC',
    });

    const jobs = ttsEnqueues();
    const de = jobs.filter((j) => j.language === 'de');
    expect(de.length).toBe(1);
    expect(de[0]).toMatchObject({
      text: OLD_DE,
      forceRegen: true,
      archivedTranslationId: copy._id,
    });
    // Source-language audio took the normal regenerate path.
    expect(jobs.some((j) => j.language === 'en' && j.forceRegen)).toBe(true);
    // The live German pointer and the archived asset are both still there.
    expect((await audioRows(t, textId)).map((a) => a._id)).toEqual([liveRowId]);
    expect(await t.run((ctx) => ctx.db.get(assetId))).not.toBeNull();
    const quota = await t.run((ctx) =>
      ctx.db
        .query('usageQuotas')
        .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
        .first(),
    );
    expect(quota?.features.audio_regenerations.balance).toBe(4);
  });
});

describe('the "Retranslating" pill during a bump', () => {
  it('stays off while the version-bump job holds the claim', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });
    expect(llmEnqueues().length).toBe(1);
    const view = await hydrate(t, textId, undefined);
    expect(view.text).toBe(OLD_DE);
    expect(view.retranslating).toBe(false);
  });

  it('still shows for a flag retranslation of a current row', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, translationId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(translationId, {
        translationVersion: getCurrentTranslationVersion('de'),
      }),
    );
    const asUser = t.withIdentity({ subject: 'user_A' });
    await asUser.mutation(api.features.scheduling.flagTranslation, {
      cardId: cardId!,
    });
    expect(llmEnqueues().length).toBe(1);
    expect((await hydrate(t, textId, undefined)).retranslating).toBe(true);
  });
});

describe('gender drift retires the pair', () => {
  it('deletes the superseded revisions with the live row and keeps their assets cached', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, assetId, pinAt } = await seed(t, {
      ipaText: 'x',
    });
    await bump(t, textId, NEW_DE);
    await settleTts(t, textId);
    expect((await archiveRows(t, textId)).length).toBe(1);
    // The card's gender is female (seed); a row stamped male has drifted.
    await t.run((ctx) =>
      ctx.db.patch(translationId, {
        translationVersion: getCurrentTranslationVersion('de'),
        speakerGender: 'male',
      }),
    );

    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['de']);
    });

    expect(await t.run((ctx) => ctx.db.get(translationId))).toBeNull();
    expect(await archiveRows(t, textId)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(assetId))).not.toBeNull();
    // The refill is on its way, and the pinned card waits for it like any
    // other card with a missing translation.
    expect(llmEnqueues().map((e) => e.targetLanguage)).toEqual(['de']);
    const pinned = await hydrate(t, textId, pinAt);
    expect(pinned.text).toBe('');
    expect(pinned.hasMissingContent).toBe(true);
  });
});

describe('editing a pinned card, afterwards', () => {
  it('is a normal custom card: forked rows carry no archive link and a later bump leaves them alone', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, translationId, pinAt } = await seed(t, {
      ipaText: 'x',
    });
    await bump(t, textId, NEW_DE);
    await settleTts(t, textId);
    const asUser = t.withIdentity({ subject: 'user_A' });

    await asUser.mutation(api.features.scheduling.editCard, {
      cardId: cardId!,
      translations: [{ language: 'de', text: 'Alles gut?' }],
      timezone: 'UTC',
    });

    const card = (await t.run((ctx) => ctx.db.get(cardId!)))!;
    expect(card.textId).not.toBe(textId);
    const forkedText = (await t.run((ctx) => ctx.db.get(card.textId)))!;
    expect(forkedText.userCreated).toBe(true);
    const forkedDe = (await t.run((ctx) =>
      liveTranslation(ctx, card.textId, 'de'),
    ))!;
    expect(forkedDe.translatedText).toBe('Alles gut?');
    expect(forkedDe.translationSource).toBe('user-provided');
    expect(forkedDe.supersededAt).toBeUndefined();
    expect(forkedDe.lastArchivedAt).toBeUndefined();
    expect(
      await t.run((ctx) => translationRevisions(ctx, card.textId, 'de')),
    ).toHaveLength(1);
    // The card resolves live on its own text, pin or no pin.
    const served = await t.run((ctx) =>
      resolveServedFromLive(ctx, forkedDe, cardPinAt(card)),
    );
    expect(served.archived).toBe(false);
    // The new wording gets ordinary audio, never an archived-revision job.
    const jobs = ttsEnqueues().filter((j) => j.language === 'de');
    expect(jobs.length).toBe(1);
    expect(jobs[0]).toMatchObject({
      textId: card.textId,
      text: 'Alles gut?',
    });
    expect(jobs[0].archivedTranslationId).toBeUndefined();
    // The curriculum row was edited from the learner's own copy: no complaint.
    expect((await t.run((ctx) => ctx.db.get(translationId)))!.flagCount).toBe(
      undefined,
    );
    // A later bump of the curriculum text does not reach the fork.
    await bump(t, textId, 'Ist alles gut?');
    expect(
      (await t.run((ctx) => liveTranslation(ctx, card.textId, 'de')))!
        .translatedText,
    ).toBe('Alles gut?');
    expect(pinAt).toBeLessThan(Date.now());
  });

  it('flags nothing for a language whose live wording the learner never saw, and still flags a live one', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, translationId } = await seed(t, {
      ipaText: 'x',
      targetLanguages: ['de', 'fr'],
      extraTranslations: [{ lang: 'fr', text: 'Tout va bien ?' }],
    });
    await bump(t, textId, NEW_DE);
    await settleTts(t, textId);
    vi.mocked(llmPool.enqueueAction).mockClear();
    const asUser = t.withIdentity({ subject: 'user_A' });

    // de is pinned to the superseded wording; fr is the live curriculum row.
    await asUser.mutation(api.features.scheduling.editCard, {
      cardId: cardId!,
      translations: [
        { language: 'de', text: 'Alles gut?' },
        { language: 'fr', text: 'Tout va bien chez toi ?' },
      ],
      timezone: 'UTC',
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query('translations')
        .withIndex('by_textId', (q) => q.eq('textId', textId))
        .collect(),
    );
    const byLang = Object.fromEntries(
      rows
        .filter((r) => r.supersededAt === undefined)
        .map((r) => [r.targetLanguage, r.flagCount]),
    );
    expect(byLang).toEqual({ de: undefined, fr: 1 });
    expect((await t.run((ctx) => ctx.db.get(translationId)))!.flagCount).toBe(
      undefined,
    );
    const fixes = llmEnqueues().filter(
      (e) => e.translationReason === 'curriculum_fix',
    );
    expect(fixes.map((e) => e.targetLanguage)).toEqual(['fr']);
  });
});

describe('table walks reach superseded rows', () => {
  it('the IPA backfill pages a superseded revision by its own id', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId, assetId } = await seed(t, {
      ipaText: 'live-ipa',
    });
    const supersededId = await t.run(async (ctx) => {
      const supersededAt = Date.now();
      const id = await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'de',
        translatedText: 'Ist alles in Ordnung?',
        speakerGender: 'female',
        translationVersion: 1,
        audioAssetId: assetId,
        supersededAt,
      });
      await ctx.db.patch(translationId, { lastArchivedAt: supersededAt });
      return id;
    });

    const page = await t.query(internal.admin.backfillIpa.pageIpaCandidates, {
      table: 'translations',
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(page.items.map((i) => i.translationId)).toEqual([supersededId]);

    await t.mutation(internal.features.decks.storeTranslationAnnotation, {
      textId,
      language: 'de',
      kind: 'ipa',
      value: 'ɪst',
      source: IPA_SOURCES.espeakNg,
      forText: 'Ist alles in Ordnung?',
      translationId: supersededId,
    });
    expect((await t.run((ctx) => ctx.db.get(supersededId)))!.ipaText).toBe(
      'ɪst',
    );
    expect((await t.run((ctx) => ctx.db.get(translationId)))!.ipaText).toBe(
      'live-ipa',
    );
  });
});
