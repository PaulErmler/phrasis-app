import { describe, it, expect } from 'vitest';
import { segmentGraphemes, segmentWords } from '@/lib/textCompare/segment';

describe('segmentGraphemes', () => {
  it('splits ASCII into single chars', () => {
    expect(segmentGraphemes('abc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps combining marks with base char as one grapheme', () => {
    const result = segmentGraphemes('cafe\u0301'); // café with combining acute
    expect(result).toEqual(['c', 'a', 'f', 'e\u0301']);
  });

  it('handles empty string', () => {
    expect(segmentGraphemes('')).toEqual([]);
  });

  it('handles multi-byte emoji as single graphemes', () => {
    // A single emoji should be one grapheme cluster
    const result = segmentGraphemes('a😀b');
    expect(result.length).toBe(3);
    expect(result[1]).toBe('😀');
  });
});

describe('segmentWords', () => {
  it('marks word-like and non-word segments', () => {
    const tokens = segmentWords('hello world');
    const words = tokens.filter((t) => t.isWord).map((t) => t.text);
    expect(words).toEqual(['hello', 'world']);
  });

  it('returns empty array for empty input', () => {
    expect(segmentWords('')).toEqual([]);
  });

  it('includes punctuation as non-word tokens', () => {
    const tokens = segmentWords('hi, there!');
    const nonWord = tokens.filter((t) => !t.isWord);
    expect(nonWord.length).toBeGreaterThan(0);
  });
});
