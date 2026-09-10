/// <reference types="vite/client" />
import { vi as vitestMock } from 'vitest';
vitestMock.mock('ai', () => ({
  generateText: vitestMock.fn(async () => ({ text: '[]' })),
}));
vitestMock.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => () => ({}),
}));
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import { llmPool, ttsPool } from '@/convex/lib/workpools';
import { buildTextContentBatchForLanguages } from '../../lib/cardContent';
import { annotationFieldsOf } from '../../lib/textAnnotations';
import {
  ensureTextContent,
  MAX_METADATA_ATTEMPTS,
  metadataState,
  ProbeNeedsWork,
} from '../../lib/contentScheduling';
import { internal } from '../../_generated/api';
import {
  audioPointer,
  liveTranslation,
  renderingCardOf,
  renderingTextOf,
  resolveServedRendering,
  viewOfCard,
} from '../../db/translationReads';
import {
  getCurrentTtsVersion,
  getTtsProviderForLanguage,
} from '../../../lib/languages';
import { getVoiceForText, getVoiceLocale } from '../../../lib/voices';
import type { RenderingSettings } from '../../../lib/preferenceResolution';
import { CURRENT_SENTENCE_METADATA_SOURCE } from '../../../lib/sentenceMetadataSource';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * The rendering-key invariants (docs/architecture/rendering-keys.md): a
 * legacy card keeps its legacy rows, every other view reads the row at its
 * key, a legacy row may stand in for the primary key (copied without a call
 * where the wording cannot carry an axis, verified otherwise), a versioned
 * key is rendered with the primary in one job, a derivation-stale row is
 * regenerated through the bump path, and nothing is ever generated from a
 * guess a verdict can overturn.
 */

const LEGACY_JA = '疲れた。';
const LEGACY_TR = 'Yorgunum.';

// A Mixed English base also asks for the text's accent row (en_gb / en_au);
// these tests are about the ja/tr rows, so those jobs are filtered out.
const llmEnqueues = () =>
  vi
    .mocked(llmPool.enqueueAction)
    .mock.calls.map(
      (c) =>
        c[2] as {
          textId: Id<'texts'>;
          targetLanguage: string;
          renderingKeys: string[];
          adoptLegacy?: boolean;
          skipTts?: boolean;
          replaceExisting?: boolean;
          translationReason?: string;
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

/**
 * A learner (user_A, course en→ja+tr) with one premade text, classified,
 * voiced male, whose Japanese and Turkish LEGACY rows and clips exist. The
 * card is created with or without the settings stamp.
 */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    follows?: boolean;
    userCreated?: boolean;
    genderOverride?: 'male' | 'female';
    politenessOverride?: 'casual' | 'polite' | 'formal';
    /** Rows keyed instead of legacy (a text written after the cutover). */
    keyed?: boolean;
    classified?: boolean;
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
      targetLanguages: ['ja', 'tr'],
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
      ...(opts.classified === false
        ? {}
        : { metadataSource: CURRENT_SENTENCE_METADATA_SOURCE }),
      ipaText: '',
      romanizedText: '',
    });
    const rows: Record<string, Id<'translations'>> = {};
    // A user-written text has one rendering per language, `<voice>|none`.
    const keyOf = (key: string) => (opts.userCreated ? 'male|none' : key);
    for (const [lang, text, key] of [
      ['ja', LEGACY_JA, 'male|desu-masu'],
      ['tr', LEGACY_TR, 'male|none'],
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
        ...(opts.keyed ? { variantKey: keyOf(key) } : {}),
      });
      // The clip the pipeline would have made: the language's real male
      // voice for this text (and its accent, on a mixed-accent pool), so a
      // keyed pointer finds it in the cache.
      const voiceName = getVoiceForText(lang, textId, undefined, 'male');
      const accent = getVoiceLocale(voiceName) ?? undefined;
      await insertAudioFixture(ctx, {
        textId,
        language: lang,
        voiceName,
        regionVariant: accent,
        storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage(lang),
        ttsVersion: getCurrentTtsVersion(lang, accent),
        voiceGender: 'male',
        spokenText: text,
        wordTimings: [],
        ...(opts.keyed ? { variantKey: keyOf(key) } : {}),
      });
    }
    const enVoice = getVoiceForText('en', textId, undefined, 'male');
    const enAccent = getVoiceLocale(enVoice) ?? undefined;
    await insertAudioFixture(ctx, {
      textId,
      language: 'en',
      voiceName: enVoice,
      regionVariant: enAccent,
      storageId: await ctx.storage.store(new Blob([new Uint8Array([2])])),
      ttsQuality: 'validated',
      ttsProvider: getTtsProviderForLanguage('en'),
      ttsVersion: getCurrentTtsVersion('en', enAccent),
      voiceGender: 'male',
      spokenText: "I'm tired.",
      wordTimings: [],
      ...(opts.keyed ? { variantKey: 'male|none' } : {}),
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
      ...(opts.politenessOverride
        ? { renderingPolitenessOverride: opts.politenessOverride }
        : {}),
    });
    return { textId, cardId, courseId, deckId, rows };
  });
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
      ['ja', 'tr'],
      { includeVariantGaps: true },
    );
    return map.get('k')!;
  });
}

/** The sweep as the review path runs it: with the card and the settings. */
const ensure = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  cardId: Id<'cards'>,
  settings: RenderingSettings | undefined,
  extra: { skipTts?: boolean; probe?: boolean } = {},
) =>
  t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const card = (await ctx.db.get(cardId))!;
    return ensureTextContent(ctx, textId, text, ['en'], ['ja', 'tr'], {
      card: renderingCardOf(card),
      settings,
      ...extra,
    });
  });

const served = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  cardId: Id<'cards'>,
  lang: string,
  settings: RenderingSettings | undefined,
) =>
  t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const card = (await ctx.db.get(cardId))!;
    return resolveServedRendering(ctx, {
      textId,
      targetLanguage: lang,
      text: renderingTextOf(text),
      view: viewOfCard(card, settings),
    });
  });

describe('legacy cards', () => {
  it('keep their legacy rows: nothing is generated and the chips show the voice only', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { follows: false });
    await ensure(t, textId, cardId, { politenessLevels: ['polite'] });
    expect(llmEnqueues()).toEqual([]);
    expect(ttsEnqueues()).toEqual([]);
    const content = await hydrate(t, textId, cardId, {
      politenessLevels: ['polite'],
    });
    const ja = content.translations.find((tr) => tr.language === 'ja')!;
    expect(ja.text).toBe(LEGACY_JA);
    expect(ja.voiceGender).toBe('male');
    expect(ja.politenessLevel).toBeUndefined();
    expect(ja.formPending).toBeUndefined();
    expect(content.hasMissingVariant).toBe(false);
    expect(content.hasMissingContent).toBe(false);
    const rendering = await served(t, textId, cardId, 'ja', {
      politenessLevels: ['polite'],
    });
    expect(rendering.servedKeyed).toBe(false);
    expect(rendering.textPending).toBe(false);
  });

  it('read a keyed row only for a language they have no legacy row in', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, rows } = await seed(t, { follows: false });
    await t.run(async (ctx) => {
      await ctx.db.delete(rows.tr);
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'tr',
        translatedText: 'Yorgunum!',
        variantKey: 'male|none',
        speakerGender: 'male',
      });
    });
    const rendering = await served(t, textId, cardId, 'tr', undefined);
    expect(rendering.servedKeyed).toBe(true);
    expect(rendering.served?.row.translatedText).toBe('Yorgunum!');
  });
});

describe('a settings-following card with legacy rows', () => {
  it('adopts the legacy row for the primary key: a copy without a call where nothing can differ, a verifying job otherwise', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId, rows } = await seed(t);
    await ensure(t, textId, cardId, undefined);
    // Turkish marks neither the first person nor a form on a sentence with
    // no "you": the legacy row is copied under the primary key.
    const tr = await t.run((ctx) =>
      liveTranslation(ctx, textId, 'tr', 'male|none'),
    );
    expect(tr).toMatchObject({
      translatedText: LEGACY_TR,
      translationVersion: 99,
      speakerGender: 'male',
    });
    expect(tr?._id).not.toBe(rows.tr);
    // The legacy row survives for the legacy cards.
    expect(await t.run((ctx) => ctx.db.get(rows.tr))).not.toBeNull();
    // Japanese marks the form: the legacy wording is offered for adoption
    // to a verifying job.
    expect(llmEnqueues()).toEqual([
      expect.objectContaining({
        targetLanguage: 'ja',
        renderingKeys: ['male|desu-masu'],
        adoptLegacy: true,
      }),
    ]);
    // The copied row and the source slot reuse their clips by string and
    // voice: no synthesis.
    expect(ttsEnqueues()).toEqual([]);
    expect(
      await t.run((ctx) => audioPointer(ctx, textId, 'tr', 'male|none')),
    ).not.toBeNull();
    expect(
      await t.run((ctx) => audioPointer(ctx, textId, 'en', 'male|none')),
    ).not.toBeNull();
  });

  it('shows the legacy wording as a placeholder while its keyed row is made', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    const content = await hydrate(t, textId, cardId, undefined);
    const ja = content.translations.find((tr) => tr.language === 'ja')!;
    expect(ja.text).toBe(LEGACY_JA);
    expect(ja.formPending).toBe(true);
    expect(ja.politenessLevel).toBeUndefined();
    expect(content.hasMissingVariant).toBe(true);
    expect(content.hasMissingContent).toBe(true);
    const rendering = await served(t, textId, cardId, 'ja', undefined);
    expect(rendering.textPending).toBe(true);
    expect(rendering.servedKeyed).toBe(false);
  });

  it('renders a non-primary form with the primary in one job, primary first', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    await ensure(t, textId, cardId, { politenessLevels: ['casual'] });
    // The primary is offered the legacy wording for adoption, as a
    // primary-only job would be; the casual key is versioned from it.
    expect(llmEnqueues()).toEqual([
      expect.objectContaining({
        targetLanguage: 'ja',
        renderingKeys: ['male|desu-masu', 'male|plain'],
        adoptLegacy: true,
      }),
    ]);
    // Every key was claimed by the mutation.
    const claims = await t.run((ctx) =>
      ctx.db
        .query('llmTranslationClaims')
        .filter((q) => q.eq(q.field('targetLanguage'), 'ja'))
        .collect(),
    );
    expect(claims.map((c) => c.variantKey).sort()).toEqual([
      'male|desu-masu',
      'male|plain',
    ]);
  });

  it('serves a landed keyed row with its level chip and asks for nothing more', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: '疲れた。',
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        variantKey: 'male|plain',
        speakerGender: 'male',
        translationVersion: 99,
        versionedFromText: '疲れました。',
      });
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: '疲れました。',
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        variantKey: 'male|desu-masu',
        speakerGender: 'male',
        translationVersion: 99,
      });
    });
    const settings: RenderingSettings = { politenessLevels: ['casual'] };
    const content = await hydrate(t, textId, cardId, settings);
    const ja = content.translations.find((tr) => tr.language === 'ja')!;
    expect(ja.text).toBe('疲れた。');
    expect(ja.politenessLevel).toBe('casual');
    expect(ja.formLanguage).toBe('ja');
    expect(ja.formPending).toBeUndefined();
    await ensure(t, textId, cardId, settings);
    expect(llmEnqueues()).toEqual([]);
    // The clip of the keyed wording is reused from the cache by string.
    expect(ttsEnqueues()).toEqual([]);
    expect(
      await t.run((ctx) => audioPointer(ctx, textId, 'ja', 'male|plain')),
    ).not.toBeNull();
  });

  it('regenerates a derivation-stale row through the bump path', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: '疲れました。',
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        variantKey: 'male|desu-masu',
        speakerGender: 'male',
        translationVersion: 99,
      });
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: '疲れた。',
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        variantKey: 'male|plain',
        speakerGender: 'male',
        translationVersion: 99,
        // Versioned from a primary wording that has since moved on.
        versionedFromText: 'とても疲れました。',
      });
    });
    await ensure(t, textId, cardId, { politenessLevels: ['casual'] });
    expect(llmEnqueues()).toEqual([
      expect.objectContaining({
        targetLanguage: 'ja',
        renderingKeys: ['male|plain'],
        replaceExisting: true,
        translationReason: 'version_bump',
      }),
    ]);
    // The row keeps serving until the new wording lands.
    expect(
      await t.run((ctx) => liveTranslation(ctx, textId, 'ja', 'male|plain')),
    ).not.toBeNull();
  });

  it('a browse surface asks for the wording only', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    await ensure(t, textId, cardId, undefined, { skipTts: true });
    expect(llmEnqueues()).toEqual([
      expect.objectContaining({ targetLanguage: 'ja', skipTts: true }),
    ]);
    expect(ttsEnqueues()).toEqual([]);
  });

  it('in probe mode reports the work without writing', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t);
    await expect(
      ensure(t, textId, cardId, undefined, { probe: true }),
    ).rejects.toBeInstanceOf(ProbeNeedsWork);
    expect(llmEnqueues()).toEqual([]);
    expect(
      await t.run((ctx) => liveTranslation(ctx, textId, 'tr', 'male|none')),
    ).toBeNull();
  });
});

describe('claims and the metadata gate', () => {
  it('a legacy card buys no clip for a legacy row whose retranslation is in flight', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { follows: false });
    await t.run(async (ctx) => {
      // The clip is gone and a flag's job holds the LEGACY slot's claim.
      const pointer = (await audioPointer(ctx, textId, 'ja'))!;
      await ctx.db.delete(pointer._id);
      await ctx.db.insert('llmTranslationClaims', {
        textId,
        targetLanguage: 'ja',
        claimedAt: Date.now(),
        workId: 'flag-job',
      });
    });
    await ensure(t, textId, cardId, undefined);
    expect(ttsEnqueues().filter((job) => job.language === 'ja')).toEqual([]);
  });

  it('the store releases the key\'s claim, so a later failure of the same job leaves it free', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, { keyed: true });
    const claimId = await t.run((ctx) =>
      ctx.db.insert('llmTranslationClaims', {
        textId,
        targetLanguage: 'ja',
        variantKey: 'male|plain',
        claimedAt: Date.now(),
        workId: 'job',
      }),
    );
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'ja',
      translatedText: '疲れた。',
      voiceName: 'Achird',
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      variantKey: 'male|plain',
      versionedFromText: LEGACY_JA,
      expectedClaimId: claimId,
      skipTts: true,
    });
    expect(await t.run((ctx) => ctx.db.get(claimId))).toBeNull();
    expect(
      await t.run((ctx) => liveTranslation(ctx, textId, 'ja', 'male|plain')),
    ).toMatchObject({ translatedText: '疲れた。' });
  });

  it('a request inside its cooldown is in flight whatever the attempt count', () => {
    const base = { userCreated: false, metadataSource: undefined };
    expect(
      metadataState({
        ...base,
        metadataAttempts: MAX_METADATA_ATTEMPTS,
        metadataRequestedAt: Date.now(),
      }),
    ).toBe('in_flight');
    expect(
      metadataState({
        ...base,
        metadataAttempts: MAX_METADATA_ATTEMPTS,
        metadataRequestedAt: Date.now() - 16 * 60 * 1000,
      }),
    ).toBe('exhausted');
    expect(
      metadataState({
        ...base,
        metadataAttempts: 1,
        metadataRequestedAt: Date.now() - 16 * 60 * 1000,
      }),
    ).toBe('needed');
  });
});

describe('corrections and user texts', () => {
  it('a gender correction moves a legacy card onto keyed rows in the other voice', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, {
      follows: false,
      genderOverride: 'female',
    });
    await ensure(t, textId, cardId, undefined);
    // Turkish: the primary is copied from the legacy row, then the female
    // key is versioned from it (a copy inside the job, no call).
    expect(
      await t.run((ctx) => liveTranslation(ctx, textId, 'tr', 'male|none')),
    ).not.toBeNull();
    const jobs = llmEnqueues();
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetLanguage: 'tr',
          renderingKeys: ['female|none'],
        }),
        expect.objectContaining({
          targetLanguage: 'ja',
          renderingKeys: ['male|desu-masu', 'female|desu-masu'],
        }),
      ]),
    );
    // The source clip is voiced in the card's voice.
    expect(ttsEnqueues()).toEqual([
      expect.objectContaining({
        language: 'en',
        voiceGender: 'female',
        variantKey: 'female|none',
      }),
    ]);
  });

  it('a politeness correction picks its own form on a legacy card', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, {
      follows: false,
      politenessOverride: 'formal',
    });
    const rendering = await served(t, textId, cardId, 'ja', undefined);
    expect(rendering.rendering.key).toBe('male|keigo');
    expect(rendering.textPending).toBe(true);
    await ensure(t, textId, cardId, undefined);
    // The correction is the card's, so every language of the card takes
    // it: Japanese renders the primary and the keigo form in one job;
    // Turkish copies its primary from the legacy row and versions the
    // formal key from it.
    expect(llmEnqueues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetLanguage: 'ja',
          renderingKeys: ['male|desu-masu', 'male|keigo'],
        }),
        expect.objectContaining({
          targetLanguage: 'tr',
          renderingKeys: ['male|v'],
        }),
      ]),
    );
    expect(llmEnqueues()).toHaveLength(2);
  });

  it('a user-written text has one keyed rendering per language and ignores the settings', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { userCreated: true, keyed: true });
    await ensure(t, textId, cardId, { politenessLevels: ['casual'] });
    expect(llmEnqueues()).toEqual([]);
    expect(ttsEnqueues()).toEqual([]);
    const rendering = await served(t, textId, cardId, 'ja', {
      politenessLevels: ['casual'],
    });
    expect(rendering.rendering.key).toBe('male|none');
    expect(rendering.served?.row.translatedText).toBe(LEGACY_JA);
    expect(rendering.textPending).toBe(false);
  });

  it('a user-written text from before the cutover keeps its legacy rows', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { userCreated: true });
    await ensure(t, textId, cardId, undefined);
    expect(llmEnqueues()).toEqual([]);
    const rendering = await served(t, textId, cardId, 'ja', undefined);
    expect(rendering.servedKeyed).toBe(false);
    expect(rendering.served?.row.translatedText).toBe(LEGACY_JA);
  });
});

describe('the metadata precondition', () => {
  it('an unclassified text asks the classifier and computes no key', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seed(t, { classified: false });
    await ensure(t, textId, cardId, undefined);
    expect(llmEnqueues()).toEqual([]);
    expect(
      await t.run((ctx) => liveTranslation(ctx, textId, 'tr', 'male|none')),
    ).toBeNull();
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).filter(
        (job) =>
          job.name.includes('classifyCurriculumText') &&
          job.state.kind === 'pending',
      ),
    );
    expect(jobs).toHaveLength(1);
  });
});
