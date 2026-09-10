/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import { internal, api } from '../../_generated/api';
import {
  ANNOTATION_REQUEST_COOLDOWN_MS,
  IPA_SOURCES,
  annotationsDue,
  scheduleTranslationAnnotations,
  TransientAnnotationError,
  getIpaSource,
  missingAnnotationKinds,
  romanizationAfterFailure,
  runSourceAnnotation,
} from '../../lib/textAnnotations';
import { getRomanizationSource } from '../../lib/localRomanization';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { liveTranslation, renderingTextOf } from '../../db/translationReads';
import { textRenderingKey } from '../../../lib/preferenceResolution';
import { CURRENT_SENTENCE_METADATA_SOURCE } from '../../../lib/sentenceMetadataSource';

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

  it('DOES replace a value written by a retired engine', async () => {
    // The third and last place the stale-refresh chain was broken. The probe
    // reported the card as needing work and the scheduler enqueued it, but
    // this mutation threw the recomputed value away because a value was
    // already there — so "(en)and(fr) jˈu" survived every version bump.
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);
    await t.run(async (ctx) =>
      ctx.db.patch(textId, {
        ipaText: '(en)and(fr) jˈu',
        ipaSource: 'espeak-ng-emscripten-0.3.5-v1',
      }),
    );

    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: 'and jˈuː',
      source: IPA_SOURCES.espeakNg,
    });

    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('and jˈuː');
    expect(text.ipaSource).toBe(IPA_SOURCES.espeakNg);
  });

  it('stops after one replacement, rather than rewriting on every pass', async () => {
    // The overwrite stamps the current tag, so the next attempt finds the row
    // current and declines. Without that it would be an unbounded loop.
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);
    await t.run(async (ctx) =>
      ctx.db.patch(textId, {
        ipaText: 'stale',
        ipaSource: 'espeak-ng-emscripten-0.3.5-v1',
      }),
    );
    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: 'first',
      source: IPA_SOURCES.espeakNg,
    });
    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: 'second',
      source: IPA_SOURCES.espeakNg,
    });
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('first');
  });

  it('leaves an untagged legacy value alone', async () => {
    // Nothing to compare against, so overwriting would be a rewrite on every
    // pass with no way to tell a good row from a stale one.
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);
    await t.run(async (ctx) => ctx.db.patch(textId, { ipaText: 'legacy' }));

    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'ipa',
      value: 'replacement',
      source: IPA_SOURCES.espeakNg,
    });

    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.ipaText).toBe('legacy');
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
      async (ctx) => (await liveTranslation(ctx, textId, 'fr'))!,
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
        metadataSource: CURRENT_SENTENCE_METADATA_SOURCE,
      });
      // A keyed row, as the pipeline writes them: the preview reads the
      // row at its key and annotates that one.
      const key = textRenderingKey({
        text: renderingTextOf((await ctx.db.get(textId))!),
        textId,
      });
      // Current translation with romanization already present, IPA missing:
      // the gate must schedule ONLY the missing kind.
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'el',
        translatedText: 'Καλημέρα',
        romanizedText: 'kalimera',
        romanizationSource: 'greek-utils-v1',
        variantKey: key,
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

describe('missingAnnotationKinds: stale-engine refresh', () => {
  // Viewing a card is what heals it. Before this, bumping an engine version
  // only changed the tag on FUTURE writes, so a user looking at their library
  // kept seeing the transcription the bump was meant to replace until someone
  // ran the reset migration.
  const current = getIpaSource('fr');

  it('re-schedules a row produced by an older engine', () => {
    expect(
      missingAnnotationKinds('fr', {
        ipaText: 'e twˈa',
        ipaSource: 'espeak-ng-emscripten-0.3.5-v1',
      }),
    ).toContain('ipa');
  });

  it('leaves a current-engine row alone', () => {
    expect(
      missingAnnotationKinds('fr', { ipaText: 'e twˈa', ipaSource: current }),
    ).not.toContain('ipa');
  });

  it('does not retry the current engine failure sentinel', () => {
    // That engine already tried and failed; retrying on every view would be a
    // call that always fails.
    expect(
      missingAnnotationKinds('fr', { ipaText: '', ipaSource: current }),
    ).not.toContain('ipa');
  });

  it('does retry a STALE failure sentinel', () => {
    // A new engine deserves its own attempt at a sentence the old one failed.
    expect(
      missingAnnotationKinds('fr', {
        ipaText: '',
        ipaSource: 'espeak-ng-emscripten-0.3.5-v1',
      }),
    ).toContain('ipa');
  });

  it('leaves an untagged row to the migration', () => {
    // Its value predates the source field, so there is nothing to compare.
    // Treating it as stale would re-attempt every legacy sentinel on view.
    expect(missingAnnotationKinds('fr', { ipaText: 'e twˈa' })).not.toContain(
      'ipa',
    );
  });

  it('refreshes romanization when the language changed engine', () => {
    // Hebrew moved off `hebrew-transliteration` in Sep 2026; its stored rows
    // carry the old tag and must regenerate the next time they are seen.
    expect(
      missingAnnotationKinds('he', {
        romanizedText: 'shlwm lkwlm',
        romanizationSource: 'hebrew-transliteration-v1',
      }),
    ).toContain('romanization');
  });
});

describe('runSourceAnnotation: transient vs permanent failure', () => {
  // The sentinel means "this engine cannot transcribe this input", and it is
  // permanent: nothing re-enqueues a row that has one. A deployment with no
  // OPENROUTER_API_KEY would otherwise stamp every Thai row as
  // untranscribable on its first pass, and Thai would stay blank forever
  // afterwards — long after the key was set.
  //
  // A fake ctx rather than the DB: what matters is whether the runner writes
  // at all, not what lands.
  function captureCtx() {
    const writes: Record<string, unknown>[] = [];
    return {
      writes,
      ctx: {
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          writes.push(args);
          return null;
        },
      } as unknown as Parameters<typeof runSourceAnnotation>[0],
    };
  }

  const args = {
    textId: 'text_1' as Id<'texts'>,
    text: 'hola mundo',
    language: 'es',
  };

  it('writes the sentinel for a failure about the text', async () => {
    const { ctx, writes } = captureCtx();
    await runSourceAnnotation(
      ctx,
      'ipa',
      args,
      () => Promise.reject(new Error('espeak produced empty IPA')),
      IPA_SOURCES.espeakNg,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ value: '' });
  });

  it('writes NOTHING for a configuration failure, so it retries later', async () => {
    const { ctx, writes } = captureCtx();
    await expect(
      runSourceAnnotation(
        ctx,
        'ipa',
        args,
        () =>
          Promise.reject(
            new TransientAnnotationError(
              'OPENROUTER_API_KEY environment variable is not set',
            ),
          ),
        IPA_SOURCES.espeakNg,
      ),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(writes).toHaveLength(0);
  });
});

describe('a recorded failure is final for the engine that recorded it', () => {
  // Two Thai cards sat with no romanization while their neighbours had one,
  // because a routing bug wrote the '' sentinel on every attempt. The fix is
  // upstream of the sentinel: a failure that says nothing about the text (a
  // missing key, a rate limit, an outage, an empty Google reply) never
  // becomes one (TransientAnnotationError), and the shared tag those rows
  // carried is retired, so they read as stale. A sentinel the CURRENT engine
  // wrote is believed: retrying it on every view would be a paid call that
  // already failed three times at temperature 0.
  const th = getRomanizationSource('th');

  it('retries a recorded failure only when its engine tag is stale', () => {
    expect(
      missingAnnotationKinds('th', {
        romanizedText: '',
        romanizationSource: 'gemini-3.8-flash-flex-v1',
      }),
    ).toContain('romanization');
    expect(
      missingAnnotationKinds('th', {
        romanizedText: '',
        romanizationSource: th,
      }),
    ).not.toContain('romanization');
    // Untagged: nothing to compare, and the reset migration owns those.
    expect(missingAnnotationKinds('th', { romanizedText: '' })).not.toContain(
      'romanization',
    );
  });

  it('honours a recorded failure for a deterministic engine', () => {
    // Mandarin romanizes through a local library, and IPA through espeak.
    expect(
      missingAnnotationKinds('zh', {
        romanizedText: '',
        romanizationSource: getRomanizationSource('zh'),
      }),
    ).not.toContain('romanization');
    expect(
      missingAnnotationKinds('fr', {
        ipaText: '',
        ipaSource: getIpaSource('fr'),
      }),
    ).not.toContain('ipa');
  });

  it('leaves a real value alone either way', () => {
    expect(
      missingAnnotationKinds('th', {
        romanizedText: 'laeo thoe la',
        romanizationSource: th,
      }),
    ).toEqual([]);
  });

  it('lets a real value replace a failure a retired engine recorded', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);
    await t.run(async (ctx) =>
      ctx.db.patch(textId, {
        language: 'th',
        romanizedText: '',
        romanizationSource: 'gemini-3.8-flash-flex-v1',
      }),
    );

    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'romanization',
      value: 'laeo thoe la',
      source: th,
    });

    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.romanizedText).toBe('laeo thoe la');
  });
});

describe('end to end: a blank Thai romanization recovers on view', () => {
  // Paul reported two Thai cards stuck with no romanization while their
  // neighbours had one. Reasoning about the chain found three separate
  // breaks (the probe, the scheduler, the store) and this test walks the
  // whole thing instead, so a fourth cannot hide.
  async function seedThaiCard(
    t: ReturnType<typeof convexTest>,
    romanization: { romanizedText?: string; romanizationSource?: string },
  ) {
    return t.run(async (ctx) => {
      const collectionId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 0,
      });
      const textId = await ctx.db.insert('texts', {
        text: 'And you?',
        language: 'en',
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'th',
        translatedText: 'แล้วเธอล่ะ',
        ...romanization,
      });
      return textId;
    });
  }

  async function scheduledRomanizationJobs(t: ReturnType<typeof convexTest>) {
    const jobs = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    return jobs.filter((j) =>
      j.name.includes('processRomanizationForTranslation'),
    );
  }

  it('schedules romanization when the row has none yet', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedThaiCard(t, {});
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query('translations')
        .filter((q) => q.eq(q.field('textId'), textId))
        .first())!;
      await scheduleTranslationAnnotations(ctx, row, undefined);
    });
    expect(await scheduledRomanizationJobs(t)).toHaveLength(1);
  });

  it('schedules romanization again when a retired engine recorded the blank', async () => {
    // Those two cards carried the '' sentinel under the tag the broken
    // routing wrote. That tag is gone, so the row reads as stale and gets
    // the new engine's attempt.
    const t = convexTest(schema, modules);
    const textId = await seedThaiCard(t, {
      romanizedText: '',
      romanizationSource: 'gemini-3.8-flash-flex-v1',
    });
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query('translations')
        .filter((q) => q.eq(q.field('textId'), textId))
        .first())!;
      await scheduleTranslationAnnotations(ctx, row, undefined);
    });
    expect(await scheduledRomanizationJobs(t)).toHaveLength(1);
  });

  it('schedules nothing when the current engine recorded the blank', async () => {
    // Three unusable replies at temperature 0 are a fact about the text;
    // re-buying them on every view would never end.
    const t = convexTest(schema, modules);
    const textId = await seedThaiCard(t, {
      romanizedText: '',
      romanizationSource: getRomanizationSource('th'),
    });
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query('translations')
        .filter((q) => q.eq(q.field('textId'), textId))
        .first())!;
      await scheduleTranslationAnnotations(ctx, row, undefined);
    });
    expect(await scheduledRomanizationJobs(t)).toHaveLength(0);
  });

  it('schedules nothing once a real romanization has landed', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedThaiCard(t, {
      romanizedText: 'laeo thoe la',
      romanizationSource: getRomanizationSource('th'),
    });
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query('translations')
        .filter((q) => q.eq(q.field('textId'), textId))
        .first())!;
      await scheduleTranslationAnnotations(ctx, row, undefined);
    });
    expect(await scheduledRomanizationJobs(t)).toHaveLength(0);
  });

  it('the store then accepts the value over the blank', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedThaiCard(t, {
      romanizedText: '',
      romanizationSource: 'gemini-3.8-flash-flex-v1',
    });
    await t.mutation(internal.features.decks.storeTranslationAnnotation, {
      textId,
      language: 'th',
      kind: 'romanization',
      value: 'laeo thoe la',
      source: getRomanizationSource('th'),
      forText: 'แล้วเธอล่ะ',
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query('translations')
        .filter((q) => q.eq(q.field('textId'), textId))
        .first(),
    );
    expect(row!.romanizedText).toBe('laeo thoe la');
  });
});

describe('sentence-form variants get their own annotations', () => {
  // A text can have several live Thai rows: a base and one per sentence-form
  // variant. `liveTranslation` matches `variantKey === undefined`, so telling
  // the store to "find the live row" always resolved to the BASE — a
  // variant's romanization was written onto its sibling and the variant
  // stayed blank forever. That is what left "And you?" showing แล้วเธอล่ะ
  // with no romanization while its base แล้วคุณล่ะครับ had one.
  async function seedBaseAndVariant(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const collectionId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 0,
      });
      const textId = await ctx.db.insert('texts', {
        text: 'And you?',
        language: 'en',
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      const baseId = await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'th',
        translatedText: 'แล้วคุณล่ะครับ',
        romanizedText: 'laeo khun la khrap',
        romanizationSource: getRomanizationSource('th'),
      });
      const variantId = await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'th',
        translatedText: 'แล้วเธอล่ะ',
        variantKey: 'auto|plain',
      });
      return { textId, baseId, variantId };
    });
  }

  it('schedules the variant row by id, not by (text, language)', async () => {
    const t = convexTest(schema, modules);
    const { variantId } = await seedBaseAndVariant(t);
    await t.run(async (ctx) => {
      const variant = (await ctx.db.get(variantId))!;
      await scheduleTranslationAnnotations(ctx, variant, undefined);
    });
    const jobs = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const romanization = jobs.filter((j) =>
      j.name.includes('processRomanizationForTranslation'),
    );
    expect(romanization).toHaveLength(1);
    // Naming the row is the whole fix: without it the store resolves the base.
    expect(romanization[0].args[0]).toMatchObject({ translationId: variantId });
  });

  it('writes the value onto the variant, leaving the base untouched', async () => {
    const t = convexTest(schema, modules);
    const { textId, baseId, variantId } = await seedBaseAndVariant(t);

    await t.mutation(internal.features.decks.storeTranslationAnnotation, {
      textId,
      language: 'th',
      kind: 'romanization',
      value: 'laeo thoe la',
      source: getRomanizationSource('th'),
      forText: 'แล้วเธอล่ะ',
      translationId: variantId,
    });

    const [variant, base] = await t.run(async (ctx) => [
      (await ctx.db.get(variantId))!,
      (await ctx.db.get(baseId))!,
    ]);
    expect(variant.romanizedText).toBe('laeo thoe la');
    expect(base.romanizedText).toBe('laeo khun la khrap');
  });
});

describe('romanization at translation time: transient failures are not facts', () => {
  it('a transient failure leaves the field undefined, any other persists the sentinel', () => {
    // The inline romanization sites (llmTranslationQueue, translationPipeline)
    // used to write '' for every error, including a 429 or a missing key,
    // which the current engine's tag then made final (2026-09-09 review).
    expect(
      romanizationAfterFailure(new TransientAnnotationError('429'), 'test'),
    ).toBeUndefined();
    expect(romanizationAfterFailure(new Error('bad input'), 'test')).toBe('');
  });
});

describe('annotation requests are claimed for a cooldown', () => {
  async function seedThai(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const collectionId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 0,
      });
      const textId = await ctx.db.insert('texts', {
        text: 'And you?',
        language: 'en',
        userCreated: false,
        collectionId,
        collectionRank: 1,
      });
      const rowId = await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'th',
        translatedText: 'แล้วเธอล่ะ',
      });
      return { textId, rowId };
    });
  }
  const jobs = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).filter(
        (j) => j.name.includes('processRomanizationForTranslation'),
      ),
    );
  const schedule = (
    t: ReturnType<typeof convexTest>,
    rowId: Id<'translations'>,
  ) =>
    t.run(async (ctx) => {
      const row = (await ctx.db.get(rowId))!;
      return scheduleTranslationAnnotations(ctx, row, undefined);
    });

  it('a second ask inside the window schedules nothing; one after it asks again', async () => {
    // A transient failure leaves the field undefined so the row is retried.
    // Without the claim every ensure pass during an outage scheduled the
    // failing action again for every affected row (2026-09-09 review).
    const t = convexTest(schema, modules);
    const { rowId } = await seedThai(t);
    expect(await schedule(t, rowId)).toEqual(['romanization']);
    expect(await jobs(t)).toHaveLength(1);
    const row = await t.run((ctx) => ctx.db.get(rowId));
    expect(row?.annotationRequestedAt).toBeDefined();
    expect(annotationsDue('th', row!)).toBe(false);

    expect(await schedule(t, rowId)).toEqual([]);
    expect(await jobs(t)).toHaveLength(1);

    await t.run((ctx) =>
      ctx.db.patch(rowId, {
        annotationRequestedAt: Date.now() - ANNOTATION_REQUEST_COOLDOWN_MS - 1,
      }),
    );
    expect(
      annotationsDue('th', (await t.run((ctx) => ctx.db.get(rowId)))!),
    ).toBe(true);
    expect(await schedule(t, rowId)).toEqual(['romanization']);
    expect(await jobs(t)).toHaveLength(2);
  });

  it('a row with nothing missing is not claimed', async () => {
    const t = convexTest(schema, modules);
    const { rowId } = await seedThai(t);
    await t.run((ctx) =>
      ctx.db.patch(rowId, {
        romanizedText: 'laeo thoe la',
        romanizationSource: getRomanizationSource('th'),
      }),
    );
    expect(await schedule(t, rowId)).toEqual([]);
    expect(
      (await t.run((ctx) => ctx.db.get(rowId)))?.annotationRequestedAt,
    ).toBeUndefined();
  });
});
