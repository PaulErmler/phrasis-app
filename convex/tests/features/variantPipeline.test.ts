/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { llmPool, ttsPool } from '@/convex/lib/workpools';
import { buildTextContentBatchForLanguages } from '../../lib/cardContent';
import {
  scheduleMissingContent,
  scheduleMissingRenderings,
} from '../../lib/contentScheduling';
import {
  audioPointer,
  liveTranslation,
  renderingTextOf,
  viewOfCard,
} from '../../db/translationReads';
import {
  getTtsProviderForLanguage,
  getVoiceForLanguage,
} from '../../../lib/languages';
import type { RenderingSettings } from '../../../lib/preferenceResolution';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

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
 */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    follows?: boolean;
    userCreated?: boolean;
    /** Classifier stamp on the canonical Japanese row (default unmarked). */
    jaGender?: 'masculine' | 'feminine' | 'unmarked';
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
        renderedGender:
          lang === 'ja' ? (opts.jaGender ?? 'unmarked') : 'unmarked',
        renderedPoliteness: lang === 'ja' ? 'casual' : 'unmarked',
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

const ensureRenderings = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  settings: RenderingSettings | undefined,
) =>
  t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    await scheduleMissingContent(ctx, textId, text, ['en'], ['ja', 'de']);
    return scheduleMissingRenderings(
      ctx,
      textId,
      text,
      ['en'],
      ['ja', 'de'],
      settings,
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

  it('a feminine course gets an audio-only variant on an unmarked language and keeps the male clip', async () => {
    const t = convexTest(schema, modules);
    // The canonical Japanese wording carries a masculine marker, so the
    // feminine course needs a rewrite of it; German never marks the speaker.
    const { textId, cardId } = await seed(t, { jaGender: 'masculine' });
    const settings: RenderingSettings = { firstPersonForms: 'feminine' };
    const scheduled = await ensureRenderings(t, textId, settings);
    // German: no LLM job, one female clip of the canonical wording.
    // Japanese: a rewrite job; its clip follows the rewrite.
    expect(llmEnqueues().map((j) => [j.targetLanguage, j.variantKey])).toEqual([
      ['ja', 'female|auto'],
    ]);
    expect(scheduled.audioScheduled).toBe(1);
    expect(
      ttsEnqueues().map((j) => [
        j.language,
        j.text,
        j.voiceGender,
        j.variantKey,
      ]),
    ).toEqual([['de', CANONICAL_DE, 'female', 'female|auto']]);
    // The male canonical clip is still there.
    expect(
      await t.run((ctx) => audioPointer(ctx, textId, 'de')),
    ).not.toBeNull();
    const content = await hydrate(t, textId, cardId, settings);
    expect(content.hasMissingVariant).toBe(true);
  });

  it('a canonical wording stamped unmarked for gender needs no rewrite, only the voice', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    const settings: RenderingSettings = { firstPersonForms: 'feminine' };
    const scheduled = await ensureRenderings(t, textId, settings);
    expect(llmEnqueues()).toEqual([]);
    // Both languages get a female clip of their canonical wording.
    expect(scheduled.audioScheduled).toBe(2);
    expect(
      ttsEnqueues()
        .map((j) => [j.language, j.variantKey])
        .sort(),
    ).toEqual([
      ['de', 'female|auto'],
      ['ja', 'female|auto'],
    ]);
    const content = await hydrate(t, textId, cardId, settings);
    // The wording is canonical, so it is not a text gap; the clips are.
    expect(content.hasMissingVariant).toBe(true);
    expect(content.translations.find((tr) => tr.language === 'ja')!.text).toBe(
      CANONICAL_JA,
    );
  });

  it('a user-written text ignores the settings entirely', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { userCreated: true });
    const settings: RenderingSettings = {
      firstPersonForms: 'feminine',
      politenessLevels: ['formal'],
    };
    const scheduled = await ensureRenderings(t, textId, settings);
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
});
