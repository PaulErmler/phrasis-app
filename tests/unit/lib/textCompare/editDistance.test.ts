import { describe, it, expect } from 'vitest';
import { damerauLevenshtein } from '@/lib/textCompare/editDistance';

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('abc', 'abc')).toBe(0);
  });

  it('returns length when one side is empty', () => {
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', '')).toBe(3);
    expect(damerauLevenshtein('', '')).toBe(0);
  });

  it('counts single substitutions, insertions, deletions', () => {
    expect(damerauLevenshtein('cat', 'bat')).toBe(1); // substitution
    expect(damerauLevenshtein('cat', 'cats')).toBe(1); // insertion
    expect(damerauLevenshtein('cats', 'cat')).toBe(1); // deletion
  });

  it('counts adjacent transposition as a single edit', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
    expect(damerauLevenshtein('teh', 'the')).toBe(1);
  });

  it('accepts string[] (graphemes) as input', () => {
    expect(damerauLevenshtein(['a', 'b', 'c'], ['a', 'c', 'b'])).toBe(1);
  });

  it('handles longer diverging strings', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });
});
