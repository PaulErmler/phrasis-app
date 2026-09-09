/// <reference types="vite/client" />
import { vi as vitestMock } from 'vitest';
// The lazy stamp test schedules a classifier action; keep it off the network.
vitestMock.mock('ai', () => ({
  generateText: vitestMock.fn(async () => ({ text: '[]' })),
}));
vitestMock.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => () => ({}),
}));
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { llmPool, ttsPool } from '@/convex/lib/workpools';
import { buildTextContentBatchForLanguages } from '../../lib/cardContent';
import { annotationFieldsOf } from '../../lib/textAnnotations';
import {
  ProbeNeedsWork,
  scheduleMissingContent,
  scheduleMissingRenderings,
} from '../../lib/contentScheduling';
import {
  audioPointer,
  liveTranslation,
  renderingCardOf,
  renderingTextOf,
  viewOfCard,
} from '../../db/translationReads';
import { getLlmClaim } from '../../features/llmTranslationQueue';
import {
  forkSharedTextForEdit,
  resolveCardEditPlan,
} from '../../features/cardEditPipeline';
import { getRomanizationSource } from '../../lib/localRomanization';
import {
  getCurrentTranslationVersion,
  getCurrentTtsVersion,
  getTtsProviderForLanguage,
  getVoiceForLanguage,
} from '../../../lib/languages';
import type { RenderingSettings } from '../../../lib/preferenceResolution';
import { CURRENT_SENTENCE_METADATA_SOURCE } from '../../../lib/sentenceMetadataSource';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';
import { sha256Hex } from '../../lib/sha256';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * The rendering-variant invariants (docs/architecture/translation-
 * variants.md): the variant path never writes texts or canonical rows, a
 * legacy card and a user-written text ignore the settings, a settings
 * change re-renders a post-feature card, a variant identical to canonical
 * collapses, an unmarked language gets an audio-only variant, and nothing
 * is ever deleted because another rendering was requested.
 */

// A Mixed English base also asks for the text's accent row (en_gb / en_au);
// these tests are about the ja/de rows, so those canonical jobs are filtered
// out rather than counted.
const llmEnqueues = () =>
  vi
    .mocked(llmPool.enqueueAction)
    .mock.calls.map(
      (c) =>
        c[2] as {
          textId: Id<'texts'>;
          targetLanguage: string;
          variantKey?: string;
          audioVariantKey?: string;
          rewriteOf?: string;
          requestedGender?: string;
          requestedForm?: { id: string };
        },
    )
    .filter(
      (job) => job.targetLanguage !== 'en_gb' && job.targetLanguage !== 'en_au',
    );
const ttsEnqueues = () =>
  vi.mocked(ttsPool.enqueueAction).mock.calls.map(
    (c) =>
      c[2] as {
        textId: Id<'texts'>;
        text: string;
        language: string;
        voiceGender: string;
        variantKey?: string;
      },
  );
beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
  vi.mocked(ttsPool.enqueueAction).mockClear();
});

const CANONICAL_JA = '疲れた。';
const CANONICAL_DE = 'Ich bin müde.';

/**
 * A learner (user_A, course en→ja+de) with one premade text whose canonical
 * Japanese and German rows and clips exist, voiced male (the text's coin
 * flip). Cards are created with or without the settings stamp.
 *
 * The fixtures are complete (word timings, current metadata source) so the
 * canonical sweep schedules no follow-up jobs: convex-test fires 0 ms
 * scheduled functions while a `t.run` is still awaiting, and a job landing
 * mid-transaction rolls back the sweep's own writes (the flaky detach).
 */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    follows?: boolean;
    userCreated?: boolean;
    /**
     * Classifier stamp on the canonical Japanese row (default unmarked);
     * 'none' seeds it unstamped, like a row from before the feature.
     */
    jaGender?: 'masculine' | 'feminine' | 'unmarked' | 'none';
    /**
     * The Flag dialog's gender correction on the card: since the course
     * gender choice was withdrawn, the one way a card leaves the text's
     * own (male, here) voice.
     */
    genderOverride?: 'male' | 'female';
  } = {},
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['ja', 'de'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'deck',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: "I'm tired.",
      language: 'en',
      userCreated: opts.userCreated ?? false,
      ...(opts.userCreated ? { userId: 'user_A' } : {}),
      collectionId,
      collectionRank: 1,
      audioSpeakerGender: 'male',
      addressesSomeone: false,
      metadataSource: CURRENT_SENTENCE_METADATA_SOURCE,
      ipaText: '',
      romanizedText: '',
    });
    const rows: Record<string, Id<'translations'>> = {};
    for (const [lang, text] of [
      ['ja', CANONICAL_JA],
      ['de', CANONICAL_DE],
    ] as const) {
      rows[lang] = await ctx.db.insert('translations', {
        textId,
        targetLanguage: lang,
        translatedText: text,
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        speakerGender: 'male',
        translationVersion: 99,
        ...(lang === 'ja' && opts.jaGender === 'none'
          ? {}
          : {
              renderedGender:
                lang === 'ja' && opts.jaGender !== 'none'
                  ? (opts.jaGender ?? 'unmarked')
                  : 'unmarked',
              renderedPoliteness: lang === 'ja' ? 'casual' : 'unmarked',
            }),
      });
      await insertAudioFixture(ctx, {
        textId,
        language: lang,
        voiceName: lang === 'ja' ? 'ja-test-male' : 'de-test-male',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage(lang),
        voiceGender: 'male',
        spokenText: text,
        wordTimings: [],
      });
    }
    await insertAudioFixture(ctx, {
      textId,
      language: 'en',
      voiceName: 'en-test-male',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([2])])),
      ttsQuality: 'validated',
      ttsProvider: getTtsProviderForLanguage('en'),
      voiceGender: 'male',
      spokenText: "I'm tired.",
      wordTimings: [],
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
      ...(opts.follows === false ? {} : { followsCoursePreferences: true }),
      ...(opts.genderOverride
        ? { renderingGenderOverride: opts.genderOverride }
        : {}),
    });
    return { textId, cardId, courseId, deckId, rows };
  });
}

async function snapshotCanonical(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
) {
  return t.run(async (ctx) => ({
    text: await ctx.db.get(textId),
    ja: await liveTranslation(ctx, textId, 'ja'),
    de: await liveTranslation(ctx, textId, 'de'),
    jaAudio: await audioPointer(ctx, textId, 'ja'),
    deAudio: await audioPointer(ctx, textId, 'de'),
  }));
}

async function hydrate(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  cardId: Id<'cards'>,
  settings: RenderingSettings | undefined,
) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const card = (await ctx.db.get(cardId))!;
    const map = await buildTextContentBatchForLanguages(
      ctx,
      [
        {
          key: 'k',
          textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          sourceAnnotations: annotationFieldsOf(text),
          userCreated: text.userCreated,
          renderingText: renderingTextOf(text),
          view: viewOfCard(card, settings),
        },
      ],
      ['en'],
      ['ja', 'de'],
      { includeVariantGaps: true },
    );
    return map.get('k')!;
  });
}

/**
 * The rendering sweep as the review path runs it: with the card when one
 * is given (its correction renders), else the card-less warm.
 */
const ensureRenderings = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  settings: RenderingSettings | undefined,
  cardId?: Id<'cards'>,
) =>
  t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    await scheduleMissingContent(ctx, textId, text, ['en'], ['ja', 'de']);
    const card = cardId ? await ctx.db.get(cardId) : null;
    return scheduleMissingRenderings(
      ctx,
      textId,
      text,
      ['en'],
      ['ja', 'de'],
      settings,
      card ? { card: renderingCardOf(card) } : undefined,
    );
  });

describe('rendering variants', () => {
  it('no settings: nothing scheduled, canonical served, no chips for unmarked axes', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    // One canonical pass first: the sweep writes the coin flip back onto
    // the text on its first run, which is not the variant path's doing.
    await ensureRenderings(t, textId, undefined);
    vi.mocked(llmPool.enqueueAction).mockClear();
    vi.mocked(ttsPool.enqueueAction).mockClear();
    const before = await snapshotCanonical(t, textId);
    const scheduled = await ensureRenderings(t, textId, undefined);
    expect(scheduled).toEqual({ translationsScheduled: 0, audioScheduled: 0 });
    expect(llmEnqueues()).toEqual([]);
    expect(await snapshotCanonical(t, textId)).toEqual(before);
    const content = await hydrate(t, textId, cardId, undefined);
    const ja = content.translations.find((tr) => tr.language === 'ja')!;
    expect(ja.text).toBe(CANONICAL_JA);
    expect(ja.renderedPoliteness).toBe('casual');
    expect(ja.renderedGender).toBeUndefined();
    expect(content.hasMissingVariant).toBe(false);
  });

  it('a polite Japanese setting asks for a rewrite of the canonical wording and leaves canonical untouched', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    // One canonical pass first: the sweep writes the coin flip back onto
    // the text on its first run, which is not the variant path's doing.
    await ensureRenderings(t, textId, undefined);
    vi.mocked(llmPool.enqueueAction).mockClear();
    vi.mocked(ttsPool.enqueueAction).mockClear();
    const before = await snapshotCanonical(t, textId);
    const settings: RenderingSettings = { politenessLevels: ['polite'] };
    const scheduled = await ensureRenderings(t, textId, settings);
    expect(scheduled.translationsScheduled).toBe(1);
    const jobs = llmEnqueues();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      targetLanguage: 'ja',
      variantKey: 'auto|desu-masu',
      audioVariantKey: 'male|desu-masu',
      rewriteOf: CANONICAL_JA,
      requestedForm: { id: 'desu-masu' },
    });
    // German has no addressee here, so no German variant is asked for.
    expect(jobs.some((j) => j.targetLanguage === 'de')).toBe(false);
    expect(await snapshotCanonical(t, textId)).toEqual(before);
    // Served canonical meanwhile, with the gap reported to the self-heal.
    const content = await hydrate(t, textId, cardId, settings);
    expect(content.translations.find((tr) => tr.language === 'ja')!.text).toBe(
      CANONICAL_JA,
    );
    expect(content.hasMissingVariant).toBe(true);
    expect(content.hasMissingContent).toBe(true);
  });

  it('a landed variant is served to a settings-following card and never to a legacy card', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, deckId } = await seed(t);
    const legacy = await t.run((ctx) =>
      ctx.db.insert('cards', {
        deckId,
        textId,
        collectionOrigin: 'premade',
        dueDate: Date.now(),
        isMastered: false,
        isHidden: false,
        schedulingPhase: 'preReview',
        preReviewCount: 0,
      }),
    );
    const settings: RenderingSettings = { politenessLevels: ['polite'] };
    await ensureRenderings(t, textId, settings);
    // The variant job lands its rewrite through the store choke point.
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'ja',
      translatedText: '疲れました。',
      voiceName: getVoiceForLanguage('ja', 'male'),
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      variantKey: 'auto|desu-masu',
      audioVariantKey: 'male|desu-masu',
    });
    const variant = await t.run((ctx) =>
      liveTranslation(ctx, textId, 'ja', 'auto|desu-masu'),
    );
    expect(variant?.translatedText).toBe('疲れました。');
    expect(variant?.sameAsCanonical).toBeUndefined();
    // Canonical row untouched.
    expect(
      (await t.run((ctx) => liveTranslation(ctx, textId, 'ja')))!
        .translatedText,
    ).toBe(CANONICAL_JA);
    // Audio for the variant wording is asked for under the audio key.
    expect(ttsEnqueues().map((j) => [j.text, j.variantKey])).toEqual([
      ['疲れました。', 'male|desu-masu'],
    ]);

    const followed = await hydrate(t, textId, cardId, settings);
    expect(followed.translations.find((tr) => tr.language === 'ja')!.text).toBe(
      '疲れました。',
    );
    const legacyContent = await hydrate(t, textId, legacy, settings);
    expect(
      legacyContent.translations.find((tr) => tr.language === 'ja')!.text,
    ).toBe(CANONICAL_JA);
    expect(legacyContent.hasMissingVariant).toBe(false);
  });

  it('a variant identical to canonical collapses: no annotations, no audio, no re-request', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    const settings: RenderingSettings = { politenessLevels: ['casual'] };
    // The canonical row is stamped casual, so the shortcut asks for nothing.
    await ensureRenderings(t, textId, settings);
    expect(llmEnqueues()).toEqual([]);
    // Now a variant that came back identical (a language with a form the
    // stamp did not cover): stored, collapsed, and the card reads canonical.
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'ja',
      translatedText: CANONICAL_JA,
      voiceName: getVoiceForLanguage('ja', 'male'),
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      variantKey: 'auto|plain',
    });
    const variant = await t.run((ctx) =>
      liveTranslation(ctx, textId, 'ja', 'auto|plain'),
    );
    expect(variant?.sameAsCanonical).toBe(true);
    expect(ttsEnqueues()).toEqual([]);
    const content = await hydrate(t, textId, cardId, settings);
    expect(content.translations.find((tr) => tr.language === 'ja')!.text).toBe(
      CANONICAL_JA,
    );
    expect(content.hasMissingVariant).toBe(false);
  });

  it('a card corrected to the female voice gets an audio-only variant on an unmarked language and keeps the male clip', async () => {
    const t = convexTest(schema, modules);
    // The canonical Japanese wording carries a masculine marker, so the
    // corrected card needs a rewrite of it; German never marks the speaker.
    const { textId, cardId } = await seed(t, {
      jaGender: 'masculine',
      genderOverride: 'female',
    });
    const settings: RenderingSettings = {};
    const scheduled = await ensureRenderings(t, textId, settings, cardId);
    // German (and the English source): no LLM job, one female clip of the
    // canonical wording each. Japanese: a rewrite job; its clip follows
    // the rewrite.
    expect(llmEnqueues().map((j) => [j.targetLanguage, j.variantKey])).toEqual([
      ['ja', 'female|auto'],
    ]);
    expect(scheduled.audioScheduled).toBe(2);
    expect(
      ttsEnqueues()
        .map((j) => [j.language, j.text, j.voiceGender, j.variantKey])
        .sort(),
    ).toEqual([
      ['de', CANONICAL_DE, 'female', 'female|auto'],
      ['en', "I'm tired.", 'female', 'female|auto'],
    ]);
    // The male canonical clip is still there.
    expect(
      await t.run((ctx) => audioPointer(ctx, textId, 'de')),
    ).not.toBeNull();
    const content = await hydrate(t, textId, cardId, settings);
    expect(content.hasMissingVariant).toBe(true);
  });

  it('a canonical wording stamped unmarked for gender needs no rewrite, only the voice', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { genderOverride: 'female' });
    const settings: RenderingSettings = {};
    const scheduled = await ensureRenderings(t, textId, settings, cardId);
    expect(llmEnqueues()).toEqual([]);
    // Every language of the card, the source included, gets a female clip
    // of its canonical wording.
    expect(scheduled.audioScheduled).toBe(3);
    expect(
      ttsEnqueues()
        .map((j) => [j.language, j.variantKey])
        .sort(),
    ).toEqual([
      ['de', 'female|auto'],
      ['en', 'female|auto'],
      ['ja', 'female|auto'],
    ]);
    const content = await hydrate(t, textId, cardId, settings);
    // The wording is canonical, so it is not a text gap; the clips are.
    expect(content.hasMissingVariant).toBe(true);
    expect(content.translations.find((tr) => tr.language === 'ja')!.text).toBe(
      CANONICAL_JA,
    );
  });

  it('an unstamped canonical row is sent to the classifier, and no rewrite is asked for until it is stamped', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, rows } = await seed(t, {
      jaGender: 'none',
      genderOverride: 'female',
    });
    const settings: RenderingSettings = {};
    const pendingStampCalls = () =>
      t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).filter(
          (job) =>
            job.name.includes('classifyAndStampTranslations') &&
            job.state.kind === 'pending',
        ),
      );

    await ensureRenderings(t, textId, settings, cardId);
    // The canonical sweep asked for the stamp (claimed on the row); the
    // rendering sweep held the rewrite back instead of guessing.
    expect(llmEnqueues()).toEqual([]);
    const calls = await pendingStampCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toMatchObject({ translationIds: [rows.ja] });
    const claimed = await t.run((ctx) => ctx.db.get(rows.ja));
    expect(claimed?.renderingStampRequestedAt).toBeDefined();

    // A second sweep inside the cooldown asks neither the classifier nor
    // the translator again.
    await ensureRenderings(t, textId, settings, cardId);
    expect(await pendingStampCalls()).toHaveLength(1);
    expect(llmEnqueues()).toEqual([]);

    // The stamp lands (masculine wording): the next sweep requests the
    // feminine rewrite. The classifier call itself is not exercised here
    // (the scheduled action fails fast in the test harness).
    await t.run(async (ctx) => {
      await ctx.db.patch(rows.ja, {
        renderedGender: 'masculine',
        renderedPoliteness: 'casual',
      });
    });
    await ensureRenderings(t, textId, settings, cardId);
    expect(llmEnqueues().map((j) => [j.targetLanguage, j.variantKey])).toEqual([
      ['ja', 'female|auto'],
    ]);
  });

  it('a user-written text ignores the settings and the correction entirely', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, {
      userCreated: true,
      genderOverride: 'female',
    });
    const settings: RenderingSettings = { politenessLevels: ['formal'] };
    const scheduled = await ensureRenderings(t, textId, settings, cardId);
    expect(scheduled).toEqual({ translationsScheduled: 0, audioScheduled: 0 });
    expect(llmEnqueues()).toEqual([]);
    const content = await hydrate(t, textId, cardId, settings);
    expect(content.hasMissingVariant).toBe(false);
  });

  it('switching the setting back serves the cached rendering and deletes nothing', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'ja',
      translatedText: '疲れました。',
      voiceName: getVoiceForLanguage('ja', 'male'),
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      variantKey: 'auto|desu-masu',
      audioVariantKey: 'male|desu-masu',
    });
    const polite: RenderingSettings = { politenessLevels: ['polite'] };
    const casual: RenderingSettings = { politenessLevels: ['casual'] };
    expect(
      (await hydrate(t, textId, cardId, polite)).translations.find(
        (tr) => tr.language === 'ja',
      )!.text,
    ).toBe('疲れました。');
    expect(
      (await hydrate(t, textId, cardId, casual)).translations.find(
        (tr) => tr.language === 'ja',
      )!.text,
    ).toBe(CANONICAL_JA);
    await ensureRenderings(t, textId, casual);
    // Both rows still exist.
    expect(
      await t.run((ctx) => liveTranslation(ctx, textId, 'ja')),
    ).not.toBeNull();
    expect(
      await t.run((ctx) =>
        liveTranslation(ctx, textId, 'ja', 'auto|desu-masu'),
      ),
    ).not.toBeNull();
  });

  it('a variant clip from an earlier TTS setup is detached, its asset kept, and re-synthesized', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await ensureRenderings(t, textId, undefined);
    vi.mocked(llmPool.enqueueAction).mockClear();
    vi.mocked(ttsPool.enqueueAction).mockClear();
    const POLITE_JA = '疲れました。';
    // A landed polite rendering whose clip was made under the previous
    // ttsVersion (the retention rule keeps that asset: a roll-back finds it).
    const { assetId, storageId } = await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: POLITE_JA,
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        speakerGender: 'male',
        translationVersion: 99,
        variantKey: 'auto|desu-masu',
        renderedGender: 'unmarked',
        renderedPoliteness: 'polite',
      });
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([3])]),
      );
      const assetId = await ctx.db.insert('audioAssets', {
        language: 'ja',
        voiceGender: 'male',
        spokenTextHash: sha256Hex(POLITE_JA),
        spokenText: POLITE_JA,
        storageId,
        voiceName: 'ja-test-male',
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('ja'),
        speed: 1,
        ttsVersion: 0,
      });
      await ctx.db.insert('audioRecordings', {
        textId,
        language: 'ja',
        assetId,
        variantKey: 'male|desu-masu',
      });
      return { assetId, storageId };
    });

    const polite: RenderingSettings = { politenessLevels: ['polite'] };
    const scheduled = await ensureRenderings(t, textId, polite);

    expect(scheduled).toEqual({ translationsScheduled: 0, audioScheduled: 1 });
    expect(ttsEnqueues()).toMatchObject([
      { textId, language: 'ja', text: POLITE_JA, variantKey: 'male|desu-masu' },
    ]);
    // Pointer detached, asset and blob retained.
    expect(
      await t.run((ctx) => audioPointer(ctx, textId, 'ja', 'male|desu-masu')),
    ).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(assetId))).not.toBeNull();
    expect(
      await t.run(
        async (ctx) => (await ctx.storage.getUrl(storageId)) !== null,
      ),
    ).toBe(true);
    // The rendering itself is untouched.
    expect(
      (
        await t.run((ctx) =>
          liveTranslation(ctx, textId, 'ja', 'auto|desu-masu'),
        )
      )?.translatedText,
    ).toBe(POLITE_JA);
  });

  it('a variant clip under the current TTS setup is left alone', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await ensureRenderings(t, textId, undefined);
    vi.mocked(llmPool.enqueueAction).mockClear();
    vi.mocked(ttsPool.enqueueAction).mockClear();
    const POLITE_JA = '疲れました。';
    const assetId = await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: POLITE_JA,
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        speakerGender: 'male',
        translationVersion: 99,
        variantKey: 'auto|desu-masu',
        renderedGender: 'unmarked',
        renderedPoliteness: 'polite',
      });
      const assetId = await ctx.db.insert('audioAssets', {
        language: 'ja',
        voiceGender: 'male',
        spokenTextHash: sha256Hex(POLITE_JA),
        spokenText: POLITE_JA,
        storageId: await ctx.storage.store(new Blob([new Uint8Array([3])])),
        voiceName: 'ja-test-male',
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('ja'),
        speed: 1,
        ttsVersion: getCurrentTtsVersion('ja'),
      });
      await ctx.db.insert('audioRecordings', {
        textId,
        language: 'ja',
        assetId,
        variantKey: 'male|desu-masu',
      });
      return assetId;
    });

    const scheduled = await ensureRenderings(t, textId, {
      politenessLevels: ['polite'],
    });
    expect(scheduled).toEqual({ translationsScheduled: 0, audioScheduled: 0 });
    expect(ttsEnqueues()).toEqual([]);
    expect(
      (await t.run((ctx) => audioPointer(ctx, textId, 'ja', 'male|desu-masu')))
        ?.assetId,
    ).toBe(assetId);
  });
  it('the source language is voiced in the card voice like an unmarked target', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { genderOverride: 'female' });
    const settings: RenderingSettings = {};
    await ensureRenderings(t, textId, settings, cardId);
    // The English line is spoken by the card's voice, its wording untouched.
    expect(
      ttsEnqueues()
        .filter((j) => j.language === 'en')
        .map((j) => [j.text, j.voiceGender, j.variantKey]),
    ).toEqual([["I'm tired.", 'female', 'female|auto']]);
    // Meanwhile the card plays the canonical (male) source clip and reports
    // the voice as missing.
    const before = await hydrate(t, textId, cardId, settings);
    expect(
      before.audioRecordings.find((a) => a.language === 'en')!.voiceName,
    ).toBe('en-test-male');
    expect(before.hasMissingVariant).toBe(true);

    // The three clips land under the audio key.
    await t.run(async (ctx) => {
      for (const [lang, spokenText] of [
        ['en', "I'm tired."],
        ['ja', CANONICAL_JA],
        ['de', CANONICAL_DE],
      ] as const) {
        const assetId = await ctx.db.insert('audioAssets', {
          language: lang,
          voiceGender: 'female',
          spokenTextHash: sha256Hex(spokenText),
          spokenText,
          storageId: await ctx.storage.store(new Blob([new Uint8Array([9])])),
          voiceName: `${lang}-test-female`,
          ttsQuality: 'validated',
          ttsProvider: getTtsProviderForLanguage(lang),
          speed: 1,
          ttsVersion: getCurrentTtsVersion(lang),
        });
        await ctx.db.insert('audioRecordings', {
          textId,
          language: lang,
          assetId,
          variantKey: 'female|auto',
        });
      }
    });
    const after = await hydrate(t, textId, cardId, settings);
    expect(
      after.audioRecordings.find((a) => a.language === 'en')!.voiceName,
    ).toBe('en-test-female');
    expect(after.hasMissingVariant).toBe(false);
    // A second pass asks for nothing more.
    vi.mocked(ttsPool.enqueueAction).mockClear();
    const again = await ensureRenderings(t, textId, settings);
    expect(again).toEqual({ translationsScheduled: 0, audioScheduled: 0 });
    expect(ttsEnqueues()).toEqual([]);
  });

  it('a landed variant gets its own annotations, and the sweep fills a bare variant row by id', async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { textId, cardId } = await seed(t);
      const settings: RenderingSettings = { politenessLevels: ['polite'] };
      await ensureRenderings(t, textId, settings);
      await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
        textId,
        targetLanguage: 'ja',
        translatedText: '疲れました。',
        romanizedText: 'tsukaremashita',
        romanizationSource: getRomanizationSource('ja'),
        voiceName: getVoiceForLanguage('ja', 'male'),
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        speakerGender: 'male',
        variantKey: 'auto|desu-masu',
        audioVariantKey: 'male|desu-masu',
      });
      const variant = (await t.run((ctx) =>
        liveTranslation(ctx, textId, 'ja', 'auto|desu-masu'),
      ))!;
      // The furigana job names the VARIANT row, not the canonical one.
      const furiganaJobs = await t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).filter(
          (job) =>
            job.name.includes('processFuriganaForTranslation') &&
            job.state.kind === 'pending',
        ),
      );
      expect(furiganaJobs).toHaveLength(1);
      expect(furiganaJobs[0].args[0]).toMatchObject({
        translationId: variant._id,
        text: '疲れました。',
      });
      // Served with a gap until the job lands, then complete.
      expect(
        (await hydrate(t, textId, cardId, settings)).hasMissingAnnotation,
      ).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const filled = (await t.run((ctx) => ctx.db.get(variant._id)))!;
      expect(typeof filled.furiganaText).toBe('string');
      // The canonical row was not written.
      expect(
        (await t.run((ctx) => liveTranslation(ctx, textId, 'ja')))!
          .furiganaText,
      ).toBe('');
      const content = await hydrate(t, textId, cardId, settings);
      expect(content.hasMissingAnnotation).toBe(false);

      // A variant row from before this fix, stored without its annotations:
      // the rendering sweep treats it as content and fills it by id.
      await t.run((ctx) =>
        ctx.db.patch(variant._id, {
          furiganaText: undefined,
          furiganaSource: undefined,
        }),
      );
      await expect(
        t.run(async (ctx) => {
          const text = (await ctx.db.get(textId))!;
          await scheduleMissingRenderings(
            ctx,
            textId,
            text,
            ['en'],
            ['ja', 'de'],
            settings,
            { probe: true },
          );
        }),
      ).rejects.toBeInstanceOf(ProbeNeedsWork);
      await ensureRenderings(t, textId, settings);
      const sweepJobs = await t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).filter(
          (job) =>
            job.name.includes('processFuriganaForTranslation') &&
            job.state.kind === 'pending',
        ),
      );
      expect(sweepJobs).toHaveLength(1);
      expect(sweepJobs[0].args[0]).toMatchObject({
        translationId: variant._id,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a canonical wording change drops the variant claim, and a rewrite of the old wording is refused', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const settings: RenderingSettings = { politenessLevels: ['polite'] };
    await ensureRenderings(t, textId, settings);
    expect(
      await t.run((ctx) => getLlmClaim(ctx, textId, 'ja', 'auto|desu-masu')),
    ).not.toBeNull();

    // A flag retranslation replaces the canonical wording.
    const NEW_JA = '眠い。';
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'ja',
      translatedText: NEW_JA,
      voiceName: getVoiceForLanguage('ja', 'male'),
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      replaceExisting: true,
      translationReason: 'flag',
    });
    expect(
      await t.run((ctx) => getLlmClaim(ctx, textId, 'ja', 'auto|desu-masu')),
    ).toBeNull();

    // The job started before the flag lands its rewrite of the OLD wording.
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'ja',
      translatedText: '疲れました。',
      voiceName: getVoiceForLanguage('ja', 'male'),
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      variantKey: 'auto|desu-masu',
      audioVariantKey: 'male|desu-masu',
      rewriteOf: CANONICAL_JA,
    });
    expect(
      await t.run((ctx) =>
        liveTranslation(ctx, textId, 'ja', 'auto|desu-masu'),
      ),
    ).toBeNull();

    // A rewrite of the current wording is stored.
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'ja',
      translatedText: '眠いです。',
      voiceName: getVoiceForLanguage('ja', 'male'),
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      variantKey: 'auto|desu-masu',
      audioVariantKey: 'male|desu-masu',
      rewriteOf: NEW_JA,
    });
    expect(
      (
        await t.run((ctx) =>
          liveTranslation(ctx, textId, 'ja', 'auto|desu-masu'),
        )
      )?.translatedText,
    ).toBe('眠いです。');
  });

  it('a variant whose rewrite attempts are exhausted is not asked for again within the cooldown', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    const settings: RenderingSettings = { politenessLevels: ['polite'] };
    await ensureRenderings(t, textId, settings);
    expect(llmEnqueues()).toHaveLength(1);
    const claim = (await t.run((ctx) =>
      getLlmClaim(ctx, textId, 'ja', 'auto|desu-masu'),
    ))!;
    await t.mutation(
      internal.features.llmTranslationQueue.onLlmTranslationComplete,
      {
        workId: claim.workId as never,
        context: {
          textId,
          sourceLanguage: 'en',
          targetLanguage: 'ja',
          text: "I'm tired.",
          audioSpeakerGender: 'male',
          variantKey: 'auto|desu-masu',
          audioVariantKey: 'male|desu-masu',
          rewriteOf: CANONICAL_JA,
        },
        result: { kind: 'failed', error: 'refused' },
      },
    );
    // The failure is recorded on the claim; the card keeps reading
    // canonical and the sweep asks for nothing (probe included).
    const failed = (await t.run((ctx) =>
      getLlmClaim(ctx, textId, 'ja', 'auto|desu-masu'),
    ))!;
    expect(typeof failed.variantFailedAt).toBe('number');
    vi.mocked(llmPool.enqueueAction).mockClear();
    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingRenderings(
        ctx,
        textId,
        text,
        ['en'],
        ['ja', 'de'],
        settings,
        { probe: true },
      );
    });
    await ensureRenderings(t, textId, settings);
    expect(llmEnqueues()).toEqual([]);
    expect(
      (await hydrate(t, textId, cardId, settings)).translations.find(
        (tr) => tr.language === 'ja',
      )!.text,
    ).toBe(CANONICAL_JA);

    // After the cooldown the sweep buys one more attempt.
    await t.run((ctx) =>
      ctx.db.patch(failed._id, {
        variantFailedAt: Date.now() - 25 * 60 * 60 * 1000,
      }),
    );
    await ensureRenderings(t, textId, settings);
    expect(llmEnqueues().map((j) => j.variantKey)).toEqual(['auto|desu-masu']);
  });
});

/**
 * A mixed-dialect course (en -> es_mixed) whose canonical Spanish row was
 * generated in the Latin American dialect (`regionVariant` es-US). The
 * politeness forms of Spain and Latin America map the levels differently
 * (Spain: polite = tu; Latin America: polite = usted), so the row's own
 * dialect, not the language's first sub-code, must decide the form.
 */
async function seedMixedSpanish(
  t: TestConvex<typeof schema>,
  opts: { renderedPoliteness: 'casual' | 'polite'; translatedText: string },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es_mixed'],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'deck',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Are you coming?',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
      audioSpeakerGender: 'male',
      addressesSomeone: true,
      metadataSource: CURRENT_SENTENCE_METADATA_SOURCE,
      ipaText: '',
      romanizedText: '',
    });
    await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'es_mixed',
      translatedText: opts.translatedText,
      romanizedText: '',
      ipaText: '',
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      translationVersion: getCurrentTranslationVersion('es_mixed'),
      regionVariant: 'es-US',
      renderedGender: 'unmarked',
      renderedPoliteness: opts.renderedPoliteness,
    });
    // Under the current TTS setup, so the voice variant of the canonical
    // wording attaches this asset instead of synthesizing a new one.
    await insertAudioFixture(ctx, {
      textId,
      language: 'es_mixed',
      voiceName: 'es-test-male',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
      ttsQuality: 'validated',
      ttsProvider: getTtsProviderForLanguage('es_mixed'),
      ttsVersion: getCurrentTtsVersion('es_mixed'),
      voiceGender: 'male',
      regionVariant: 'es-US',
      spokenText: opts.translatedText,
      wordTimings: [],
    });
    await insertAudioFixture(ctx, {
      textId,
      language: 'en',
      voiceName: 'en-test-male',
      storageId: await ctx.storage.store(new Blob([new Uint8Array([2])])),
      ttsQuality: 'validated',
      ttsProvider: getTtsProviderForLanguage('en'),
      voiceGender: 'male',
      spokenText: 'Are you coming?',
      wordTimings: [],
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
      followsCoursePreferences: true,
    });
    return { textId, cardId };
  });
}

async function hydrateMixedSpanish(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  cardId: Id<'cards'>,
  settings: RenderingSettings,
) {
  return t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const card = (await ctx.db.get(cardId))!;
    const map = await buildTextContentBatchForLanguages(
      ctx,
      [
        {
          key: 'k',
          textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          sourceAnnotations: annotationFieldsOf(text),
          userCreated: text.userCreated,
          renderingText: renderingTextOf(text),
          view: viewOfCard(card, settings),
        },
      ],
      ['en'],
      ['es_mixed'],
      { includeVariantGaps: true },
    );
    return map.get('k')!;
  });
}

describe('2026-09-08 review fixes', () => {
  it('a curated canonical row still gets a rendering variant', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, rows } = await seed(t);
    // Hand-curated wording on a premade text (the Essential greetings ship
    // like this). `mayRegenerateTranslation` protects it from being
    // OVERWRITTEN, which used to be read as "no variant either", so the
    // course's politeness setting was silently ignored for good.
    await t.run(async (ctx) => {
      await ctx.db.patch(rows.ja, { translationSource: 'curated-manual' });
    });

    await ensureRenderings(t, textId, { politenessLevels: ['polite'] }, cardId);

    const job = llmEnqueues().find((j) => j.targetLanguage === 'ja');
    expect(job?.variantKey).toBe('auto|desu-masu');
    // A rewrite of the curated wording, which itself is never touched.
    expect(job?.rewriteOf).toBe(CANONICAL_JA);
    const canonical = await t.run((ctx) => liveTranslation(ctx, textId, 'ja'));
    expect(canonical?.translatedText).toBe(CANONICAL_JA);
    expect(canonical?.translationSource).toBe('curated-manual');
  });

  it('the card reports the wording as pending until the variant lands', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    const settings = { politenessLevels: ['polite' as const] };

    const pending = await hydrate(t, textId, cardId, settings);
    const ja = pending.translations.find((tr) => tr.language === 'ja')!;
    // The canonical casual wording is what there is to show, but the card
    // must not present it as the answer to the level the learner picked.
    expect(ja.text).toBe(CANONICAL_JA);
    expect(ja.formPending).toBe(true);
    // ... and the stale politeness chip is suppressed while it is pending,
    // so the two never contradict each other.
    expect(ja.renderedPoliteness).toBeUndefined();

    // A language the settings do not change is not pending.
    const de = pending.translations.find((tr) => tr.language === 'de')!;
    expect(de.formPending).toBeUndefined();
  });

  // 2026-09-08 review. The fork re-derived the slot's rendering WITHOUT the
  // canonical row's dialect, so a mixed code resolved under its default
  // (Spain, familiar split: polite -> tú) while the served row had resolved
  // under the row's own (es_latam, distance split: polite -> usted). The
  // keyed pointer lookup missed and the code fell back to the canonical
  // pointer, so the user-owned copy showed one sentence and played another,
  // permanently.
  it('an edit fork copies the clip that speaks the wording it copies', async () => {
    const t = convexTest(schema, modules);
    const CANONICAL_ES = '¿Vienes?';
    const VARIANT_ES = '¿Viene usted?';
    const { textId, cardId } = await seedMixedSpanish(t, {
      renderedPoliteness: 'casual',
      translatedText: CANONICAL_ES,
    });
    const settings = { politenessLevels: ['polite' as const] };
    // `resolveCardEditPlan` builds its view from the STORED course settings,
    // so the fixture has to carry them or the plan resolves canonical and
    // the submitted variant wording reads as an edit.
    await t.run(async (ctx) => {
      const course = (await ctx.db.query('courses').first())!;
      await ctx.db.insert('courseSettings', {
        courseId: course._id,
        initialReviewCount: 5,
        politenessLevels: ['polite'],
      });
    });

    // The landed polite variant and its own clip. es-US resolves through
    // es_latam, whose distance split renders "polite" as usted.
    const variantAssetId = await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'es_mixed',
        translatedText: VARIANT_ES,
        variantKey: 'auto|v',
        regionVariant: 'es-US',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        renderedGender: 'unmarked',
        renderedPoliteness: 'polite',
      });
      const { assetId } = await insertAudioFixture(ctx, {
        textId,
        language: 'es_mixed',
        voiceName: 'es-test-male',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([9])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('es_mixed'),
        ttsVersion: getCurrentTtsVersion('es_mixed'),
        voiceGender: 'male',
        regionVariant: 'es-US',
        spokenText: VARIANT_ES,
        wordTimings: [],
      });
      // insertAudioFixture writes the CANONICAL pointer; this clip belongs
      // to the variant, so re-key it.
      const pointer = (await ctx.db
        .query('audioRecordings')
        .withIndex('by_assetId', (q) => q.eq('assetId', assetId))
        .first())!;
      await ctx.db.patch(pointer._id, { variantKey: 'male|v' });
      return assetId;
    });

    // The card shows the variant wording, so this is what the fork carries.
    const shown = await hydrateMixedSpanish(t, textId, cardId, settings);
    expect(
      shown.translations.find((tr) => tr.language === 'es_mixed')?.text,
    ).toBe(VARIANT_ES);

    // Edit only the English line: the Spanish slot is copied untouched.
    const forked = await t.run(async (ctx) => {
      const card = (await ctx.db.get(cardId))!;
      const text = (await ctx.db.get(textId))!;
      const course = (await ctx.db
        .query('courses')
        .filter((q) => q.eq(q.field('userId'), 'user_A'))
        .first())!;
      const plan = await resolveCardEditPlan(ctx, {
        userId: 'user_A',
        card,
        text,
        course,
        translations: [
          { language: 'en', text: 'Are you coming along?' },
          { language: 'es_mixed', text: VARIANT_ES },
        ],
        ensureUserOwnedText: true,
        proposedAudioSpeakerGender: undefined,
      });
      const forkedTextId = await forkSharedTextForEdit(ctx, {
        userId: 'user_A',
        card,
        text,
        plan,
      });
      const row = await ctx.db
        .query('audioRecordings')
        .withIndex('by_textId', (q) => q.eq('textId', forkedTextId))
        .filter((q) => q.eq(q.field('language'), 'es_mixed'))
        .first();
      return {
        text: (await liveTranslation(ctx, forkedTextId, 'es_mixed'))
          ?.translatedText,
        asset: row ? await ctx.db.get(row.assetId) : null,
      };
    });

    // The copy carries the variant wording ...
    expect(forked.text).toBe(VARIANT_ES);
    // ... and the clip that speaks it. Under the bug the fork resolved the
    // key under Spain rules (polite -> tú), missed the `male|v` pointer and
    // fell back to the canonical clip, so the copy showed usted and said
    // ¿Vienes?.
    expect(forked.asset).not.toBeNull();
    expect(forked.asset!.spokenText).toBe(VARIANT_ES);
    expect(forked.asset!._id).toBe(variantAssetId);
  });

  // 2026-09-09, from the pre-A1 greetings sitting on "updating" for good in
  // the collection preview. Spanish marks politeness only on the word for
  // "you", so the classifier stamps a greeting with no "you" as `unmarked`.
  // `canonicalSatisfies` treated that as a gap, so the view kept asking for
  // a variant that no rewrite could ever produce: a permanent pending chip
  // on the browse surfaces, and one wasted LLM rewrite per card to
  // rediscover that "Hola." is "Hola." at every level.
  it('an unmarked address-language wording satisfies any level, so it never pends', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedMixedSpanish(t, {
      renderedPoliteness: 'casual',
      translatedText: 'Hola.',
    });
    await t.run((ctx) =>
      ctx.db.patch(textId, { text: 'Hello.', addressesSomeone: true }),
    );
    // What the classifier says about a greeting with no "you".
    await t.run(async (ctx) => {
      const row = (await liveTranslation(ctx, textId, 'es_mixed'))!;
      await ctx.db.patch(row._id, { renderedPoliteness: 'unmarked' });
    });
    const settings = { politenessLevels: ['formal' as const] };

    const shown = await hydrateMixedSpanish(t, textId, cardId, settings);
    const es = shown.translations.find((tr) => tr.language === 'es_mixed')!;
    expect(es.text).toBe('Hola.');
    expect(es.formPending).toBeUndefined();

    // ... and nothing is bought to discover it.
    vi.mocked(llmPool.enqueueAction).mockClear();
    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      const card = (await ctx.db.get(cardId))!;
      await scheduleMissingRenderings(
        ctx,
        textId,
        text,
        ['en'],
        ['es_mixed'],
        settings,
        { card: renderingCardOf(card) },
      );
    });
    expect(
      llmEnqueues().filter((j) => j.targetLanguage === 'es_mixed'),
    ).toEqual([]);
  });

  // A predicate language is the opposite case: `unmarked` there means the
  // carrier is absent and a rewrite can add it, so the variant is still
  // worth asking for.
  it('an unmarked predicate-language wording still wants its form', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    await t.run(async (ctx) => {
      const row = (await liveTranslation(ctx, textId, 'ja'))!;
      await ctx.db.patch(row._id, { renderedPoliteness: 'unmarked' });
    });
    const pending = await hydrate(t, textId, cardId, {
      politenessLevels: ['polite'],
    });
    expect(
      pending.translations.find((tr) => tr.language === 'ja')?.formPending,
    ).toBe(true);
  });

  it('a curriculum fix retires the variants of the old wording', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const FIXED_JA = '疲れています。';
    // A landed polite variant, a rewrite of the wording about to be fixed.
    const variantId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: '疲れました。',
        variantKey: 'auto|desu-masu',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      });
      await ctx.db.insert('audioRecordings', {
        textId,
        language: 'ja',
        assetId: (await ctx.db.query('audioAssets').first())!._id,
        variantKey: 'male|desu-masu',
      });
      const text = (await ctx.db.get(textId))!;
      await ctx.db.patch(textId, { datasetSentenceId: 4242 });
      expect(text).toBeTruthy();
      return id;
    });

    await t.mutation(internal.db.translationSeed.batchUpsertTranslations, {
      items: [
        {
          datasetSentenceId: 4242,
          textEn: "I'm tired.",
          translations: [{ language: 'ja', text: FIXED_JA }],
        },
      ],
    });

    // The canonical row carries the fix, and the rewrite of the wording that
    // was just declared wrong is gone rather than being served for good.
    const canonical = await t.run((ctx) => liveTranslation(ctx, textId, 'ja'));
    expect(canonical?.translatedText).toBe(FIXED_JA);
    expect(await t.run((ctx) => ctx.db.get(variantId))).toBeNull();
    const keyed = await t.run((ctx) =>
      audioPointer(ctx, textId, 'ja', 'male|desu-masu'),
    );
    expect(keyed).toBeNull();
  });
});

describe('mixed dialects resolve the form through the row dialect', () => {
  const sweep = (
    t: TestConvex<typeof schema>,
    textId: Id<'texts'>,
    settings: RenderingSettings,
  ) =>
    t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      await scheduleMissingContent(ctx, textId, text, ['en'], ['es_mixed']);
      return scheduleMissingRenderings(
        ctx,
        textId,
        text,
        ['en'],
        ['es_mixed'],
        settings,
      );
    });

  it('an usted row (es-US) stamped polite already satisfies "polite", not "casual"', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedMixedSpanish(t, {
      renderedPoliteness: 'polite',
      translatedText: '¿Viene usted?',
    });
    const polite: RenderingSettings = { politenessLevels: ['polite'] };
    await sweep(t, textId, polite);
    expect(llmEnqueues()).toEqual([]);
    expect(
      (await hydrateMixedSpanish(t, textId, cardId, polite)).hasMissingVariant,
    ).toBe(false);

    const casual: RenderingSettings = { politenessLevels: ['casual'] };
    await sweep(t, textId, casual);
    expect(llmEnqueues()).toMatchObject([
      {
        targetLanguage: 'es_mixed',
        variantKey: 'auto|t',
        requestedForm: { id: 't' },
        rewriteOf: '¿Viene usted?',
      },
    ]);
    expect(
      (await hydrateMixedSpanish(t, textId, cardId, casual)).hasMissingVariant,
    ).toBe(true);
  });

  it('a tu row (es-US) stamped casual needs the usted rewrite for "polite"', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedMixedSpanish(t, {
      renderedPoliteness: 'casual',
      translatedText: '¿Vienes?',
    });
    const polite: RenderingSettings = { politenessLevels: ['polite'] };
    await sweep(t, textId, polite);
    expect(llmEnqueues()).toMatchObject([
      {
        targetLanguage: 'es_mixed',
        variantKey: 'auto|v',
        requestedForm: { id: 'v' },
      },
    ]);
    expect(
      (await hydrateMixedSpanish(t, textId, cardId, polite)).hasMissingVariant,
    ).toBe(true);
  });
});
