import { describe, it, expect } from 'vitest';
import { normalize } from '@/lib/textCompare/normalize';

describe('normalize', () => {
  it('collapses whitespace by default', () => {
    expect(normalize('  hello   world  ')).toBe('hello world');
  });

  it('does not collapse whitespace when disabled', () => {
    expect(normalize('  a   b', { collapseWhitespace: false })).toBe('  a   b');
  });

  it('folds case when requested', () => {
    expect(normalize('HéLLo', { foldCase: true })).toBe('héllo');
  });

  it('folds diacritics when requested', () => {
    expect(normalize('café', { foldDiacritics: true })).toBe('cafe');
    expect(normalize('naïve résumé', { foldDiacritics: true })).toBe(
      'naive resume',
    );
  });

  it('can fold both case and diacritics together', () => {
    expect(
      normalize('ÉLÈVE', { foldCase: true, foldDiacritics: true }),
    ).toBe('eleve');
  });

  it('handles empty strings', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
  });

  it('applies NFC normalization', () => {
    // "é" as decomposed (e + combining acute) should be recomposed
    const decomposed = 'e\u0301';
    const result = normalize(decomposed);
    expect(result).toBe('é');
    expect(result.length).toBe(1);
  });
});
