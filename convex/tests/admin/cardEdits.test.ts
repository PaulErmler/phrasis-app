/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi } from 'vitest';

// The direct handler import below pulls admin/lib → convex/auth, which
// requires SITE_URL at module scope; hoisted so it runs before that import.
vi.hoisted(() => {
  process.env.SITE_URL ??= 'http://localhost:3000';
});

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import {
  listCardEditsHandler,
  listRetranslationsHandler,
} from '../../admin/cardEdits';
import type { CardEditKind, RetranslationStatus } from '../../types';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * The admin QC read surface, exercised through the exported handlers: the
 * `adminQuery` wrapper needs a live Better Auth component the test harness
 * does not register, and the gate itself is structural (every function in
 * convex/admin/ is declared through it).
 */

const PAGE = { numItems: 10, cursor: null };

async function seedEdit(
  t: TestConvex<typeof schema>,
  opts: {
    kind?: CardEditKind;
    childStatuses?: RetranslationStatus[];
    userId?: string;
  } = {},
) {
  return t.run(async (ctx) => {
    const userId = opts.userId ?? 'user_A';
    const courseId = await ctx.db.insert('courses', {
      userId,
      baseLanguages: ['en'],
      targetLanguages: ['de'],
    });
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: 'd',
      cardCount: 1,
    });
    const collectionId = await ctx.db.insert('collections', {
      name: 'A1',
      textCount: 1,
    });
    const textId = await ctx.db.insert('texts', {
      text: 'Hi.',
      language: 'en',
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    const cardId = await ctx.db.insert('cards', {
      deckId,
      textId,
      dueDate: Date.now(),
      isMastered: false,
      isHidden: false,
      schedulingPhase: 'preReview',
      preReviewCount: 0,
    });
    const cardEditId = await ctx.db.insert('cardEdits', {
      userId,
      courseId,
      kind: opts.kind ?? 'manual_edit',
      path: 'in_place',
      cardIdBefore: cardId,
      cardIdAfter: cardId,
      textIdBefore: textId,
      textIdAfter: textId,
      textWasUserCreated: false,
      sourceLanguage: 'en',
      sourceText: 'Hi.',
      baseLanguages: ['en'],
      targetLanguages: ['de'],
      changes: [],
    });
    const childIds: Id<'cardEditRetranslations'>[] = [];
    for (const status of opts.childStatuses ?? []) {
      childIds.push(
        await ctx.db.insert('cardEditRetranslations', {
          cardEditId,
          userId,
          language: 'de',
          role: 'target',
          textId,
          sourceLanguage: 'en',
          sourceText: 'Hi.',
          beforeText: 'Hallo.',
          flagCountAfter: 1,
          status,
        }),
      );
    }
    return { cardEditId, childIds };
  });
}

const runEdits = (
  t: TestConvex<typeof schema>,
  args: Parameters<typeof listCardEditsHandler>[1],
) => t.run(async (ctx) => listCardEditsHandler(ctx as QueryCtx, args));
const runRetranslations = (
  t: TestConvex<typeof schema>,
  args: Parameters<typeof listRetranslationsHandler>[1],
) => t.run(async (ctx) => listRetranslationsHandler(ctx as QueryCtx, args));

describe('admin/cardEdits', () => {
  describe('listCardEdits', () => {
    it('pages newest first with each edit carrying its retranslations', async () => {
      const t = convexTest(schema, modules);
      const first = await seedEdit(t, { childStatuses: ['applied'] });
      const second = await seedEdit(t, { childStatuses: ['failed', 'enqueued'] });

      const result = await runEdits(t, { paginationOpts: PAGE });

      expect(result.page.map((e) => e._id)).toEqual([
        second.cardEditId,
        first.cardEditId,
      ]);
      expect(result.page[0].retranslations.map((r) => r.status).sort()).toEqual(
        ['enqueued', 'failed'],
      );
      expect(result.page[1].retranslations.map((r) => r.status)).toEqual([
        'applied',
      ]);
    });

    it('respects the page size and continues from the cursor', async () => {
      const t = convexTest(schema, modules);
      for (let i = 0; i < 3; i++) await seedEdit(t);

      const first = await runEdits(t, {
        paginationOpts: { numItems: 2, cursor: null },
      });
      expect(first.page).toHaveLength(2);
      expect(first.isDone).toBe(false);

      const rest = await runEdits(t, {
        paginationOpts: { numItems: 2, cursor: first.continueCursor },
      });
      expect(rest.page).toHaveLength(1);
      expect(rest.isDone).toBe(true);
    });

    it('filters by kind without shortening pages', async () => {
      const t = convexTest(schema, modules);
      await seedEdit(t, { kind: 'manual_edit' });
      const flag = await seedEdit(t, { kind: 'flag' });
      await seedEdit(t, { kind: 'chat_also_correct' });

      const result = await runEdits(t, { paginationOpts: PAGE, kind: 'flag' });
      expect(result.page.map((e) => e._id)).toEqual([flag.cardEditId]);
    });
  });

  describe('listRetranslations', () => {
    it('filters by status and carries parent kind plus source context', async () => {
      const t = convexTest(schema, modules);
      await seedEdit(t, { childStatuses: ['applied'] });
      const flagged = await seedEdit(t, {
        kind: 'flag',
        childStatuses: ['failed'],
      });

      const result = await runRetranslations(t, {
        paginationOpts: PAGE,
        status: 'failed',
      });
      expect(result.page).toHaveLength(1);
      expect(result.page[0]._id).toBe(flagged.childIds[0]);
      expect(result.page[0].kind).toBe('flag');
      expect(result.page[0].sourceText).toBe('Hi.');
      expect(result.page[0].userId).toBe('user_A');
    });

    it('keeps the row attributable after the parent edit was purged', async () => {
      // Regression: userId used to come from the (possibly deleted) parent,
      // so rows went anonymous during exactly the deletion-drain window the
      // denormalized child field exists for.
      const t = convexTest(schema, modules);
      const seeded = await seedEdit(t, {
        childStatuses: ['enqueued'],
        userId: 'user_gone',
      });
      await t.run(async (ctx) => ctx.db.delete(seeded.cardEditId));

      const result = await runRetranslations(t, { paginationOpts: PAGE });
      expect(result.page).toHaveLength(1);
      expect(result.page[0].userId).toBe('user_gone');
      expect(result.page[0].kind).toBeUndefined();
    });
  });

  describe('registration gate', () => {
    it('registers every wire-reachable function through adminQuery', async () => {
      // The suite above deliberately bypasses the admin gate by calling the
      // exported plain handlers (convex-test can't register the Better Auth
      // component), so nothing here would notice if a future refactor
      // re-wrapped a handler with plain `query` and exposed other users'
      // card edits to any signed-in caller. This pins the registration
      // itself: the module may only use adminQuery.
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(
        new URL('../../admin/cardEdits.ts', import.meta.url),
        'utf8',
      );
      expect(source).not.toMatch(/=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/);
      const registrations = source.match(/=\s*adminQuery\s*\(/g) ?? [];
      expect(registrations.length).toBeGreaterThanOrEqual(2);
    });
  });
});
