/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import { dedupeApostropheWordOne } from '../../migrations';

const modules = import.meta.glob('/convex/**/*.ts');

// The migrateOne logic runs directly against a convex-test db, like the
// other migration suites (the migrations component is not registered).

const USER = 'user_A';

async function seed(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    const courseId = await ctx.db.insert('courses', {
      userId: USER,
      baseLanguages: ['en'],
      targetLanguages: ['fr'],
    });
    const textIds: Id<'texts'>[] = [];
    for (const text of ["J'aime ça.", 'J’aime le pain.']) {
      textIds.push(
        await ctx.db.insert('texts', {
          text,
          language: 'fr',
          userCreated: false,
          collectionId,
          collectionRank: textIds.length + 1,
        }),
      );
    }
    await ctx.db.insert('languageStats', {
      userId: USER,
      courseId,
      language: 'fr',
      totalRepetitions: 2,
      totalNewCards: 2,
      totalTimeMs: 0,
      totalWords: 2,
    });
    return { courseId, textIds };
  });
}

async function wordRows(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) =>
    (await ctx.db.query('userWords').collect()).map((r) => ({
      word: r.word,
      displayWord: r.displayWord,
    })),
  );
}

describe('dedupeApostropheWordOne', () => {
  it('merges a curly-apostrophe row into the ASCII one: links move, the duplicate goes, totalWords drops', async () => {
    const t = convexTest(schema, modules);
    const { courseId, textIds } = await seed(t);
    const [asciiTextId, curlyTextId] = textIds;
    const curlyId = await t.run(async (ctx) => {
      await ctx.db.insert('userWords', {
        userId: USER,
        courseId,
        language: 'fr',
        word: "j'aime",
        displayWord: "J'aime",
      });
      await ctx.db.insert('userWordTexts', {
        userId: USER,
        courseId,
        language: 'fr',
        word: "j'aime",
        textId: asciiTextId!,
      });
      const id = await ctx.db.insert('userWords', {
        userId: USER,
        courseId,
        language: 'fr',
        word: 'j’aime',
        displayWord: 'j’aime',
      });
      await ctx.db.insert('userWordTexts', {
        userId: USER,
        courseId,
        language: 'fr',
        word: 'j’aime',
        textId: curlyTextId!,
      });
      return id;
    });

    // `t.run` serialises its result, so `undefined` travels as null.
    const patch = await t.run(
      async (ctx) =>
        (await dedupeApostropheWordOne(ctx, (await ctx.db.get(curlyId))!)) ??
        null,
    );
    expect(patch).toBeNull();

    // One row left, and it took the duplicate's lowercase display form.
    expect(await wordRows(t)).toEqual([
      { word: "j'aime", displayWord: "j'aime" },
    ]);
    const links = await t.run(async (ctx) =>
      (await ctx.db.query('userWordTexts').collect()).map((l) => ({
        word: l.word,
        textId: l.textId,
      })),
    );
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.word === "j'aime")).toBe(true);
    expect(new Set(links.map((l) => l.textId))).toEqual(
      new Set([asciiTextId, curlyTextId]),
    );
    const totalWords = await t.run(
      async (ctx) => (await ctx.db.query('languageStats').first())!.totalWords,
    );
    expect(totalWords).toBe(1);
  });

  it('re-keys a lone acute-accent row in place and leaves plain rows alone', async () => {
    const t = convexTest(schema, modules);
    const { courseId } = await seed(t);
    const [acuteId, plainId] = await t.run(async (ctx) => [
      await ctx.db.insert('userWords', {
        userId: USER,
        courseId,
        language: 'fr',
        word: 'j´aime',
        displayWord: 'J´aime',
      }),
      await ctx.db.insert('userWords', {
        userId: USER,
        courseId,
        language: 'fr',
        word: 'pain',
        displayWord: 'pain',
      }),
    ]);

    const [acutePatch, plainPatch] = await t.run(async (ctx) => [
      (await dedupeApostropheWordOne(ctx, (await ctx.db.get(acuteId))!)) ??
        null,
      (await dedupeApostropheWordOne(ctx, (await ctx.db.get(plainId))!)) ??
        null,
    ]);
    expect(acutePatch).toEqual({ word: "j'aime", displayWord: "J'aime" });
    expect(plainPatch).toBeNull();
    // Nothing was deleted and the count is untouched.
    expect(await wordRows(t)).toHaveLength(2);
    const totalWords = await t.run(
      async (ctx) => (await ctx.db.query('languageStats').first())!.totalWords,
    );
    expect(totalWords).toBe(2);
  });
});
