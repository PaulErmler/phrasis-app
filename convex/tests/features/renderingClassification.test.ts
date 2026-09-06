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
    const de = await seedTranslation(t, textId, 'de', 'Kommen Sie?');
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify([{ i: 1, gender: 'feminine', politeness: 'formal' }]),
      usage: { inputTokens: 10, outputTokens: 5 },
      providerMetadata: {},
    } as never);
    await t.action(
      internal.features.renderingClassification.classifyAndStampTranslations,
      { translationIds: [de] },
    );
    const row = await t.run(async (ctx) => ctx.db.get(de));
    expect(row?.renderedGender).toBe('unmarked');
    expect(row?.renderedPoliteness).toBe('formal');
  });
});

describe('migrations/backfillRenderedForms', () => {
  it('schedules one classifier call per language group and skips stamped and unmarked rows', async () => {
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

    vi.useFakeTimers();
    try {
      await t.mutation(internal.migrations.backfillRenderedForms.run, {
        pageSize: 100,
        delayMs: 0,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    // ru (2 rows) and ja (1 row): two classifier calls; sv and the stamped
    // de row never reach the model.
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
    const rows = await t.run(async (ctx) =>
      ctx.db.query('translations').collect(),
    );
    const ru = rows.filter((r) => r.targetLanguage === 'ru');
    expect(ru.every((r) => r.renderedGender !== undefined)).toBe(true);
    expect(rows.find((r) => r.targetLanguage === 'sv')?.renderedGender).toBeUndefined();
  });
});
