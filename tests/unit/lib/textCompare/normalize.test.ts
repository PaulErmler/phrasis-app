import { describe, it, expect } from 'vitest';
import { normalize, normalizeForComparison } from '@/lib/textCompare/normalize';

describe('normalize', () => {
  it('collapses whitespace by default', () => {
    expect(normalize('  hello   world  ')).toBe('hello world');
  });

  describe('apostrophe folding (always on)', () => {
    it('folds curly quotes and accents onto the ASCII apostrophe', () => {
      expect(normalize('don’t l‘eau it`s café´s')).toBe(
        "don't l'eau it's café's",
      );
    });

    it('folds the Uzbek modifier letters so typed answers can match', () => {
      // Stored text carries ʻ (U+02BB) / ʼ (U+02BC); keyboards only have '.
      expect(normalize('Oʻzbek taʼkid')).toBe(normalize("O'zbek ta'kid"));
    });

    it('treats the folded modifier letters as punctuation when ignoring it', () => {
      expect(normalize('oʻzbek', { ignorePunctuation: true })).toBe('ozbek');
      expect(normalize("o'zbek", { ignorePunctuation: true })).toBe('ozbek');
    });

    it('applies to the equality normalizer too', () => {
      expect(normalizeForComparison('Oʻzbek tili goʻzal.')).toBe(
        normalizeForComparison("o'zbek tili go'zal"),
      );
    });
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
    expect(normalize('ÉLÈVE', { foldCase: true, foldDiacritics: true })).toBe(
      'eleve',
    );
  });

  it('handles empty strings', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
  });

  describe('ignorePunctuation', () => {
    it('keeps punctuation by default', () => {
      expect(normalize('Hello, world!')).toBe('Hello, world!');
    });

    it('strips ASCII punctuation when requested', () => {
      expect(normalize('Hello, world!', { ignorePunctuation: true })).toBe(
        'Hello world',
      );
    });

    it('strips CJK punctuation', () => {
      // 。(U+3002) and 、(U+3001) are Unicode category Po, same as ASCII marks.
      expect(normalize('今日は暑いですね。', { ignorePunctuation: true })).toBe(
        '今日は暑いですね',
      );
      expect(normalize('はい、そうです。', { ignorePunctuation: true })).toBe(
        'はい、そうです。'.replace(/[、。]/g, ''),
      );
    });

    it('strips full-width and inverted marks', () => {
      expect(normalize('本当に？', { ignorePunctuation: true })).toBe('本当に');
      expect(normalize('¿Cómo estás?', { ignorePunctuation: true })).toBe(
        'Cómo estás',
      );
    });

    it('strips apostrophes inside words', () => {
      expect(normalize("don't", { ignorePunctuation: true })).toBe('dont');
      expect(normalize("l'eau", { ignorePunctuation: true })).toBe('leau');
    });

    it('leaves no stray whitespace behind', () => {
      expect(normalize('Well , yes .', { ignorePunctuation: true })).toBe(
        'Well yes',
      );
    });

    it('does not strip currency or math symbols', () => {
      // \p{S}, not \p{P}. Meaningful content, so it stays.
      expect(normalize('$5 + 3 = 8', { ignorePunctuation: true })).toBe(
        '$5 + 3 = 8',
      );
    });
  });

  it('applies NFC normalization', () => {
    // "é" as decomposed (e + combining acute) should be recomposed
    const decomposed = 'e\u0301';
    const result = normalize(decomposed);
    expect(result).toBe('é');
    expect(result.length).toBe(1);
  });
});
