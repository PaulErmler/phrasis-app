import { describe, it, expect } from 'vitest';
import { charDiff } from '@/lib/textCompare/charDiff';

describe('charDiff', () => {
  it('returns a single equal chunk and accuracy 1 for identical input', () => {
    const r = charDiff('hello', 'hello');
    expect(r.accuracy).toBe(1);
    expect(r.chunks).toEqual([{ kind: 'equal', text: 'hello' }]);
  });

  it('returns accuracy 1 when both strings are empty', () => {
    const r = charDiff('', '');
    expect(r.accuracy).toBe(1);
  });

  it('flags accuracy 0 when expected is empty but actual is not', () => {
    const r = charDiff('', 'xyz');
    expect(r.accuracy).toBe(0);
  });

  it('produces added/removed chunks for diverging input', () => {
    const r = charDiff('cat', 'bat');
    const kinds = r.chunks.map((c) => c.kind).sort();
    expect(kinds).toContain('added');
    expect(kinds).toContain('removed');
    expect(r.accuracy).toBeGreaterThan(0);
    expect(r.accuracy).toBeLessThan(1);
  });

  it('considers case/diacritics when folding is enabled', () => {
    const strict = charDiff('Café', 'cafe');
    const lax = charDiff('Café', 'cafe', {
      foldCase: true,
      foldDiacritics: true,
    });
    expect(lax.accuracy).toBe(1);
    expect(strict.accuracy).toBeLessThan(1);
  });

  it('preserves surface form in chunks (unfolded)', () => {
    const r = charDiff('Hello', 'hello', { foldCase: true });
    // Accuracy is 1 because folded they match, but chunks reflect the originals
    expect(r.accuracy).toBe(1);
    const joinedExpected = r.chunks
      .filter((c) => c.kind !== 'added')
      .map((c) => c.text)
      .join('');
    expect(joinedExpected).toBe('Hello');
  });
});
