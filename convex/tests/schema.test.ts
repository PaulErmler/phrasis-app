/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../schema';

const modules = import.meta.glob('/convex/**/*.ts');

describe('schema invariants', () => {
  it('rejects texts insert missing required collectionId', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        // @ts-expect-error intentionally missing collectionId/collectionRank
        return ctx.db.insert('texts', {
          text: 'hello',
          language: 'en',
          userCreated: false,
        });
      }),
    ).rejects.toThrow();
  });

  it('inserts a collection and looks it up by name', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.db.insert('collections', { name: 'A1', textCount: 0 }),
    );
    const found = await t.run(async (ctx) =>
      ctx.db
        .query('collections')
        .withIndex('by_name', (q) => q.eq('name', 'A1'))
        .unique(),
    );
    expect(found?._id).toEqual(id);
  });

  it('allows inserting a text with required fields', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const collId = await ctx.db.insert('collections', {
        name: 'Essential',
        textCount: 0,
      });
      return ctx.db.insert('texts', {
        text: 'hi',
        language: 'en',
        userCreated: true,
        collectionId: collId,
        collectionRank: 1,
      });
    });
    expect(id).toBeDefined();
  });

  it('rejects cards insert missing required fields', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        // @ts-expect-error intentional
        return ctx.db.insert('cards', { deckId: 'bogus' });
      }),
    ).rejects.toThrow();
  });
});
