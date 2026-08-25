/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../schema';
import { internal, api } from '../../_generated/api';
import { FURIGANA_SOURCES } from '../../lib/textAnnotations';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * Furigana pipeline tests against the STUBBED lindera tokenizer (see the
 * `lindera-wasm-nodejs-ipadic` mock in tests/convexTestSetup.ts: it returns a
 * canned IPADIC-shaped tokenization for 毎朝七時に起きます。 and a reading-less
 * token for everything else). Real-engine output is covered by the
 * node-environment suite (tests/node/lindera-furigana.test.ts). Here we care
 * about the plumbing: the fit/serialize pipeline, the '' sentinel, store
 * idempotence via the shared annotation mutations (already covered kind-
 * generically in ipa.test.ts), and the preview-path scheduling gate.
 */

const SENTENCE = '毎朝七時に起きます。';
const ANNOTATED = '毎朝[まいあさ]七[なな]時[じ]に起[お]きます。';

// Content scheduling fans out through 0ms scheduler hops; let them fire
// while the test context is alive (see drainScheduler docblock).
drainSchedulerAfterEach();

async function seedText(t: ReturnType<typeof convexTest>, language = 'ja') {
  return t.run(async (ctx) => {
    const collId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: SENTENCE,
      language,
      userCreated: false,
      collectionId: collId,
      collectionRank: 1,
    });
    return { collId, textId };
  });
}

describe('processFuriganaFor* actions (stubbed engine)', () => {
  it('source text: fits readings onto kanji runs and stores the bracket string', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);

    await t.action(internal.features.furigana.processFuriganaForSourceText, {
      textId,
      text: SENTENCE,
      language: 'ja',
    });
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.furiganaText).toBe(ANNOTATED);
    expect(text.furiganaSource).toBe(FURIGANA_SOURCES.linderaIpadic);
    // Furigana is not searchable content: no rebuild debounce marker armed.
    expect(text.searchableRebuildScheduledAt).toBeUndefined();
    // Sibling annotation pairs untouched.
    expect(text.romanizedText).toBeUndefined();
    expect(text.ipaText).toBeUndefined();
  });

  it('translation: stores the annotation on the translations row', async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t, 'en');
    await t.run(async (ctx) => {
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: SENTENCE,
      });
    });

    await t.action(internal.features.furigana.processFuriganaForTranslation, {
      textId,
      text: SENTENCE,
      language: 'ja',
    });
    const row = await t.run(
      async (ctx) =>
        (await ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', 'ja'),
          )
          .unique())!,
    );
    expect(row.furiganaText).toBe(ANNOTATED);
    expect(row.furiganaSource).toBe(FURIGANA_SOURCES.linderaIpadic);
  });

  it("persists the '' sentinel quietly for kana-only sentences", async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);

    // No kanji → nothing to annotate → furiganaForText returns '' directly
    // (no error path) and the action stores it as "done, empty".
    await t.action(internal.features.furigana.processFuriganaForSourceText, {
      textId,
      text: 'ひらがなだけ。',
      language: 'ja',
    });
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.furiganaText).toBe('');
    expect(text.furiganaSource).toBe(FURIGANA_SOURCES.linderaIpadic);
  });

  it("persists the '' sentinel when kanji exist but no reading fits", async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t);

    // Unknown to the stub → reading-less token despite the kanji → zero
    // annotations → furiganaForText throws → the action persists ''.
    await t.action(internal.features.furigana.processFuriganaForSourceText, {
      textId,
      text: '謎の漢字',
      language: 'ja',
    });
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.furiganaText).toBe('');
    expect(text.furiganaSource).toBe(FURIGANA_SOURCES.linderaIpadic);
  });

  it("persists the '' sentinel for a non-furigana language", async () => {
    const t = convexTest(schema, modules);
    const { textId } = await seedText(t, 'de');

    await t.action(internal.features.furigana.processFuriganaForSourceText, {
      textId,
      text: 'Guten Morgen',
      language: 'de',
    });
    const text = await t.run(async (ctx) => (await ctx.db.get(textId))!);
    expect(text.furiganaText).toBe('');
  });
});

describe('preview-path scheduling gate', () => {
  it('schedules furigana only for Japanese rows missing it', async () => {
    const t = convexTest(schema, modules);
    const { collId, textId } = await t.run(async (ctx) => {
      const collId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 1,
      });
      const courseId = await ctx.db.insert('courses', {
        userId: 'user_A',
        baseLanguages: ['en'],
        targetLanguages: ['ja'],
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
      });
      // Japanese translation with romanization already present, furigana
      // missing: the gate must schedule ONLY the missing kind.
      await ctx.db.insert('translations', {
        textId,
        targetLanguage: 'ja',
        translatedText: SENTENCE,
        romanizedText: 'maiasa shichiji ni okimasu.',
        romanizationSource: 'google-v3',
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
    // Translation 'ja': furigana scheduled, romanization NOT re-scheduled.
    const furiganaJobs = jobs.filter((j) =>
      j.name.includes('processFuriganaForTranslation'),
    );
    expect(furiganaJobs).toHaveLength(1);
    expect(furiganaJobs[0].args[0]).toMatchObject({
      textId,
      text: SENTENCE,
      language: 'ja',
    });
    expect(
      jobs.filter((j) => j.name.includes('processRomanizationForTranslation')),
    ).toHaveLength(0);
    // Source text 'en' never gets furigana.
    expect(
      jobs.filter((j) => j.name.includes('processFuriganaForSourceText')),
    ).toHaveLength(0);
  });
});

describe('approval-proposal furigana (entryFurigana)', () => {
  async function seedApproval(
    t: ReturnType<typeof convexTest>,
    translations: Array<{ language: string; text: string }>,
  ) {
    return t.run(async (ctx) =>
      ctx.db.insert('cardApprovals', {
        threadId: 'thread_1',
        messageId: 'm1',
        toolCallId: 'tc1',
        translations,
        userId: 'user_A',
        status: 'pending',
      }),
    );
  }

  it('computes and stores furigana for the ja entry only', async () => {
    const t = convexTest(schema, modules);
    const approvalId = await seedApproval(t, [
      { language: 'en', text: 'I get up at seven.' },
      { language: 'ja', text: SENTENCE },
    ]);

    await t.action(internal.features.furigana.processFuriganaForApproval, {
      approvalId,
      entries: [{ language: 'ja', text: SENTENCE }],
    });
    const approval = await t.run(
      async (ctx) => (await ctx.db.get(approvalId))!,
    );
    expect(approval.entryFurigana).toEqual({ ja: ANNOTATED });
  });

  it('drops results whose entry was edited while the action ran', async () => {
    const t = convexTest(schema, modules);
    const approvalId = await seedApproval(t, [
      { language: 'ja', text: '別の文になった。' },
    ]);

    // Result computed for the OLD wording arrives after the edit: rejected,
    // so a slow action can never overwrite a fresher proposal.
    await t.mutation(
      internal.features.chat.cardApprovals.storeApprovalEntryFurigana,
      {
        approvalId,
        results: [{ language: 'ja', forText: SENTENCE, furigana: ANNOTATED }],
      },
    );
    const approval = await t.run(
      async (ctx) => (await ctx.db.get(approvalId))!,
    );
    expect(approval.entryFurigana).toBeUndefined();
  });
});
