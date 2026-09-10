/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import { buildTextContentBatchForLanguages } from '../../lib/cardContent';
import { annotationFieldsOf, getIpaSource } from '../../lib/textAnnotations';
import { getRomanizationSource } from '../../lib/localRomanization';
import { insertAudioFixture } from './audioFixtures';

const modules = import.meta.glob('../../**/*.ts');

const TIMINGS = [{ word: 'x', start: 0, end: 1 }];

/**
 * Seed a fully-populated card so `hasMissingContent` is driven ONLY by the
 * field under test: a text, one translation per non-source language, and an
 * audio row per language (with word timings, so the timings check is quiet
 * unless a test deliberately drops them).
 */
async function seedCard(
  t: TestConvex<typeof schema>,
  args: {
    sourceLanguage: string;
    /** Undefined = never attempted, '' = tried-and-failed sentinel. */
    sourceRomanizedText?: string;
    /**
     * IPA tri-state: omit for the default complete value, '' for the
     * sentinel, null to leave the field absent (never attempted).
     */
    sourceIpaText?: string | null;
    translations: Array<{
      language: string;
      romanizedText?: string;
      /** Engine tag beside `romanizedText`; omit for an untagged row. */
      romanizationSource?: string;
      /** Same tri-state convention as sourceIpaText. */
      ipaText?: string | null;
    }>;
    /** Languages whose audio row should carry no word timings. */
    languagesWithoutTimings?: string[];
    /** Languages whose clip was stored 'unchecked' (STT failed at synthesis). */
    uncheckedLanguages?: string[];
    /** Languages whose asset has used up its STT backfill attempts. */
    exhaustedLanguages?: string[];
  },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    // IPA defaults to a complete value (a fully-populated card carries one
    // since the annotations refactor); '' seeds the sentinel; null omits.
    const sourceIpa =
      args.sourceIpaText === undefined ? 'ipa-source' : args.sourceIpaText;
    const textId = await ctx.db.insert('texts', {
      text: 'source text',
      language: args.sourceLanguage,
      userCreated: false,
      collectionId,
      collectionRank: 1,
      ...(args.sourceRomanizedText !== undefined
        ? { romanizedText: args.sourceRomanizedText }
        : {}),
      ...(sourceIpa !== null ? { ipaText: sourceIpa } : {}),
      // Same reasoning for furigana, but only ja carries the field: a
      // complete Japanese row has one since the furigana feature landed.
      ...(args.sourceLanguage === 'ja' ? { furiganaText: 'ふりがな' } : {}),
    });

    for (const tr of args.translations) {
      const trIpa =
        tr.ipaText === undefined ? `ipa-${tr.language}` : tr.ipaText;
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: tr.language,
        translatedText: `translated-${tr.language}`,
        ...(tr.romanizedText !== undefined
          ? { romanizedText: tr.romanizedText }
          : {}),
        ...(tr.romanizationSource !== undefined
          ? { romanizationSource: tr.romanizationSource }
          : {}),
        ...(trIpa !== null ? { ipaText: trIpa } : {}),
      });
    }

    const withoutTimings = new Set(args.languagesWithoutTimings ?? []);
    const unchecked = new Set(args.uncheckedLanguages ?? []);
    const exhausted = new Set(args.exhaustedLanguages ?? []);
    const languages = [
      args.sourceLanguage,
      ...args.translations.map((tr) => tr.language),
    ];
    for (const language of languages) {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1, 2, 3])]),
      );
      const { assetId } = await insertAudioFixture(ctx, {
        textId,
        language,
        storageId,
        ttsQuality: unchecked.has(language) ? 'unchecked' : 'validated',
        ...(withoutTimings.has(language) ? {} : { wordTimings: TIMINGS }),
      });
      if (exhausted.has(language)) {
        await ctx.db.patch(assetId, { revalidationAttempts: 3 });
      }
    }

    return textId;
  });
}

async function hasMissingContent(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  sourceLanguage: string,
  baseLanguages: string[],
  targetLanguages: string[],
  opts?: { ignoreMissingWordTimings?: boolean },
) {
  return t.run(async (ctx) => {
    const map = await buildTextContentBatchForLanguages(
      ctx,
      [
        {
          key: 'k',
          textId,
          sourceText: 'source text',
          sourceLanguage,
          sourceAnnotations: annotationFieldsOf((await ctx.db.get(textId))!),
          userCreated: false,
        },
      ],
      baseLanguages,
      targetLanguages,
      opts,
    );
    return map.get('k')!.hasMissingContent;
  });
}

describe('buildTextContentBatchForLanguages: stale engine tags', () => {
  // The probe reads the stored tags, so a row a retired engine wrote is
  // missing content the moment it is looked at, without a migration.
  it('reports a translation romanized by a retired engine as missing', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [
        {
          language: 'he',
          romanizedText: 'šlwm lkwlm',
          romanizationSource: 'hebrew-transliteration-v1',
        },
      ],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['he'])).toBe(true);
  });

  it('accepts the same row once the current engine wrote it', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [
        {
          language: 'he',
          romanizedText: 'shalom lekhulam',
          romanizationSource: getRomanizationSource('he'),
        },
      ],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['he'])).toBe(
      false,
    );
  });
});

describe('buildTextContentBatchForLanguages: romanization sentinel', () => {
  // `zh` needs romanization; `en` does not. The empty string is the
  // "tried, failed, leave empty" sentinel the romanization workers persist
  // after exhausting their retries. The schedulers in decks.ts never
  // re-enqueue it, so reporting the card as incomplete would ask forever for
  // work nothing is willing to do.
  it('treats a sentinel romanization on a translation as attempted', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'zh', romanizedText: '' }],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['zh'])).toBe(
      false,
    );
  });

  it('still reports a never-attempted romanization on a translation', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'zh' }],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['zh'])).toBe(true);
  });

  it('treats a sentinel romanization on the source text as attempted', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'zh',
      sourceRomanizedText: '',
      translations: [{ language: 'en' }],
    });
    expect(await hasMissingContent(t, textId, 'zh', ['en'], ['zh'])).toBe(
      false,
    );
  });

  it('still reports a never-attempted romanization on the source text', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'zh',
      translations: [{ language: 'en' }],
    });
    expect(await hasMissingContent(t, textId, 'zh', ['en'], ['zh'])).toBe(true);
  });

  it("ignores romanization entirely for languages that don't need it", async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'de' }],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['de'])).toBe(
      false,
    );
  });
});

describe('buildTextContentBatchForLanguages: IPA sentinel', () => {
  // Same tri-state as romanization, IPA edition: '' = tried-and-failed
  // sentinel (espeak produced nothing), undefined/absent = never attempted.
  it('treats a sentinel IPA on a translation as attempted', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'es', ipaText: '' }],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['es'])).toBe(
      false,
    );
  });

  it('still reports a never-attempted IPA on a translation', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'es', ipaText: null }],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['es'])).toBe(true);
  });

  it('still reports a never-attempted IPA on the source text', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      sourceIpaText: null,
      translations: [{ language: 'es' }],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['es'])).toBe(true);
  });

  it("ignores IPA for languages espeak can't serve (ja)", async () => {
    const t = convexTest(schema, modules);
    // ja is excluded from IPA_LANGUAGES; romanization present, so complete.
    const textId = await seedCard(t, {
      sourceLanguage: 'ja',
      sourceRomanizedText: 'konnichiwa',
      sourceIpaText: null,
      translations: [{ language: 'en', romanizedText: 'hello' }],
    });
    expect(await hasMissingContent(t, textId, 'ja', ['en'], ['ja'])).toBe(
      false,
    );
  });
});

describe('buildTextContentBatchForLanguages: word timings', () => {
  // `scheduleTimingsBackfillIfNeeded` refuses to schedule a backfill for
  // languages our STT backend can't transcribe, so flagging those cards as
  // incomplete asks for work that is deliberately never done. Every
  // catalogue language supports STT as of Sep 2026, so the only code that
  // still reports no support is one the catalogue doesn't know.
  it('does not report missing timings for a language without STT support', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'xx' }],
      languagesWithoutTimings: ['xx'],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['xx'])).toBe(
      false,
    );
  });

  it('still reports missing timings for a language with STT support', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'de' }],
      languagesWithoutTimings: ['de'],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['de'])).toBe(true);
  });

  it('honours ignoreMissingWordTimings', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'de' }],
      languagesWithoutTimings: ['de'],
    });
    expect(
      await hasMissingContent(t, textId, 'en', ['en'], ['de'], {
        ignoreMissingWordTimings: true,
      }),
    ).toBe(false);
  });
});

describe('unchecked audio (STT failed at synthesis time)', () => {
  it('is missing content until the sweep re-validates it', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'es' }],
      uncheckedLanguages: ['es'],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['es'])).toBe(true);
    // Not a timings gap, so the review path's exemption does not hide it.
    expect(
      await hasMissingContent(t, textId, 'en', ['en'], ['es'], {
        ignoreMissingWordTimings: true,
      }),
    ).toBe(true);
  });

  it('stops asking once the asset has used up its STT backfill attempts', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'es' }],
      uncheckedLanguages: ['es'],
      languagesWithoutTimings: ['es'],
      exhaustedLanguages: ['es'],
    });
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['es'])).toBe(
      false,
    );
  });
});

describe('buildTextContentBatchForLanguages: stale engine', () => {
  // The reported symptom: a French-voice transcription, "(en)and(fr) jˈu",
  // sat on an English card through a version bump. The scheduler knew it was
  // stale, but the client only calls ensureCardContent when
  // hasMissingContent is true, and that probe asked "is a value present?"
  // rather than "is the value current?" — so the card never asked for the
  // work and the bad line stayed on screen.
  //
  // seedCard builds an otherwise-complete card (audio, timings, translation),
  // so the only term left free is the annotation one.
  async function seedWithIpaSource(
    t: TestConvex<typeof schema>,
    ipaSource: string | undefined,
  ) {
    const textId = await seedCard(t, {
      sourceLanguage: 'en',
      translations: [{ language: 'de' }],
    });
    await t.run(async (ctx) => ctx.db.patch(textId, { ipaSource }));
    return textId;
  }

  it('reports missing content for IPA tagged with a retired engine', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedWithIpaSource(t, 'espeak-ng-emscripten-0.3.5-v1');
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['de'])).toBe(true);
  });

  it('reports complete once the row carries the current tag', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedWithIpaSource(t, getIpaSource('en'));
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['de'])).toBe(
      false,
    );
  });

  it('leaves an untagged legacy row alone', async () => {
    // Nothing to compare against, and treating it as stale would re-attempt
    // every legacy sentinel on every view.
    const t = convexTest(schema, modules);
    const textId = await seedWithIpaSource(t, undefined);
    expect(await hasMissingContent(t, textId, 'en', ['en'], ['de'])).toBe(
      false,
    );
  });
});
