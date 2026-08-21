/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import { rebuildCardSearchableTextPatch } from '../../migrations';

const modules = import.meta.glob('/convex/**/*.ts');

// No cache reset needed: the shared rebuild helper takes a per-invocation
// cache, so nothing leaks between tests (the old module-level cache and its
// test hook were removed with the decks.ts/migrations.ts dedup).

// The migrateOne logic is exercised directly against a convex-test db (the
// migrations component itself isn't registered with convex-test, same
// approach as the other migration suites, which test the extracted patch
// function).

type SeedOpts = {
  sourceText: string;
  sourceLanguage: string;
  baseLanguages?: string[];
  targetLanguages?: string[];
  translation?: { lang: string; text: string; romanizedText?: string };
  searchableText?: string;
  searchableTextLanguages?: string[];
};

async function seedCard(t: TestConvex<typeof schema>, opts: SeedOpts) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: opts.baseLanguages ?? ['en'],
      targetLanguages: opts.targetLanguages ?? ['zh'],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'deck',
      cardCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: opts.sourceText,
      language: opts.sourceLanguage,
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    if (opts.translation) {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: opts.translation.lang,
        translatedText: opts.translation.text,
        ...(opts.translation.romanizedText !== undefined
          ? { romanizedText: opts.translation.romanizedText }
          : {}),
      });
    }
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      collectionId,
      collectionOrigin: 'premade',
      dueDate: 0,
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
      searchableText: opts.searchableText,
      searchableTextLanguages: opts.searchableTextLanguages,
    });
    return { cardId, textId, deckId };
  });
}

async function runMigrateOne(
  t: TestConvex<typeof schema>,
  cardId: Awaited<ReturnType<typeof seedCard>>['cardId'],
) {
  return t.run(async (ctx) => {
    const card = (await ctx.db.get(cardId))!;
    return rebuildCardSearchableTextPatch(ctx, card);
  });
}

describe('rebuildCardSearchableText migrateOne', () => {
  it('segments an unsegmented CJK searchableText (the pre-fix format)', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedCard(t, {
      sourceText: '你真的体贴',
      sourceLanguage: 'zh',
      translation: { lang: 'en', text: 'You are really considerate' },
      searchableText: '你真的体贴 You are really considerate',
      searchableTextLanguages: ['en'],
    });
    const patch = await runMigrateOne(t, cardId);
    expect(patch).toBeDefined();
    expect(patch!.searchableText!.split(' ')).toContain('体贴');
    expect(patch!.searchableTextLanguages).toEqual(['en']);
  });

  it('heals a card missing a translation that landed after creation', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedCard(t, {
      sourceText: 'Hola',
      sourceLanguage: 'es',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
      translation: { lang: 'en', text: 'Hello' },
      // Built before the translation existed:
      searchableText: 'Hola',
      searchableTextLanguages: [],
    });
    const patch = await runMigrateOne(t, cardId);
    expect(patch).toBeDefined();
    expect(patch!.searchableText).toContain('Hello');
    expect(patch!.searchableTextLanguages).toEqual(['en']);
  });

  it('returns no patch for an already up-to-date card (idempotent)', async () => {
    const t = convexTest(schema, modules);
    const { cardId } = await seedCard(t, {
      sourceText: '你真的体贴',
      sourceLanguage: 'zh',
      translation: { lang: 'en', text: 'You are really considerate' },
    });
    // First pass rebuilds…
    const first = await runMigrateOne(t, cardId);
    expect(first).toBeDefined();
    await t.run(async (ctx) => {
      await ctx.db.patch(cardId, first!);
    });
    // …second pass is a no-op. (t.run serializes undefined to null.)
    expect(await runMigrateOne(t, cardId)).toBeNull();
  });

  it('skips cards whose deck or text no longer resolves', async () => {
    const t = convexTest(schema, modules);
    const { cardId, textId } = await seedCard(t, {
      sourceText: 'Hola',
      sourceLanguage: 'es',
      searchableText: 'stale',
      searchableTextLanguages: [],
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(textId);
    });
    expect(await runMigrateOne(t, cardId)).toBeNull();
  });
});
