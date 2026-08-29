/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import schema from '../../schema';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { buildCardSearchableText } from '../../lib/cardContent';

const modules = import.meta.glob('/convex/**/*.ts');

// The rebuild fan-out is DEBOUNCED (10s marker on the text row, see
// scheduleSearchableTextRebuild in convex/features/decks.ts), so the tests
// run under fake timers and drain via finishAllScheduledFunctions instead of
// yielding real 0ms macrotasks.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// The three late-content store mutations in convex/features/decks.ts schedule
// `rebuildSearchableTextForText` (0ms fan-out over cards.by_textId) whenever a
// translation or romanization lands AFTER a card was created. The review-time
// staleness check only compares language sets, so without this cards keep a
// stale search string until reviewed (or forever, for in-place content
// changes). These tests drive each funnel and assert the card's search string
// catches up without any review.

/** Run the debounced rebuild (and any pagination hops) to completion. */
async function drainScheduled(t: TestConvex<typeof schema>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function seedCourseCardText(
  t: TestConvex<typeof schema>,
  opts: {
    sourceText: string;
    sourceLanguage: string;
    baseLanguages: string[];
    targetLanguages: string[];
    translation?: { lang: string; text: string; romanizedText?: string };
    sourceRomanization?: string;
  },
) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: opts.baseLanguages,
      targetLanguages: opts.targetLanguages,
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
      ...(opts.sourceRomanization !== undefined
        ? { romanizedText: opts.sourceRomanization }
        : {}),
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
    // Stamp searchableText exactly as card creation would, from the content
    // present at this moment.
    const built = await buildCardSearchableText(ctx, textId, opts.sourceText, [
      ...opts.baseLanguages,
      ...opts.targetLanguages,
    ]);
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
      ...built,
    });
    return { courseId, deckId, textId, cardId };
  });
}

function getCard(t: TestConvex<typeof schema>, cardId: Id<'cards'>) {
  return t.run(async (ctx) => (await ctx.db.get(cardId))!);
}

describe('rebuildSearchableTextForText via storeTranslationAndScheduleTTS', () => {
  it('adds a translation that lands after card creation, without a review', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedCourseCardText(t, {
      sourceText: '你真的体贴',
      sourceLanguage: 'zh',
      baseLanguages: ['en'],
      targetLanguages: ['zh'],
    });
    const before = await getCard(t, cardId);
    expect(before.searchableText).not.toContain('considerate');
    expect(before.searchableTextLanguages).toEqual([]);

    // A real curated voice: every text here has a card, so `skipTts` no
    // longer short-circuits the TTS tail (cards always get audio) and the
    // enqueue resolves the voice's gender from the curated list. The pool is
    // module-mocked; nothing synthesizes.
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'en',
      translatedText: 'You are really considerate',
      voiceName: 'en-US-Chirp3-HD-Leda',
      skipTts: true,
    });
    await drainScheduled(t);

    const after = await getCard(t, cardId);
    expect(after.searchableText).toContain('considerate');
    expect(after.searchableTextLanguages).toEqual(['en']);
  });

  it('replaces the search string on a retranslation of existing content', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedCourseCardText(t, {
      sourceText: '你真的体贴',
      sourceLanguage: 'zh',
      baseLanguages: ['en'],
      targetLanguages: ['zh'],
      translation: { lang: 'en', text: 'You are really considerate' },
    });
    expect((await getCard(t, cardId)).searchableText).toContain('considerate');

    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'en',
      translatedText: 'You are truly thoughtful',
      voiceName: 'en-US-Chirp3-HD-Leda',
      replaceExisting: true,
      skipTts: true,
    });
    await drainScheduled(t);

    const after = await getCard(t, cardId);
    expect(after.searchableText).toContain('thoughtful');
    expect(after.searchableText).not.toContain('considerate');
  });

  it('adds a romanization filled into an existing translation row', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedCourseCardText(t, {
      sourceText: 'How are you',
      sourceLanguage: 'en',
      baseLanguages: ['en'],
      targetLanguages: ['zh'],
      translation: { lang: 'zh', text: '你好吗' },
    });
    expect((await getCard(t, cardId)).searchableText).not.toContain('nihaoma');

    // Same (textId, lang) arriving again with a romanization → fill-if-missing
    // branch patches the row and must trigger the rebuild.
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'zh',
      translatedText: '你好吗',
      voiceName: 'cmn-CN-Chirp3-HD-Leda',
      romanizedText: 'nihaoma',
      romanizationSource: 'pinyin',
      skipTts: true,
    });
    await drainScheduled(t);

    expect((await getCard(t, cardId)).searchableText).toContain('nihaoma');
  });
});

describe('rebuildSearchableTextForText via the romanization store mutations', () => {
  it('adds a late source romanization (storeSourceAnnotation)', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedCourseCardText(t, {
      sourceText: '你真的体贴',
      sourceLanguage: 'zh',
      baseLanguages: ['en'],
      targetLanguages: ['zh'],
      translation: { lang: 'en', text: 'You are really considerate' },
    });
    expect((await getCard(t, cardId)).searchableText).not.toContain('zhende');

    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'romanization',
      value: 'ni zhende titie',
      source: 'pinyin',
    });
    await drainScheduled(t);

    expect((await getCard(t, cardId)).searchableText).toContain('zhende');
  });

  it("does not rebuild for the empty-string 'tried, failed' sentinel", async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedCourseCardText(t, {
      sourceText: '你真的体贴',
      sourceLanguage: 'zh',
      baseLanguages: ['en'],
      targetLanguages: ['zh'],
    });
    const before = await getCard(t, cardId);

    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'romanization',
      value: '',
      source: 'pinyin',
    });
    await drainScheduled(t);

    expect((await getCard(t, cardId)).searchableText).toBe(
      before.searchableText,
    );
  });

  it('adds a late translation romanization (storeTranslationAnnotation)', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedCourseCardText(t, {
      sourceText: 'How are you',
      sourceLanguage: 'en',
      baseLanguages: ['en'],
      targetLanguages: ['zh'],
      translation: { lang: 'zh', text: '你好吗' },
    });
    expect((await getCard(t, cardId)).searchableText).not.toContain('nihaoma');

    await t.mutation(internal.features.decks.storeTranslationAnnotation, {
      textId,
      language: 'zh',
      kind: 'romanization',
      value: 'nihaoma',
      source: 'pinyin',
    });
    await drainScheduled(t);

    expect((await getCard(t, cardId)).searchableText).toContain('nihaoma');
  });
});

describe('scheduleSearchableTextRebuild: per-text debounce', () => {
  it('coalesces a burst of stores into one pending rebuild that sees all content', async () => {
    const t = convexTest(schema, modules);
    const { textId, cardId } = await seedCourseCardText(t, {
      sourceText: '你真的体贴',
      sourceLanguage: 'zh',
      baseLanguages: ['en'],
      targetLanguages: ['zh'],
    });

    // First store arms the debounce marker on the text row…
    await t.mutation(internal.features.decks.storeTranslationAndScheduleTTS, {
      textId,
      targetLanguage: 'en',
      translatedText: 'You are really considerate',
      voiceName: 'en-US-Chirp3-HD-Leda',
      skipTts: true,
    });
    const marker1 = (await t.run(async (ctx) => (await ctx.db.get(textId))!))
      .searchableRebuildScheduledAt;
    expect(marker1).toBeDefined();

    // …and a second store inside the window piggybacks on it (same marker,
    // no second schedule) instead of fanning out its own full rebuild.
    await t.mutation(internal.features.decks.storeSourceAnnotation, {
      textId,
      kind: 'romanization',
      value: 'ni zhende titie',
      source: 'pinyin',
    });
    const marker2 = (await t.run(async (ctx) => (await ctx.db.get(textId))!))
      .searchableRebuildScheduledAt;
    expect(marker2).toBe(marker1);

    // The single deferred rebuild reads content at run time, so it picks up
    // BOTH writes of the burst; it also releases the marker.
    await drainScheduled(t);
    const after = await getCard(t, cardId);
    expect(after.searchableText).toContain('considerate');
    expect(after.searchableText).toContain('zhende');
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.searchableRebuildScheduledAt).toBeUndefined();
  });
});
