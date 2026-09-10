/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import {
  collapseAudioPointerOne,
  collapseLiveRenderingsOne,
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
      audioSpeakerGender: 'male',
      collectionId,
      collectionRank: 1,
    });
  });
}

const insertRow = (
  t: TestConvex<typeof schema>,
  textId: Id<'texts'>,
  translatedText: string,
  variantKey?: string,
) =>
  t.run((ctx) =>
    ctx.db.insert('translations', {
      textId,
      targetLanguage: 'de',
      translatedText,
      ...(variantKey !== undefined ? { variantKey } : {}),
    }),
  );

/** Run the sweep over every row of the table, as the component would. */
async function sweepTranslations(t: TestConvex<typeof schema>) {
  await t.run(async (ctx) => {
    for (const doc of await ctx.db.query('translations').collect()) {
      const fresh = await ctx.db.get(doc._id);
      if (!fresh) continue;
      const patch = await collapseLiveRenderingsOne(ctx, fresh);
      if (patch) await ctx.db.patch(doc._id, patch);
    }
  });
}

async function liveRows(t: TestConvex<typeof schema>) {
  return t.run((ctx) =>
    ctx.db
      .query('translations')
      .filter((q) => q.eq(q.field('supersededAt'), undefined))
      .collect(),
  );
}

describe('collapseLiveRenderings', () => {
  it('keeps the unkeyed row and drops the keyed siblings', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const legacy = await insertRow(t, textId, 'Kommst du?');
    await insertRow(t, textId, 'Kommen Sie?', 'female|v');
    await insertRow(t, textId, 'Kommst du?', 'male|t');

    await sweepTranslations(t);

    const rows = await liveRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(legacy);
    // Production has only unkeyed rows, so it comes through untouched.
    expect(rows[0].variantKey).toBeUndefined();
  });

  it('keeps the oldest keyed row and drops the form from its key', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const first = await insertRow(t, textId, 'Kommst du?', 'male|t');
    await insertRow(t, textId, 'Kommen Sie?', 'male|v');
    await insertRow(t, textId, 'Kommen Sie?', 'female|v');

    await sweepTranslations(t);

    const rows = await liveRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(first);
    expect(rows[0].variantKey).toBe('male');
  });

  it('leaves a pair that already has one row alone, and is idempotent', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const only = await insertRow(t, textId, 'Kommst du?', 'male');

    await sweepTranslations(t);
    await sweepTranslations(t);

    const rows = await liveRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(only);
    expect(rows[0].variantKey).toBe('male');
  });

  it('never touches a superseded revision', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    await insertRow(t, textId, 'Kommst du?');
    const archived = await t.run((ctx) =>
      ctx.db.insert('translations', {
        textId,
        targetLanguage: 'de',
        translatedText: 'Kommst du denn?',
        variantKey: 'male|t',
        supersededAt: Date.now() - 1000,
      }),
    );

    await sweepTranslations(t);

    expect(await t.run((ctx) => ctx.db.get(archived))).not.toBeNull();
  });
});

describe('collapseAudioPointers', () => {
  it('keeps one pointer per (text, language) by the same rule', async () => {
    const t = convexTest(schema, modules);
    const textId = await seedText(t);
    const legacy = await t.run(async (ctx) => {
      const { rowId } = await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([1])])),
      });
      await insertAudioFixture(ctx, {
        textId,
        language: 'de',
        storageId: await ctx.storage.store(new Blob([new Uint8Array([2])])),
        variantKey: 'female|v',
      });
      return rowId;
    });

    await t.run(async (ctx) => {
      for (const doc of await ctx.db.query('audioRecordings').collect()) {
        const fresh = await ctx.db.get(doc._id);
        if (!fresh) continue;
        const patch = await collapseAudioPointerOne(ctx, fresh);
        if (patch) await ctx.db.patch(doc._id, patch);
      }
    });

    const pointers = await t.run((ctx) =>
      ctx.db.query('audioRecordings').collect(),
    );
    expect(pointers).toHaveLength(1);
    expect(pointers[0]._id).toBe(legacy);
    // The asset the dropped pointer named is kept: it is still correct
    // audio for its own string.
    expect(
      await t.run((ctx) => ctx.db.query('audioAssets').collect()),
    ).toHaveLength(2);
  });
});
