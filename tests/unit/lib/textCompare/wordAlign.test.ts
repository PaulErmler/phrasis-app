import { describe, it, expect } from 'vitest';
import { alignWords } from '@/lib/textCompare/wordAlign';

describe('alignWords', () => {
  it('returns all equal when strings match exactly', () => {
    const r = alignWords('the quick brown fox', 'the quick brown fox');
    expect(r.counts.equal).toBe(4);
    expect(r.counts.typo).toBe(0);
    expect(r.counts.wrong).toBe(0);
    expect(r.counts.missing).toBe(0);
    expect(r.counts.extra).toBe(0);
  });

  it('returns empty result for two empty strings', () => {
    const r = alignWords('', '');
    expect(r.words).toEqual([]);
    expect(r.counts).toEqual({
      equal: 0,
      typo: 0,
      wrong: 0,
      missing: 0,
      extra: 0,
    });
  });

  it('detects missing words in the actual output', () => {
    const r = alignWords('the quick brown fox', 'the brown fox');
    expect(r.counts.missing).toBe(1);
    expect(r.counts.equal).toBe(3);
    const missing = r.words.find((w) => w.tag === 'missing');
    expect(missing?.expected).toBe('quick');
  });

  it('detects extra words in the actual output', () => {
    const r = alignWords('the fox', 'the quick fox');
    expect(r.counts.extra).toBe(1);
    expect(r.counts.equal).toBe(2);
    const extra = r.words.find((w) => w.tag === 'extra');
    expect(extra?.actual).toBe('quick');
  });

  it('classifies small edit distance as typo, larger as wrong', () => {
    const typoResult = alignWords('beautiful', 'beutiful'); // missing one char
    expect(typoResult.counts.typo).toBe(1);

    const wrongResult = alignWords('cat', 'dog');
    expect(wrongResult.counts.wrong).toBe(1);
  });

  it('honours foldCase when comparing', () => {
    const strict = alignWords('Hello World', 'hello world');
    // without folding, "Hello" vs "hello" might still align as typo/equal depending on edit distance
    const lax = alignWords('Hello World', 'hello world', { foldCase: true });
    expect(lax.counts.equal).toBe(2);
    // Strict: one-char case difference counts as dist 1 on len 5 → typo threshold=1, so typo
    expect(strict.counts.typo + strict.counts.equal).toBe(2);
  });

  it('preserves raw surface forms in aligned output', () => {
    const r = alignWords('Hello World', 'Hello World');
    expect(r.words.map((w) => w.expected)).toEqual(['Hello', 'World']);
  });

  it('ignores pure punctuation differences', () => {
    const r = alignWords('hello, world!', 'hello world');
    expect(r.counts.equal).toBe(2);
    expect(r.counts.missing).toBe(0);
    expect(r.counts.extra).toBe(0);
  });
});
