/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import {
  dropRenderingCutoverAudioPointerOne,
  dropRenderingCutoverTranslationOne,
  isOldVocabularyKey,
} from '../../migrations';
import { insertAudioFixture } from '../lib/audioFixtures';

const modules = import.meta.glob('/convex/**/*.ts');

// The migrateOne logic runs directly against a convex-test db, like the
// other migration suites (the migrations component is not registered).

async function seedText(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 0,
    });
    return ctx.db.insert('texts', {
      text: 'Are you coming?',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
  });
}

function insertRow(
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  fields: { variantKey?: string; renderedGender?: string },
) {
  return t.run((ctx) =>
    ctx.db.insert('translations', {
      textId,
      targetLanguage: 'de',
      translatedText: 'Kommst du?',
      ...fields,
    }),
  );
}

describe('the rendering-keys cutover sweeps', () => {
  it('tells the old key vocabulary from the new one', () => {
    expect(isOldVocabularyKey('auto|v')).toBe(true);
    expect(isOldVocabularyKey('female|auto')).toBe(true);
    expect(isOldVocabularyKey('auto|auto')).toBe(true);
    expect(isOldVocabularyKey('female|v')).toBe(false);
    expect(isOldVocabularyKey('male|none')).toBe(false);
  });

  it('deletes an old-vocabulary row, keeps a new-vocabulary one and unsets the stamps on a legacy one', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const oldRow = await insertRow(t, textId, { variantKey: 'auto|v' });
    const newRow = await insertRow(t, textId, {
      variantKey: 'female|v',
      renderedGender: 'female',
    });
    const legacyRow = await insertRow(t, textId, { renderedGender: 'female' });
    const untouched = await insertRow(t, textId, {});

    const patches = await t.run(async (ctx) => {
      const result: Record<string, unknown> = {};
      for (const [name, id] of [
        ['old', oldRow],
        ['new', newRow],
        ['legacy', legacyRow],
        ['untouched', untouched],
      ] as const) {
        const doc = (await ctx.db.get(id))!;
        const patch = await dropRenderingCutoverTranslationOne(ctx, doc);
        if (patch) await ctx.db.patch(id, patch);
        result[name] = patch;
      }
      return result;
    });

    expect(await t.run((ctx) => ctx.db.get(oldRow))).toBeNull();
    expect(patches.old).toBeUndefined();
    // A row keyed in the new vocabulary keeps its key; its stray stamp goes.
    expect(patches.new).toEqual({ renderedGender: undefined });
    expect(await t.run((ctx) => ctx.db.get(newRow))).toMatchObject({
      variantKey: 'female|v',
    });
    expect(patches.legacy).toEqual({ renderedGender: undefined });
    expect(
      (await t.run((ctx) => ctx.db.get(legacyRow)))!.renderedGender,
    ).toBeUndefined();
    expect(patches.untouched).toBeUndefined();
  });

  it('detaches an old-vocabulary pointer and keeps its asset; a new-vocabulary pointer stays', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const { oldPointer, newPointer, assetId } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array([1])]),
      );
      const { rowId: oldPointer, assetId } = await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        storageId,
        variantKey: 'female|auto',
      });
      const { rowId: newPointer } = await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        storageId,
        assetId,
        variantKey: 'female|v',
      });
      return { oldPointer, newPointer, assetId };
    });

    await t.run(async (ctx) => {
      for (const id of [oldPointer, newPointer]) {
        await dropRenderingCutoverAudioPointerOne(ctx, (await ctx.db.get(id))!);
      }
    });

    expect(await t.run((ctx) => ctx.db.get(oldPointer))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(newPointer))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(assetId))).not.toBeNull();
  });
});
