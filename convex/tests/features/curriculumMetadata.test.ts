/// <reference types="vite/client" />
import { vi as vitestMock } from 'vitest';
// The lazy metadata request schedules the classifier action; keep it off
// the network (an empty verdict leaves the row unstamped, which is what a
// bad answer does in production too).
vitestMock.mock('ai', () => ({
  generateText: vitestMock.fn(async () => ({ text: '{}' })),
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
import {
  needsSentenceMetadata,
  newMetadataCallBudget,
  scheduleMissingContent,
} from '../../lib/contentScheduling';
import { audioPointer, liveTranslation } from '../../db/translationReads';
import { getTtsProviderForLanguage } from '../../../lib/languages';
import { CURRENT_SENTENCE_METADATA_SOURCE } from '../../../lib/sentenceMetadataSource';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * Curriculum sentence metadata as evidence (lib/sentenceMetadataSource.ts):
 * the sweep asks the classifier for a curriculum text it has not judged,
 * from the source alone and under a claim; a verdict stamps the source;
 * and once a definitive gender is on the text, the canonical clip is
 * re-voiced and a wording the rendering stamp proves wrong is regenerated
 * in place, once.
 */

// An English base also asks for the text's accent row (en_gb / en_au) by
// hash; these tests are about the ja/de rows, so those jobs are filtered
// out rather than counted.
const llmEnqueues = () =>
  vi
    .mocked(llmPool.enqueueAction)
    .mock.calls.map(
      (c) =>
        c[2] as {
          textId: Id<'texts'>;
          targetLanguage: string;
          replaceExisting?: boolean;
          translationReason?: string;
        },
    )
    .filter(
      (job) => job.targetLanguage !== 'en_gb' && job.targetLanguage !== 'en_au',
    );
const ttsEnqueues = () =>
  vi
    .mocked(ttsPool.enqueueAction)
    .mock.calls.map((c) => c[2] as { language: string; voiceGender: string });
beforeEach(() => {
  vi.mocked(llmPool.enqueueAction).mockClear();
  vi.mocked(ttsPool.enqueueAction).mockClear();
});

const pendingJobs = (t: TestConvex<typeof schema>, name: string) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect()).filter(
      (job) => job.name.includes(name) && job.state.kind === 'pending',
    ),
  );

/**
 * A premade English text with a Japanese and a German canonical row and
 * clips, voiced male (the coin flip). `metadata` puts the text at the
 * current classifier source with the given verdict.
 */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    userCreated?: boolean;
    metadata?: { speakerGender: 'male' | 'female' | 'neutral' };
    metadataRequestedAt?: number;
    jaGender?: 'masculine' | 'feminine' | 'unmarked' | 'none';
    /** The gender the ja row was generated under (default the coin flip). */
    jaRowSpeakerGender?: 'male' | 'female';
  } = {},
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
      speakerGender: opts.metadata?.speakerGender ?? 'male',
      audioSpeakerGender: 'male',
      addressesSomeone: false,
      ipaText: '',
      romanizedText: '',
      ...(opts.metadata
        ? { metadataSource: CURRENT_SENTENCE_METADATA_SOURCE }
        : {}),
      ...(opts.metadataRequestedAt !== undefined
        ? { metadataRequestedAt: opts.metadataRequestedAt }
        : {}),
    });
    const rows: Record<string, Id<'translations'>> = {};
    for (const [lang, text] of [
      ['ja', '僕たちは兄弟だ。'],
      ['de', 'Wir sind Brüder.'],
    ] as const) {
      const jaGender = opts.jaGender ?? 'masculine';
      const stamps: {
        renderedGender?: 'masculine' | 'feminine' | 'unmarked';
        renderedPoliteness?: 'casual' | 'unmarked';
      } = {};
      if (lang !== 'ja') {
        stamps.renderedGender = 'unmarked';
        stamps.renderedPoliteness = 'unmarked';
      } else if (jaGender !== 'none') {
        stamps.renderedGender = jaGender;
        stamps.renderedPoliteness = 'casual';
      }
      rows[lang] = await ctx.db.insert('translations', {
        textId,
        targetLanguage: lang,
        translatedText: text,
        romanizedText: '',
        ipaText: '',
        furiganaText: '',
        translationSource: 'openai/gpt-5.6-sol:floor-minimal',
        speakerGender:
          lang === 'ja' ? (opts.jaRowSpeakerGender ?? 'male') : 'male',
        translationVersion: 99,
        ...stamps,
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
      spokenText: 'We are brothers.',
    });
    return { textId, rows };
  });
}

const sweep = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  opts?: Parameters<typeof scheduleMissingContent>[5],
) =>
  t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    return scheduleMissingContent(
      ctx,
      textId,
      text,
      ['en'],
      ['ja', 'de'],
      opts,
    );
  });

describe('needsSentenceMetadata', () => {
  it('only an unclassified curriculum text outside the cooldown', () => {
    expect(needsSentenceMetadata({ userCreated: false })).toBe(true);
    expect(needsSentenceMetadata({ userCreated: true })).toBe(false);
    expect(
      needsSentenceMetadata({
        userCreated: false,
        metadataSource: CURRENT_SENTENCE_METADATA_SOURCE,
      }),
    ).toBe(false);
    expect(
      needsSentenceMetadata({
        userCreated: false,
        metadataSource: 'some-older-build-v0',
      }),
    ).toBe(true);
    expect(
      needsSentenceMetadata({
        userCreated: false,
        metadataRequestedAt: Date.now() - 60_000,
      }),
    ).toBe(false);
    expect(
      needsSentenceMetadata({
        userCreated: false,
        metadataRequestedAt: Date.now() - 20 * 60 * 1000,
      }),
    ).toBe(true);
  });
});

describe('the lazy metadata request', () => {
  it('asks the classifier for an unclassified curriculum text, from the source alone, under a claim', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await sweep(t, textId);
    const jobs = await pendingJobs(t, 'fetchSentenceMetadata');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({
      textId,
      translations: [{ language: 'en', text: 'We are brothers.' }],
      schedulePrepareCard: true,
    });
    const text = await t.run((ctx) => ctx.db.get(textId));
    expect(text?.metadataRequestedAt).toBeDefined();
    // The coin flip keeps serving meanwhile: nothing else was touched.
    expect(llmEnqueues()).toEqual([]);
    expect(ttsEnqueues()).toEqual([]);
  });

  it('does not ask again inside the cooldown, nor for a classified or user-written text', async () => {
    const t = convexTest(schema, modules);
    const { textId: inFlight } = await seed(t, {
      metadataRequestedAt: Date.now() - 1000,
    });
    const { textId: classified } = await seed(t, {
      metadata: { speakerGender: 'neutral' },
    });
    const { textId: own } = await seed(t, { userCreated: true });
    for (const id of [inFlight, classified, own]) await sweep(t, id);
    expect(await pendingJobs(t, 'fetchSentenceMetadata')).toHaveLength(0);
  });

  it('a many-text pass spends its call budget and stops asking', async () => {
    const t = convexTest(schema, modules);
    const { textId: first } = await seed(t);
    const { textId: second } = await seed(t);
    const budget = newMetadataCallBudget();
    budget.remaining = 1;
    await sweep(t, first, { metadataCalls: budget });
    await sweep(t, second, { metadataCalls: budget });
    const jobs = await pendingJobs(t, 'fetchSentenceMetadata');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({ textId: first });
    expect(budget.remaining).toBe(0);
  });
});

describe('the source stamp', () => {
  it('a verdict with a speaker gender stamps the current source; the unblock call and a partial patch do not', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, { metadataRequestedAt: Date.now() });
    const apply = (metadata: Record<string, unknown> | undefined) =>
      t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata,
          schedulePrepareCard: false,
          baseLanguages: ['en'],
          targetLanguages: ['ja', 'de'],
        },
      );
    await apply(undefined);
    expect(
      (await t.run((ctx) => ctx.db.get(textId)))?.metadataSource,
    ).toBeUndefined();
    await apply({ register: 'neutral' });
    expect(
      (await t.run((ctx) => ctx.db.get(textId)))?.metadataSource,
    ).toBeUndefined();
    await apply({ speakerGender: 'female', referentGender: 'neutral' });
    const text = await t.run((ctx) => ctx.db.get(textId));
    expect(text?.metadataSource).toBe(CURRENT_SENTENCE_METADATA_SOURCE);
    expect(text?.metadataRequestedAt).toBeUndefined();
    expect(text?.speakerGender).toBe('female');
    expect(text?.audioSpeakerGender).toBe('female');
    // No definitive referent: the coin flip stands in, as before.
    expect(['male', 'female']).toContain(text?.referentGender);
  });

  it('a definitive referent gender replaces the coin flip', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    await t.run((ctx) => ctx.db.patch(textId, { referentGender: 'male' }));
    await t.mutation(
      internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
      {
        textId,
        metadata: { speakerGender: 'neutral', referentGender: 'female' },
        schedulePrepareCard: false,
        baseLanguages: ['en'],
        targetLanguages: ['ja', 'de'],
      },
    );
    expect((await t.run((ctx) => ctx.db.get(textId)))?.referentGender).toBe(
      'female',
    );
  });

  it('the sweep keeps a classified neutral verdict instead of writing the coin flip over it', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, {
      metadata: { speakerGender: 'neutral' },
    });
    await sweep(t, textId);
    const text = await t.run((ctx) => ctx.db.get(textId));
    expect(text?.speakerGender).toBe('neutral');
    expect(text?.audioSpeakerGender).toBe('male');
  });
});

describe('what a definitive verdict regenerates', () => {
  it('re-voices the canonical clips and regenerates the row the stamp proves wrong, in place', async () => {
    const t = convexTest(schema, modules);
    const { textId, rows } = await seed(t, {
      metadata: { speakerGender: 'female' },
      jaGender: 'masculine',
    });
    // The verdict mirrored into the voice, as `applyTextMetadata` does.
    await t.run((ctx) =>
      ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
    );
    await sweep(t, textId);

    // The Japanese wording was written in the masculine under the coin
    // flip: one in-place regeneration, with its own reason.
    const regen = llmEnqueues();
    expect(regen.map((j) => j.targetLanguage)).toEqual(['ja']);
    expect(regen[0]).toMatchObject({
      replaceExisting: true,
      translationReason: 'metadata_correction',
    });
    // The row itself survives until the new wording lands.
    expect(await t.run((ctx) => ctx.db.get(rows.ja))).not.toBeNull();

    // The German clip and the source clip were in the wrong voice: dropped
    // (asset kept) and re-voiced. The Japanese clip waits for its wording.
    expect(await t.run((ctx) => audioPointer(ctx, textId, 'de'))).toBeNull();
    expect(
      ttsEnqueues()
        .filter((j) => j.voiceGender === 'female')
        .map((j) => j.language)
        .sort(),
    ).toEqual(['de', 'en']);
  });

  it('leaves an unmarked or unstamped row alone', async () => {
    const t = convexTest(schema, modules);
    for (const seedOpts of [
      { jaGender: 'unmarked' as const },
      { jaGender: 'none' as const },
    ]) {
      vi.mocked(llmPool.enqueueAction).mockClear();
      const { textId } = await seed(t, {
        metadata: { speakerGender: 'female' },
        ...seedOpts,
      });
      await t.run((ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
      );
      await sweep(t, textId);
      expect(llmEnqueues()).toEqual([]);
      expect(
        await t.run((ctx) => liveTranslation(ctx, textId, 'ja')),
      ).not.toBeNull();
    }
  });

  it('retries a row already generated under the verdict once, then stops', async () => {
    const t = convexTest(schema, modules);
    // Generated under the verdict (female) and STILL stamped masculine: the
    // model ignored `<speaker_gender>`, so a second sample is worth a call.
    const { textId, rows } = await seed(t, {
      metadata: { speakerGender: 'female' },
      jaGender: 'masculine',
      jaRowSpeakerGender: 'female',
    });
    await t.run((ctx) =>
      ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
    );

    await sweep(t, textId);
    expect(llmEnqueues()).toMatchObject([
      { targetLanguage: 'ja', translationReason: 'metadata_correction' },
    ]);
    expect(
      (await t.run((ctx) => ctx.db.get(rows.ja)))?.genderCorrectionAttempts,
    ).toBe(1);

    // The retry is spent. A wording the model will not change cannot put the
    // sweep in a loop, so the next pass asks for nothing. (Releasing the
    // claim the enqueue took, which would otherwise defer the pass on its
    // own and prove nothing about the counter.)
    vi.mocked(llmPool.enqueueAction).mockClear();
    await t.run(async (ctx) => {
      for (const claim of await ctx.db
        .query('llmTranslationClaims')
        .collect()) {
        await ctx.db.delete(claim._id);
      }
    });
    await sweep(t, textId);
    expect(llmEnqueues()).toEqual([]);
  });

  it('never touches a user-written text', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, {
      userCreated: true,
      metadata: { speakerGender: 'female' },
      jaGender: 'masculine',
    });
    await t.run((ctx) =>
      ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
    );
    await sweep(t, textId);
    expect(llmEnqueues()).toEqual([]);
  });
});
