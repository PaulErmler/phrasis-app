/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import schema from '../../schema';
import { ANNOTATION_REQUEST_COOLDOWN_MS } from '../../lib/textAnnotations';
import {
  claimHyperliteral,
  deleteHyperliteralsFor,
  getHyperliteral,
  getHyperliteralSource,
  hyperliteralNeedsWork,
  hyperliteralState,
  hyperliteralTextOf,
} from '../../lib/hyperliterals';
import type { Doc, Id } from '../../_generated/dataModel';

const modules = import.meta.glob('../../**/*.ts');

const row = (over: Partial<Doc<'hyperliterals'>> = {}): Doc<'hyperliterals'> =>
  ({
    _id: 'x' as Id<'hyperliterals'>,
    _creationTime: 0,
    language: 'ru',
    glossLanguage: 'en',
    forText: 'Я не знаю.',
    source: getHyperliteralSource('ru'),
    requestedAt: Date.now(),
    ...over,
  }) as Doc<'hyperliterals'>;

const expected = { language: 'ru', wording: 'Я не знаю.' };

describe('hyperliteralNeedsWork (the clock-free read-side predicate)', () => {
  it('is true with no row at all', () => {
    expect(hyperliteralNeedsWork(null, expected)).toBe(true);
  });

  it('is true while a claim has no text yet', () => {
    expect(hyperliteralNeedsWork(row(), expected)).toBe(true);
  });

  it('treats the failure sentinel as settled for the CURRENT engine', () => {
    // The engine already tried this exact sentence. Retrying on every view
    // would be a paid call that always fails.
    expect(hyperliteralNeedsWork(row({ text: '' }), expected)).toBe(false);
  });

  it('is true for a sentinel written by a RETIRED engine', () => {
    const old = row({ text: '', source: 'some-older-engine-v0' });
    expect(hyperliteralNeedsWork(old, expected)).toBe(true);
  });

  it('is true when the sentence has been reworded under it', () => {
    const moved = row({ text: 'I not know.', forText: 'Я знаю.' });
    expect(hyperliteralNeedsWork(moved, expected)).toBe(true);
  });

  it('reads no clock, so a Convex query may ask it', () => {
    // Guarding the guideline, not the value: a wall-clock read in a query
    // yields stale answers and costs query-cache reuse.
    const fixture = row();
    const spy = vi.spyOn(Date, 'now');
    hyperliteralNeedsWork(fixture, expected);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('hyperliteralState (the scheduling-side predicate)', () => {
  const now = 1_000_000;

  it('is missing with no row at all', () => {
    expect(hyperliteralState(null, expected, now)).toBe('missing');
  });

  it('is inFlight while a fresh claim has no text', () => {
    expect(hyperliteralState(row({ requestedAt: now }), expected, now)).toBe(
      'inFlight',
    );
  });

  it('retries a claim that outlived the cooldown, so an outage costs one call per window', () => {
    const stale = row({
      requestedAt: now - ANNOTATION_REQUEST_COOLDOWN_MS - 1,
    });
    expect(hyperliteralState(stale, expected, now)).toBe('missing');
  });

  it('is done for the failure sentinel of the current engine', () => {
    expect(hyperliteralState(row({ text: '' }), expected, now)).toBe('done');
  });

  it('is missing for a fresh claim written by a RETIRED engine', () => {
    const old = row({ requestedAt: now, source: 'some-older-engine-v0' });
    expect(hyperliteralState(old, expected, now)).toBe('missing');
  });
});

describe('hyperliteralTextOf', () => {
  it('shows a finished gloss', () => {
    expect(hyperliteralTextOf(row({ text: 'I not know.' }), expected)).toBe(
      'I not know.',
    );
  });

  it('shows nothing for the sentinel, an in-flight claim or a stale wording', () => {
    expect(hyperliteralTextOf(row({ text: '' }), expected)).toBeUndefined();
    expect(hyperliteralTextOf(row(), expected)).toBeUndefined();
    expect(
      hyperliteralTextOf(
        row({ text: 'I not know.', forText: 'other' }),
        expected,
      ),
    ).toBeUndefined();
  });
});

describe('claimHyperliteral', () => {
  const seed = async (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => {
      const collectionId = await ctx.db.insert('collections', {
        name: 'A1',
        textCount: 0,
      });
      return ctx.db.insert('texts', {
        text: 'Я не знаю.',
        language: 'ru',
        userCreated: false,
        collectionId,
        collectionRank: 0,
      });
    });

  it('claims once, and a second sweep finds nothing to do', async () => {
    const t = convexTest(schema, modules);
    const textId = await seed(t);
    const first = await t.run((ctx) =>
      claimHyperliteral(
        ctx,
        { textId },
        {
          language: 'ru',
          glossLanguage: 'en',
          wording: 'Я не знаю.',
        },
      ),
    );
    expect(first).not.toBeNull();
    const second = await t.run((ctx) =>
      claimHyperliteral(
        ctx,
        { textId },
        {
          language: 'ru',
          glossLanguage: 'en',
          wording: 'Я не знаю.',
        },
      ),
    );
    expect(second).toBeNull();
    const all = await t.run((ctx) => ctx.db.query('hyperliterals').collect());
    expect(all).toHaveLength(1);
  });

  it('keeps one row per gloss language, so German sits beside English', async () => {
    const t = convexTest(schema, modules);
    const textId = await seed(t);
    for (const glossLanguage of ['en', 'de']) {
      await t.run((ctx) =>
        claimHyperliteral(
          ctx,
          { textId },
          {
            language: 'ru',
            glossLanguage,
            wording: 'Я не знаю.',
          },
        ),
      );
    }
    const all = await t.run((ctx) => ctx.db.query('hyperliterals').collect());
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.glossLanguage).sort()).toEqual(['de', 'en']);
  });

  it('reuses the existing row when the engine is bumped', async () => {
    const t = convexTest(schema, modules);
    const textId = await seed(t);
    const id = await t.run(async (ctx) => {
      const created = await claimHyperliteral(
        ctx,
        { textId },
        {
          language: 'ru',
          glossLanguage: 'en',
          wording: 'Я не знаю.',
        },
      );
      await ctx.db.patch('hyperliterals', created!, {
        text: 'stale',
        source: 'older-engine-v0',
      });
      return created!;
    });
    const again = await t.run((ctx) =>
      claimHyperliteral(
        ctx,
        { textId },
        {
          language: 'ru',
          glossLanguage: 'en',
          wording: 'Я не знаю.',
        },
      ),
    );
    expect(again).toBe(id);
    const after = await t.run((ctx) => getHyperliteral(ctx, { textId }, 'en'));
    expect(after?.text).toBeUndefined();
    expect(after?.source).toBe(getHyperliteralSource('ru'));
  });

  it('deletes every gloss language when the sentence is edited', async () => {
    const t = convexTest(schema, modules);
    const textId = await seed(t);
    for (const glossLanguage of ['en', 'de']) {
      await t.run((ctx) =>
        claimHyperliteral(
          ctx,
          { textId },
          {
            language: 'ru',
            glossLanguage,
            wording: 'Я не знаю.',
          },
        ),
      );
    }
    await t.run((ctx) => deleteHyperliteralsFor(ctx, { textId }));
    const all = await t.run((ctx) => ctx.db.query('hyperliterals').collect());
    expect(all).toHaveLength(0);
  });
});
