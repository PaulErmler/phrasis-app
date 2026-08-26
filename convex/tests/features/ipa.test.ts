/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../schema';
import { internal, api } from '../../_generated/api';
import { IPA_SOURCES } from '../../lib/textAnnotations';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * IPA pipeline tests against the STUBBED espeak engine (see the
 * `@echogarden/espeak-ng-emscripten` mock in tests/convexTestSetup.ts: it
 * always yields `m_ˈɒ_k_aɪ_p_iː_eɪ\n`, so a landed transcription reads
 * `mˈɒkaɪpiːeɪ`). Real-engine output is covered by the node-environment
 * suite (tests/node/espeak-ipa.test.ts). Here we care about the plumbing:
 * store idempotence, the '' sentinel, searchable-rebuild exemption, and
 * the preview-path scheduling gate.
 */

const MOCK_IPA = 'mˈɒkaɪpiːeɪ';

// Content scheduling fans out through 0ms scheduler hops; let them fire
// while the test context is alive (see drainScheduler docblock).
drainSchedulerAfterEach();

async function seedText(
  t: ReturnType<typeof convexTest>,
  language = 'es',
  // Must match the `text` the action is later called with: the store
  // mutations' `forText` guard drops results computed for other wording.
  text = 'Hola mundo',
) {
  return t.run(async (ctx) => {
    const collId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text,
      language,
      userCreated: false,
      collectionId: collId,
      collectionRank: 1,
    });
    return { collId, textId };
  });
}

describe('storeSourceAnnotation (kind: ipa)', () => {
  it('writes value + source once, never overwrites, honours the sentinel', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);

    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: 'ˈola ˈmundo',
      source: IPA_SOURCES.espeakNg,
    });
    let text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('ˈola ˈmundo');
    expect(text.ipaSource).toBe(IPA_SOURCES.espeakNg);
    // IPA is not searchable content: no rebuild debounce marker armed.
    expect(text.searchableRebuildScheduledAt).toBeUndefined();
    // Romanization pair untouched.
    expect(text.romanizedText).toBeUndefined();

    // Second write (e.g. a raced backfill) is a no-op.
    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: 'different',
      source: 'other-source',
    });
    text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('ˈola ˈmundo');
    expect(text.ipaSource).toBe(IPA_SOURCES.espeakNg);
  });

  it("persists the '' failure sentinel and refuses to replace it", async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);

    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: '',
      source: IPA_SOURCES.espeakNg,
    });
    let text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('');
    expect(text.searchableRebuildScheduledAt).toBeUndefined();

    // The sentinel is a real value: nothing overwrites it either.
    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: 'late arrival',
      source: IPA_SOURCES.espeakNg,
    });
    text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('');
  });
});

describe('processIpaFor* actions (stubbed engine)', () => {
  it('source text: computes and stores IPA with the engine source tag', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);

    await t.action(internal.features.ipa.processIpaForSourceText, {
      textId,
      text: 'Hola mundo',
      language: 'es',
    });
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe(MOCK_IPA);
    expect(text.ipaSource).toBe(IPA_SOURCES.espeakNg);
  });

  it('translation: computes and stores IPA on the translations row', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t, 'en');
    await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'fr',
        translatedText: 'Bonjour le monde',
      });
    });

    await t.action(internal.features.ipa.processIpaForTranslation, {
      textId,
      text: 'Bonjour le monde',
      language: 'fr',
    });
    const row = await t.run(
      async (ctx) =>
        (await ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'fr'),
          )
          .unique())!,
    );
    expect(row.ipaText).toBe(MOCK_IPA);
    expect(row.ipaSource).toBe(IPA_SOURCES.espeakNg);
  });

  it("persists the '' sentinel for a language with no espeak voice", async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t, 'fil', 'Kumusta ka?');

    // fil has no ipaVoice; ipaForText throws and the action persists ''.
    await t.action(internal.features.ipa.processIpaForSourceText, {
      textId,
      text: 'Kumusta ka?',
      language: 'fil',
    });
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('');
    expect(text.ipaSource).toBe(IPA_SOURCES.espeakNg);
  });
});

describe('preview-path scheduling gate', () => {
  it('schedules IPA (not just romanization) for rows missing it', async () => {
    const t = convexTest(schema, modules);
    const { collId, textId } = await t.run(async (ctx) => {
      const collId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 1,
      });
      const courseId = await ctx.db.insert('courses', {
        userId: 'user_A',
        baseLanguages: ['en'],
        targetLanguages: ['el'],
      });
      await ctx.db.insert('userSettings', {
        userId: 'user_A',
        hasCompletedOnboarding: true,
        activeCourseId: courseId,
      });
      const textId = await ctx.db.insert('texts', {
        text: 'Hello',
        language: 'en',
        userCreated: false,
        collectionId: collId,
        collectionRank: 1,
      });
      // Current translation with romanization already present, IPA missing:
      // the gate must schedule ONLY the missing kind.
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'el',
        translatedText: 'Καλημέρα',
        romanizedText: 'kalimera',
        romanizationSource: 'greek-utils-v1',
      });
      return { collId, textId };
    });

    const asUser = t.withIdentity({ subject: 'user_A' });
    await asUser.mutation(api.features.collections.requestPreviewTranslations, {
      collectionId: collId,
      textIds: [textId],
    });

    const jobs = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    // Source text 'en': IPA scheduled (English needs no romanization).
    const sourceIpaJobs = jobs.filter((j) =>
      j.name.includes('processIpaForSourceText'),
    );
    expect(sourceIpaJobs).toHaveLength(1);
    expect(sourceIpaJobs[0].args[0]).toMatchObject({
      textId,
      text: 'Hello',
      language: 'en',
    });
    // Translation 'el': IPA scheduled, romanization NOT re-scheduled.
    const translationIpaJobs = jobs.filter((j) =>
      j.name.includes('processIpaForTranslation'),
    );
    expect(translationIpaJobs).toHaveLength(1);
    expect(translationIpaJobs[0].args[0]).toMatchObject({
      textId,
      text: 'Καλημέρα',
      language: 'el',
    });
    expect(
      jobs.filter((j) => j.name.includes('processRomanizationForTranslation')),
    ).toHaveLength(0);
  });
});
