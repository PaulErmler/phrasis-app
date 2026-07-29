import { describe, it, expect } from 'vitest';
import {
  computeAccuracy,
  computeAccuracyPair,
} from '@/lib/textCompare/accuracy';

describe('computeAccuracyPair', () => {
  it('matches two separate computeAccuracy calls on the word path', () => {
    const expected = 'Das Wetter ist heute schön.';
    const actual = 'Das Wetter ist heute schon';
    expect(computeAccuracyPair(expected, actual, 'de')).toEqual({
      withPunctuation: computeAccuracy(expected, actual, 'de', false),
      withoutPunctuation: computeAccuracy(expected, actual, 'de', true),
    });
  });

  it('matches two separate computeAccuracy calls on the character path', () => {
    const expected = '今日は暑いですね。';
    const actual = '今日は暑いですね';
    expect(computeAccuracyPair(expected, actual, 'ja')).toEqual({
      withPunctuation: computeAccuracy(expected, actual, 'ja', false),
      withoutPunctuation: computeAccuracy(expected, actual, 'ja', true),
    });
  });

  it('scores a punctuation-only miss as perfect only in the lenient variant', () => {
    const pair = computeAccuracyPair('It is hot today.', 'It is hot today', 'en');
    expect(pair.withoutPunctuation).toBe(100);
    expect(pair.withPunctuation).toBeLessThan(100);
  });

  it('credits an omitted in-word apostrophe only in the lenient variant', () => {
    // The reason the pair runs two alignments instead of re-scoring one:
    // `normalize` strips punctuation from INSIDE words, so `don't` becomes
    // `dont` under the lenient pass and the typed answer aligns as an exact
    // match. Re-scoring a single strict alignment would score this as a typo
    // in both variants and under-report the lenient number.
    const pair = computeAccuracyPair("I don't know.", 'I dont know', 'en');
    expect(pair.withoutPunctuation).toBe(100);
    expect(pair.withPunctuation).toBeLessThan(100);
  });

  it('is symmetric with a perfect answer', () => {
    const pair = computeAccuracyPair('It is hot today.', 'It is hot today.', 'en');
    expect(pair).toEqual({ withPunctuation: 100, withoutPunctuation: 100 });
  });
});
