/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '../../schema';
import { ensureTextContent, ProbeNeedsWork } from '../../lib/contentScheduling';
import { hyperliteralWantsFor } from '../../../lib/annotationDisplay';
import { getHyperliteralSource } from '../../lib/hyperliterals';
import { scheduleMissingTranslationsForText } from '../../features/collections';
import { buildTextContentBatchForLanguages } from '../../lib/cardContent';
import { annotationFieldsOf } from '../../lib/textAnnotations';
import type { Id } from '../../_generated/dataModel';
import { getTtsProviderForLanguage } from '../../../lib/languages';
import { insertAudioFixture } from '../lib/audioFixtures';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * The gloss half of the content sweep, end to end: does turning the setting on
 * actually claim a row and schedule the model call, and does turning it off
 * cost nothing. The unit-level rules live in convex/tests/lib/hyperliterals.ts;
 * this is the wiring between the course setting and the scheduler.
 */

const COURSE = {
  _id: 'x' as Id<'courses'>,
  baseLanguages: ['en'],
  targetLanguages: ['ru'],
};

async function seed(
  t: TestConvex<typeof schema>,
  opts: { userCreated?: boolean } = {},
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'We are brothers.',
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
    const translationId = await ctx.db.insert('translations', {
      textId,
      targetLanguage: 'ru',
      translatedText: 'Мы братья.',
      romanizedText: '',
      ipaText: '',
      furiganaText: '',
      translationSource: 'openai/gpt-5.6-sol:floor-minimal',
      speakerGender: 'male',
      translationVersion: 99,
      variantKey: 'male',
    });
    for (const [language, spokenText, voiceName] of [
      ['en', 'We are brothers.', 'en-test-male'],
      ['ru', 'Мы братья.', 'ru-test-male'],
    ] as const) {
      await insertAudioFixture(ctx, {
        textId,
        language,
        voiceName,
        storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage(language),
        voiceGender: 'male',
        spokenText,
        ...(language === 'ru' ? { variantKey: 'male' } : {}),
      });
    }
    return { textId, translationId };
  });
}

const sweep = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  settings: Parameters<typeof hyperliteralWantsFor>[1],
) =>
  t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    const wants = hyperliteralWantsFor(COURSE, settings);
    return ensureTextContent(ctx, textId, text, ['en'], ['ru'], {
      ...(wants ? { hyperliteral: wants } : {}),
    });
  });

const glossRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query('hyperliterals').collect());

const pendingGlossJobs = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect()).filter(
      (job) =>
        job.name.includes('hyperliteral') && job.state.kind === 'pending',
    ),
  );

beforeEach(() => vi.clearAllMocks());

describe('the gloss half of the sweep', () => {
  it('claims a row and schedules the call when the setting is on', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId } = await seed(t);
    const result = await sweep(t, textId, { showHyperliteral: true });

    expect(result.hyperliteralsScheduled).toBe(1);
    const rows = await glossRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      translationId,
      language: 'ru',
      glossLanguage: 'en',
      forText: 'Мы братья.',
      source: getHyperliteralSource('ru'),
    });
    // The claim is open, not finished: the action fills it.
    expect(rows[0].text).toBeUndefined();
    expect(await pendingGlossJobs(t)).toHaveLength(1);
  });

  it('costs nothing at all when the setting is off', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const result = await sweep(t, textId, { showHyperliteral: false });

    expect(result.hyperliteralsScheduled).toBe(0);
    expect(await glossRows(t)).toHaveLength(0);
    expect(await pendingGlossJobs(t)).toHaveLength(0);
  });

  it('honours a per-language exception, so one language can opt out', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const result = await sweep(t, textId, {
      showHyperliteral: true,
      annotationOverrides: { ru: { hyperliteral: false } },
    });

    expect(result.hyperliteralsScheduled).toBe(0);
    expect(await glossRows(t)).toHaveLength(0);
  });

  it('never glosses a language into itself', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await sweep(t, textId, { showHyperliteral: true });
    const rows = await glossRows(t);
    // English is the gloss language; only the Russian row is claimed.
    expect(rows.map((r) => r.language)).toEqual(['ru']);
  });

  it('does not re-claim a row it already claimed', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await sweep(t, textId, { showHyperliteral: true });
    const second = await sweep(t, textId, { showHyperliteral: true });

    expect(second.hyperliteralsScheduled).toBe(0);
    expect(await glossRows(t)).toHaveLength(1);
  });

  it('probes as needing work, so the REVIEW path prepares the card', async () => {
    // The review flow probes first and only schedules `prepareCardContent`
    // when the probe throws. The gloss opts have to reach the PROBE too: with
    // only the library path wired, a card whose single gap was a gloss probed
    // clean and the gloss was never generated — which is exactly how this
    // shipped broken the first time.
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await expect(
      t.run(async (ctx) => {
        const text = (await ctx.db.get(textId))!;
        return ensureTextContent(ctx, textId, text, ['en'], ['ru'], {
          probe: true,
          hyperliteral: hyperliteralWantsFor(COURSE, {
            showHyperliteral: true,
          }),
        });
      }),
    ).rejects.toThrow(ProbeNeedsWork);
  });

  it('glosses a user-written sentence too, not just curriculum', async () => {
    // Nothing in the gloss path looks at `userCreated`: a sentence the learner
    // typed needs the gloss at least as much as a curriculum one.
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, { userCreated: true });
    const result = await sweep(t, textId, { showHyperliteral: true });

    expect(result.hyperliteralsScheduled).toBe(1);
    expect(await glossRows(t)).toHaveLength(1);
  });

  it('glosses a collection-preview row, which is not a card yet', async () => {
    // The preview scheduler is a different entry point again
    // (`scheduleMissingTranslationsForText`), and a learner reading a
    // collection before adding it should see the same gloss line the card
    // would show.
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      return scheduleMissingTranslationsForText(ctx, text, ['en', 'ru'], {
        hyperliteral: hyperliteralWantsFor(COURSE, { showHyperliteral: true }),
      });
    });

    const rows = await glossRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ language: 'ru', glossLanguage: 'en' });
  });

  it('flags a preview row as needing a backfill when only the gloss is missing', async () => {
    // The collection preview's client requests a row only when its
    // translations or its annotations are incomplete. A row whose ONLY gap
    // was a gloss answered "nothing missing" and was never requested, so the
    // gloss never appeared in the preview.
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const content = await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
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
          },
        ],
        ['en'],
        ['ru'],
        { hyperliteral: { glossLanguage: 'en', languages: ['ru'] } },
      );
      return map.get('k')!;
    });

    expect(content.hasMissingAnnotation).toBe(true);
    expect(content.hasMissingContent).toBe(true);
  });

  it('never asks for a gloss on a base language that is not English', async () => {
    // The gloss language is pinned to English, and a gate that asks only "are
    // the two codes different?" says a GERMAN-base learner's German line wants
    // one. Nothing generates it: `hyperliteralWantsFor` covers target
    // languages only. The card would then report missing content forever and
    // `useEnsureContent` would re-issue `ensureCardContent` every 15 seconds
    // for as long as it was on screen.
    //
    // Invisible on an English-base course, where the base language IS the
    // gloss language and drops out of the comparison on its own, which is why
    // every other fixture here uses `baseLanguages: ['en']`.
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const course = { ...COURSE, baseLanguages: ['de'] };
    const wants = hyperliteralWantsFor(course, { showHyperliteral: true })!;
    expect(wants.languages).toEqual(['ru']);

    const content = await t.run(async (ctx) => {
      const text = (await ctx.db.get(textId))!;
      // The German line the learner reads, plus its audio, so the only gap
      // this case can report is a gloss.
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'de',
        translatedText: 'Wir sind Brüder.',
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        speakerGender: 'male',
        translationVersion: 99,
        variantKey: 'male',
      });
      await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        voiceName: 'de-test-male',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
        ttsQuality: 'validated',
        ttsProvider: getTtsProviderForLanguage('de'),
        voiceGender: 'male',
        spokenText: 'Wir sind Brüder.',
        variantKey: 'male',
      });
      // The Russian gloss, the one the sweep really does make, already done.
      await ctx.db.insert('hyperliterals', {
        translationId: (await ctx.db
          .query('translations')
          .filter((q) => q.eq(q.field('targetLanguage'), 'ru'))
          .first())!._id,
        language: 'ru',
        glossLanguage: 'en',
        forText: 'Мы братья.',
        text: 'We are brothers.',
        source: getHyperliteralSource('ru'),
        requestedAt: Date.now(),
      });
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
          },
        ],
        ['de'],
        ['ru'],
        // `ignoreMissingWordTimings` matches the review path and keeps the
        // fixtures' timing-less audio out of the assertion below.
        { hyperliteral: wants, ignoreMissingWordTimings: true },
      );
      return map.get('k')!;
    });

    // The German line carries no gloss and asks for none; the Russian one has
    // the gloss the sweep actually made.
    expect(content.hasMissingAnnotation).toBe(false);
    expect(content.hasMissingContent).toBe(false);
    expect(
      content.translations.find((tr) => tr.language === 'de')?.hyperliteral,
    ).toBeUndefined();
    expect(
      content.translations.find((tr) => tr.language === 'ru')?.hyperliteral,
    ).toBe('We are brothers.');
  });

  it('re-claims after the sentence is reworded', async () => {
    const t = convexTest(schema, modules);
    const { textId, translationId } = await seed(t);
    await sweep(t, textId, { showHyperliteral: true });
    await t.run(async (ctx) => {
      await ctx.db.patch(
        'hyperliterals',
        (await ctx.db.query('hyperliterals').first())!._id,
        {
          text: 'we are brothers',
        },
      );
      await ctx.db.patch('translations', translationId, {
        translatedText: 'Мы сёстры.',
      });
    });
    const again = await sweep(t, textId, { showHyperliteral: true });

    expect(again.hyperliteralsScheduled).toBe(1);
    const rows = await glossRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].forText).toBe('Мы сёстры.');
    expect(rows[0].text).toBeUndefined();
  });
});
