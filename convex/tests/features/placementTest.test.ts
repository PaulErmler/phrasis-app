/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

const modules = import.meta.glob('/convex/**/*.ts');

async function seedPlacementSentence(
  t: TestConvex<typeof schema>,
  opts: {
    level: number;
    position: number;
    text: string;
    targetLanguage?: string;
    targetText?: string;
  },
): Promise<{ textId: Id<'texts'> }> {
  return t.run(async (ctx) => {
    let poolId = (
      await ctx.db
        .query('collections')
        .withIndex('by_name', (q) => q.eq('name', 'placement-test-pool'))
        .first()
    )?._id;
    if (!poolId) {
      poolId = await ctx.db.insert('collections', {
        name: 'placement-test-pool',
        textCount: 0,
        origin: 'premade',
      });
    }
    const textId = await ctx.db.insert('texts', {
      text: opts.text,
      language: 'en',
      userCreated: false,
      collectionId: poolId,
      collectionRank: opts.level * 100 + opts.position,
    });
    await ctx.db.insert('placementTestSentences', {
      level: opts.level,
      position: opts.position,
      textId,
    });
    if (opts.targetLanguage && opts.targetText) {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: opts.targetLanguage,
        translatedText: opts.targetText,
      });
    }
    return { textId };
  });
}

describe('getPlacementSentence', () => {
  it('returns null when no sentence exists at (level, position)', async () => {
    const t = convexTest(schema, modules);
    const res = await t.query(api.features.placementTest.getPlacementSentence, {
      level: 5,
      position: 0,
      targetLanguage: 'es',
      sourceLanguage: 'en',
    });
    expect(res).toBeNull();
  });

  it('returns the source text + translation when both exist', async () => {
    const t = convexTest(schema, modules);
    await seedPlacementSentence(t, {
      level: 3,
      position: 1,
      text: 'I have a cat.',
      targetLanguage: 'es',
      targetText: 'Tengo un gato.',
    });

    const res = await t.query(api.features.placementTest.getPlacementSentence, {
      level: 3,
      position: 1,
      targetLanguage: 'es',
      sourceLanguage: 'en',
    });
    expect(res).not.toBeNull();
    expect(res!.sourceText).toBe('I have a cat.');
    expect(res!.sourceLanguage).toBe('en');
    expect(res!.targetText).toBe('Tengo un gato.');
    expect(res!.level).toBe(3);
    expect(res!.position).toBe(1);
  });

  it('returns the source text alone when no translation exists for the target language', async () => {
    const t = convexTest(schema, modules);
    await seedPlacementSentence(t, {
      level: 3,
      position: 1,
      text: 'I have a cat.',
    });

    const res = await t.query(api.features.placementTest.getPlacementSentence, {
      level: 3,
      position: 1,
      targetLanguage: 'fr',
      sourceLanguage: 'en',
    });
    expect(res).not.toBeNull();
    expect(res!.sourceText).toBe('I have a cat.');
    expect(res!.targetText).toBeUndefined();
  });

  it("renders the source side in the user's base language when its translation exists", async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedPlacementSentence(t, {
      level: 3,
      position: 1,
      text: 'I have a cat.',
      targetLanguage: 'fr',
      targetText: "J'ai un chat.",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'es',
        translatedText: 'Tengo un gato.',
      });
    });

    const res = await t.query(api.features.placementTest.getPlacementSentence, {
      level: 3,
      position: 1,
      targetLanguage: 'fr',
      sourceLanguage: 'es',
    });
    expect(res).not.toBeNull();
    expect(res!.sourceText).toBe('Tengo un gato.');
    expect(res!.sourceLanguage).toBe('es');
    expect(res!.targetText).toBe("J'ai un chat.");
  });

  it("falls back to the English source when the base-language translation hasn't landed yet", async () => {
    const t = convexTest(schema, modules);
    await seedPlacementSentence(t, {
      level: 3,
      position: 1,
      text: 'I have a cat.',
      targetLanguage: 'fr',
      targetText: "J'ai un chat.",
    });

    const res = await t.query(api.features.placementTest.getPlacementSentence, {
      level: 3,
      position: 1,
      targetLanguage: 'fr',
      sourceLanguage: 'es',
    });
    expect(res).not.toBeNull();
    expect(res!.sourceText).toBe('I have a cat.');
    expect(res!.sourceLanguage).toBe('en');
    expect(res!.targetText).toBe("J'ai un chat.");
  });
});

describe('getPlacementPreviewSentences', () => {
  it('returns the whole corpus in one call with translations resolved', async () => {
    const t = convexTest(schema, modules);
    await seedPlacementSentence(t, {
      level: 1,
      position: 0,
      text: 'A',
      targetLanguage: 'es',
      targetText: 'A-es',
    });
    // No translation yet. Preview must still include the row.
    await seedPlacementSentence(t, { level: 1, position: 1, text: 'B' });
    await seedPlacementSentence(t, {
      level: 2,
      position: 0,
      text: 'C',
      targetLanguage: 'es',
      targetText: 'C-es',
    });

    const rows = await t.query(
      api.features.placementTest.getPlacementPreviewSentences,
      { targetLanguage: 'es', sourceLanguage: 'en' },
    );
    expect(rows).toHaveLength(3);
    const byKey = new Map(rows.map((r) => [`${r.level}-${r.position}`, r]));
    expect(byKey.get('1-0')).toMatchObject({
      sourceText: 'A',
      targetText: 'A-es',
    });
    expect(byKey.get('1-1')).toMatchObject({ sourceText: 'B' });
    expect(byKey.get('1-1')!.targetText).toBeUndefined();
    expect(byKey.get('2-0')).toMatchObject({
      sourceText: 'C',
      targetText: 'C-es',
    });
  });

  it('renders the source side in the base language when its translation exists, else falls back to English', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedPlacementSentence(t, {
      level: 3,
      position: 1,
      text: 'I have a cat.',
      targetLanguage: 'fr',
      targetText: "J'ai un chat.",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'es',
        translatedText: 'Tengo un gato.',
      });
    });
    await seedPlacementSentence(t, {
      level: 3,
      position: 2,
      text: 'Dogs bark.',
      targetLanguage: 'fr',
      targetText: 'Les chiens aboient.',
    });

    const rows = await t.query(
      api.features.placementTest.getPlacementPreviewSentences,
      { targetLanguage: 'fr', sourceLanguage: 'es' },
    );
    const byPos = new Map(rows.map((r) => [r.position, r]));
    expect(byPos.get(1)).toMatchObject({
      sourceText: 'Tengo un gato.',
      targetText: "J'ai un chat.",
    });
    // Base-language translation hasn't landed for this row → English fallback.
    expect(byPos.get(2)).toMatchObject({
      sourceText: 'Dogs bark.',
      targetText: 'Les chiens aboient.',
    });
  });
});
