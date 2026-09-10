/// <reference types="vite/client" />
import { vi as vitestMock } from 'vitest';
// The metadata request schedules the classifier action; keep it off the
// network (an empty verdict leaves the row unstamped, which is what a bad
// answer does in production too).
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
  ensureTextContent,
  MAX_METADATA_ATTEMPTS,
  metadataState,
} from '../../lib/contentScheduling';
import { audioPointer } from '../../db/translationReads';
import { getTtsProviderForLanguage } from '../../../lib/languages';
import { CURRENT_SENTENCE_METADATA_SOURCE } from '../../../lib/sentenceMetadataSource';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

drainSchedulerAfterEach();

/**
 * Curriculum sentence metadata as the precondition of a rendering key
 * (docs/architecture/rendering-keys.md): the sweep asks the classifier for
 * a curriculum text it has not judged, from the source alone and under a
 * claim, and waits for the verdict before it computes any key; a verdict
 * stamps the source; a text the classifier keeps failing on renders from
 * defaults after `MAX_METADATA_ATTEMPTS`.
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
          renderingKey: string;
          replaceExisting?: boolean;
          translationReason?: string;
        },
    )
    .filter(
      (job) => job.targetLanguage !== 'en_gb' && job.targetLanguage !== 'en_au',
    );
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
 * A premade English text with a Japanese and a German LEGACY row and clips,
 * voiced male (the coin flip). `metadata` puts the text at the current
 * classifier source with the given verdict.
 */
async function seed(
  t: TestConvex<typeof schema>,
  opts: {
    userCreated?: boolean;
    metadata?: { speakerGender: 'male' | 'female' | 'neutral' };
    metadataRequestedAt?: number;
    metadataAttempts?: number;
    keyedRows?: boolean;
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
      speakerGender: opts.metadata?.speakerGender ?? undefined,
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
      ...(opts.metadataAttempts !== undefined
        ? { metadataAttempts: opts.metadataAttempts }
        : {}),
    });
    const rows: Record<string, Id<'translations'>> = {};
    for (const [lang, text, key] of [
      ['ja', '僕たちは兄弟だ。', 'male'],
      ['de', 'Wir sind Brüder.', 'male'],
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
        ...(opts.keyedRows ? { variantKey: key } : {}),
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
        ...(opts.keyedRows ? { variantKey: key } : {}),
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
  opts?: Parameters<typeof ensureTextContent>[5],
) =>
  t.run(async (ctx) => {
    const text = (await ctx.db.get(textId))!;
    return ensureTextContent(ctx, textId, text, ['en'], ['ja', 'de'], opts);
  });

describe('metadataState', () => {
  it('current for a user text or the current source, else needed, in flight, or exhausted', () => {
    expect(metadataState({ userCreated: false })).toBe('needed');
    expect(metadataState({ userCreated: true })).toBe('current');
    expect(
      metadataState({
        userCreated: false,
        metadataSource: CURRENT_SENTENCE_METADATA_SOURCE,
      }),
    ).toBe('current');
    expect(
      metadataState({
        userCreated: false,
        metadataSource: 'some-older-build-v0',
      }),
    ).toBe('needed');
    expect(
      metadataState({
        userCreated: false,
        metadataRequestedAt: Date.now() - 60_000,
      }),
    ).toBe('in_flight');
    expect(
      metadataState({
        userCreated: false,
        metadataRequestedAt: Date.now() - 20 * 60 * 1000,
      }),
    ).toBe('needed');
    expect(
      metadataState({
        userCreated: false,
        metadataAttempts: MAX_METADATA_ATTEMPTS,
      }),
    ).toBe('exhausted');
  });
});

describe('the sweep no longer classifies up front', () => {
  it('leaves a complete text alone and never asks the classifier', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, { keyedRows: true });
    expect(await sweep(t, textId)).toEqual({
      translationsScheduled: 0,
      audioScheduled: 0,
    });
    expect(await pendingJobs(t, 'classifyCurriculumText')).toHaveLength(0);
    expect(llmEnqueues()).toEqual([]);
  });

  it('re-renders a row written for the other speaker, in the text’s voice', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, { keyedRows: true });
    await t.run((ctx) =>
      ctx.db.patch(textId, { audioSpeakerGender: 'female' }),
    );
    await sweep(t, textId);
    expect(await pendingJobs(t, 'classifyCurriculumText')).toHaveLength(0);
    expect(
      llmEnqueues().map((j) => [j.targetLanguage, j.renderingKey]),
    ).toEqual(
      expect.arrayContaining([
        ['ja', 'female'],
        ['de', 'female'],
      ]),
    );
  });
});

describe('the source stamp', () => {
  it('a verdict with a speaker gender stamps the current source; the unblock call and a partial patch do not', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, {
      metadataRequestedAt: Date.now(),
      metadataAttempts: 1,
    });
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
    expect(text?.metadataAttempts).toBeUndefined();
    expect(text?.speakerGender).toBe('female');
    expect(text?.audioSpeakerGender).toBe('female');
    // No definitive referent: the seeded flip stands in.
    expect(['male', 'female']).toContain(text?.referentGender);
  });

  it('a definitive referent gender replaces the flip, and the flip is seeded on the text', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const apply = (metadata: Record<string, unknown>) =>
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
    await apply({ speakerGender: 'neutral', referentGender: 'neutral' });
    const first = (await t.run((ctx) => ctx.db.get(textId)))?.referentGender;
    await t.run((ctx) => ctx.db.patch(textId, { referentGender: undefined }));
    await apply({ speakerGender: 'neutral', referentGender: 'neutral' });
    expect((await t.run((ctx) => ctx.db.get(textId)))?.referentGender).toBe(
      first,
    );
    await apply({ speakerGender: 'neutral', referentGender: 'female' });
    expect((await t.run((ctx) => ctx.db.get(textId)))?.referentGender).toBe(
      'female',
    );
  });

  it('the sweep keeps a classified neutral verdict and never writes the flip into speakerGender', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t, {
      metadata: { speakerGender: 'neutral' },
    });
    await sweep(t, textId);
    const text = await t.run((ctx) => ctx.db.get(textId));
    expect(text?.speakerGender).toBe('neutral');
    expect(text?.audioSpeakerGender).toBe('male');
  });

  it("the verdict's reschedule buys audio only when the text is somebody's card", async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seed(t);
    const apply = () =>
      t.mutation(
        internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
        {
          textId,
          metadata: { speakerGender: 'neutral' },
          schedulePrepareCard: true,
          baseLanguages: ['en'],
          targetLanguages: ['ja', 'de'],
        },
      );
    await apply();
    let jobs = await pendingJobs(t, 'prepareCardContent');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({ textId, skipTts: true });
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system
        .query('_scheduled_functions')
        .collect()) {
        await ctx.scheduler.cancel(job._id);
      }
      const courseId = await ctx.db.insert('courses', {
        userId: 'user_A',
        baseLanguages: ['en'],
        targetLanguages: ['ja'],
      });
      const deckId = await ctx.db.insert('decks', {
        courseId,
        name: 'deck',
        cardCount: 1,
      });
      await ctx.db.insert('cards', {
        deckId,
        textId,
        collectionOrigin: 'premade',
        dueDate: Date.now() - 1000,
        isMastered: false,
        isHidden: false,
        schedulingPhase: 'preReview',
        preReviewCount: 0,
      });
    });
    await apply();
    jobs = await pendingJobs(t, 'prepareCardContent');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({ textId, skipTts: false });
  });
});

describe('a user-written text follows the verdict', () => {
  it('re-keys its rows and detaches the clips of the old voice when the voice moves', async () => {
    const t = convexTest(schema, modules);
    const { textId, rows } = await seed(t, {
      userCreated: true,
      keyedRows: true,
    });
    await t.run((ctx) =>
      ctx.db.patch(textId, {
        speakerGender: undefined,
        metadataSource: undefined,
      }),
    );
    await t.mutation(
      internal.features.sentenceMetadata.applyMetadataAndPrepareCard,
      {
        textId,
        metadata: { speakerGender: 'female' },
        schedulePrepareCard: false,
        baseLanguages: ['en'],
        targetLanguages: ['ja', 'de'],
      },
    );
    const ja = await t.run((ctx) => ctx.db.get(rows.ja));
    expect(ja?.variantKey).toBe('female');
    expect(ja?.speakerGender).toBe('female');
    expect((await t.run((ctx) => ctx.db.get(rows.de)))?.variantKey).toBe(
      'female',
    );
    expect(await t.run((ctx) => audioPointer(ctx, textId, 'ja'))).toBeNull();
    // The clip's asset survives for the cache.
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query('audioAssets').collect()).length,
      ),
    ).toBe(3);
  });
});
