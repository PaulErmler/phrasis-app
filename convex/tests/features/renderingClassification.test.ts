/// <reference types="vite/client" />
import { vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: '[]' })),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => () => ({}),
}));

import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, beforeEach } from 'vitest';
import { generateText } from 'ai';
import schema from '../../schema';
import { internal } from '../../_generated/api';
import {
  flushRenderingStamps,
  needsRenderingStamp,
  newRenderingStampCollector,
} from '../../lib/contentScheduling';
import type { Id } from '../../_generated/dataModel';

const modules = import.meta.glob('/convex/**/*.ts');

async function seedText(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'premade',
      textCount: 1,
    });
    return ctx.db.insert('texts', {
      text: 'I am tired.',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
  });
}

async function seedTranslation(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  targetLanguage: string,
  translatedText: string,
  extra: Record<string, unknown> = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert('translations', {
      textId,
      targetLanguage,
      translatedText,
      ...extra,
    } as never),
  );
}

describe('features/renderingClassification', () => {
  let t: TestConvex<typeof schema>;
  beforeEach(() => {
    t = convexTest(schema, modules);
    vi.mocked(generateText).mockReset();
    process.env.OPENROUTER_API_KEY = 'test';
  });

  it('stamps the rows the model classified and leaves bad entries blank', async () => {
    const textId = await seedText(t);
    const ru1 = await seedTranslation(t, textId, 'ru', 'Я устала.');
    const ru2 = await seedTranslation(t, textId, 'ru', 'Ты идёшь?');
    const ru3 = await seedTranslation(t, textId, 'ru', 'Идёт дождь.');
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify([
        { i: 1, gender: 'feminine', politeness: 'unmarked' },
        { i: 2, gender: 'unmarked', politeness: 'casual' },
        { i: 3, gender: 'nonsense', politeness: 'unmarked' },
      ]),
      usage: { inputTokens: 10, outputTokens: 5 },
      providerMetadata: {},
    } as never);

    const written = await t.action(
      internal.features.renderingClassification.classifyAndStampTranslations,
      { translationIds: [ru1, ru2, ru3] },
    );
    expect(written).toBe(2);
    const rows = await t.run(async (ctx) =>
      Promise.all([ru1, ru2, ru3].map((id) => ctx.db.get(id))),
    );
    expect(rows[0]?.renderedGender).toBe('feminine');
    expect(rows[0]?.renderedPoliteness).toBe('unmarked');
    expect(rows[1]?.renderedPoliteness).toBe('casual');
    expect(rows[2]?.renderedGender).toBeUndefined();
    // One call for the batch, with every sentence numbered in the prompt.
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateText).mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toContain('3. Идёт дождь.');
  });

  it('a stamp lands only on the wording it judged', async () => {
    // A call delayed by a backoff can land after a flag replaced the wording
    // and after the new wording's own call. The stamp names what it judged;
    // a row that has moved on keeps its (cleared) stamps for the sweep.
    const textId = await seedText(t);
    const ru = await seedTranslation(t, textId, 'ru', 'Я устала.');
    await t.run((ctx) => ctx.db.patch(ru, { translatedText: 'Я устал.' }));
    const written = await t.mutation(
      internal.features.renderingClassification.stampRenderings,
      {
        stamps: [
          {
            translationId: ru,
            renderedGender: 'feminine',
            renderedPoliteness: 'unmarked',
            translatedText: 'Я устала.',
          },
        ],
      },
    );
    expect(written).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(ru)))?.renderedGender).toBeUndefined();
  });

  it('skips stamped rows and languages that mark neither axis', async () => {
    const textId = await seedText(t);
    const stamped = await seedTranslation(t, textId, 'ru', 'Я устал.', {
      renderedGender: 'masculine',
      renderedPoliteness: 'unmarked',
    });
    const swedish = await seedTranslation(t, textId, 'sv', 'Jag är trött.');
    const written = await t.action(
      internal.features.renderingClassification.classifyAndStampTranslations,
      { translationIds: [stamped, swedish] },
    );
    expect(written).toBe(0);
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });

  it('forces the axis a language cannot mark to unmarked', async () => {
    const textId = await seedText(t);
    // Turkish marks politeness (sen / siz) and never the speaker's gender.
    const tr = await seedTranslation(t, textId, 'tr', 'Geliyor musunuz?');
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify([
        { i: 1, gender: 'feminine', politeness: 'polite' },
      ]),
      usage: { inputTokens: 10, outputTokens: 5 },
      providerMetadata: {},
    } as never);
    await t.action(
      internal.features.renderingClassification.classifyAndStampTranslations,
      { translationIds: [tr] },
    );
    const row = await t.run(async (ctx) => ctx.db.get(tr));
    expect(row?.renderedGender).toBe('unmarked');
    expect(row?.renderedPoliteness).toBe('polite');
  });
});

describe('flushRenderingStamps (lazy stamping from the content sweep)', () => {
  it('schedules one classifier call per language group, claims the rows, and skips stamped and unmarked rows', async () => {
    const t = convexTest(schema, modules);
    process.env.OPENROUTER_API_KEY = 'test';
    const textId = await seedText(t);
    await seedTranslation(t, textId, 'ru', 'Я устал.');
    await seedTranslation(t, textId, 'ru', 'Ты идёшь?');
    await seedTranslation(t, textId, 'ja', '疲れました。');
    await seedTranslation(t, textId, 'sv', 'Jag är trött.');
    await seedTranslation(t, textId, 'de', 'Kommst du?', {
      renderedGender: 'unmarked',
      renderedPoliteness: 'casual',
    });
    vi.mocked(generateText).mockReset();
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify([
        { i: 1, gender: 'masculine', politeness: 'unmarked' },
        { i: 2, gender: 'unmarked', politeness: 'casual' },
      ]),
      usage: { inputTokens: 10, outputTokens: 5 },
      providerMetadata: {},
    } as never);

    // What a sweep collects: every row that needs a stamp, by language;
    // flushed in the same transaction when asked (a Map cannot cross the
    // convex-test boundary).
    const collectAndMaybeFlush = (flush: boolean) =>
      t.run(async (ctx) => {
        const stamps = newRenderingStampCollector();
        for (const row of await ctx.db.query('translations').collect()) {
          if (!needsRenderingStamp(row)) continue;
          const list = stamps.get(row.targetLanguage) ?? [];
          list.push(row._id);
          stamps.set(row.targetLanguage, list);
        }
        const languages = [...stamps.keys()].sort();
        const scheduled = flush ? await flushRenderingStamps(ctx, stamps) : 0;
        return { languages, scheduled };
      });

    vi.useFakeTimers();
    try {
      const first = await collectAndMaybeFlush(true);
      // sv marks neither axis and de is already stamped.
      expect(first.languages).toEqual(['ja', 'ru']);
      expect(first.scheduled).toBe(3);
      // The claim lands in the flushing transaction: a sweep that runs
      // before the classifier answers finds nothing to ask for.
      expect((await collectAndMaybeFlush(false)).languages).toEqual([]);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    // ru (2 rows) and ja (1 row): two classifier calls.
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
    const rows = await t.run(async (ctx) =>
      ctx.db.query('translations').collect(),
    );
    const ru = rows.filter((r) => r.targetLanguage === 'ru');
    expect(ru.every((r) => r.renderedGender !== undefined)).toBe(true);
    expect(ru.every((r) => r.renderingStampRequestedAt !== undefined)).toBe(
      true,
    );
    expect(
      rows.find((r) => r.targetLanguage === 'sv')?.renderedGender,
    ).toBeUndefined();
  });

  it('asks again for a row the classifier left blank once the cooldown has passed', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    await seedTranslation(t, textId, 'ru', 'Я устал.');
    const row = await t.run(
      async (ctx) => (await ctx.db.query('translations').collect())[0],
    );
    expect(needsRenderingStamp(row)).toBe(true);
    expect(
      needsRenderingStamp({ ...row, renderingStampRequestedAt: Date.now() }),
    ).toBe(false);
    expect(
      needsRenderingStamp({
        ...row,
        renderingStampRequestedAt: Date.now() - 16 * 60 * 1000,
      }),
    ).toBe(true);
    // A variant row is stamped by its own store path, never by the sweep.
    expect(needsRenderingStamp({ ...row, variantKey: 'female|auto' })).toBe(
      false,
    );
  });
});
