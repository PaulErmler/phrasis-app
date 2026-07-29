import { describe, it, expect } from 'vitest';
import {
  isAllLowercase,
  getWordSegmenter,
  tokenizeText,
} from '@/lib/wordTokenize';

const originals = (text: string, language: string) =>
  tokenizeText(text, language).map((t) => t.original);

describe('isAllLowercase', () => {
  it('is true when lowercasing is a no-op', () => {
    expect(isAllLowercase('the')).toBe(true);
    expect(isAllLowercase('The')).toBe(false);
    expect(isAllLowercase('123')).toBe(true);
    expect(isAllLowercase('')).toBe(true);
  });
});

describe('getWordSegmenter', () => {
  it('normalizes underscore tags to BCP-47 hyphens instead of throwing', () => {
    expect(() => getWordSegmenter('es_latam')).not.toThrow();
  });

  it('caches the segmenter per normalized tag', () => {
    expect(getWordSegmenter('pt_br')).toBe(getWordSegmenter('pt-br'));
  });
});

describe('tokenizeText — space-delimited language (en)', () => {
  it('folds punctuation away, keeping apostrophe words intact', () => {
    expect(originals("Hello, world! Don't stop — it's fine.", 'en')).toEqual([
      'Hello',
      'world',
      "Don't",
      'stop',
      "it's",
      'fine',
    ]);
  });

  it('splits hyphenated compounds at the hyphen', () => {
    expect(originals('a well-known fact', 'en')).toEqual([
      'a',
      'well',
      'known',
      'fact',
    ]);
  });

  it('keeps numbers as word-like tokens', () => {
    expect(originals('The answer is 42.', 'en')).toEqual([
      'The',
      'answer',
      'is',
      '42',
    ]);
  });

  it('lowercases into `normalized` while preserving `original`', () => {
    expect(tokenizeText('The THE the', 'en')).toEqual([
      { original: 'The', normalized: 'the' },
      { original: 'THE', normalized: 'the' },
      { original: 'the', normalized: 'the' },
    ]);
  });

  it('NFC-composes decomposed input in both original and normalized', () => {
    expect(tokenizeText('Cafe\u0301 time', 'en')).toEqual([
      { original: 'Café', normalized: 'café' },
      { original: 'time', normalized: 'time' },
    ]);
  });

  it('returns no tokens for punctuation-only or empty input', () => {
    expect(tokenizeText('...!?', 'en')).toEqual([]);
    expect(tokenizeText('', 'en')).toEqual([]);
  });
});

describe('tokenizeText — no-word-boundary language (ja)', () => {
  it('segments by dictionary and drops the 。', () => {
    expect(originals('今日は暑いですね。', 'ja')).toEqual([
      '今日',
      'は',
      '暑い',
      'です',
      'ね',
    ]);
  });

  it('segments a longer sentence including particles and inflections', () => {
    expect(originals('私は日本語を勉強しています。', 'ja')).toEqual([
      '私',
      'は',
      '日本語',
      'を',
      '勉強',
      'し',
      'てい',
      'ます',
    ]);
  });
});

describe('tokenizeText — invalid language tag fallback', () => {
  it('falls back to the Unicode-letter split instead of crashing', () => {
    // A structurally invalid BCP-47 tag makes Intl.Segmenter throw; the regex
    // fallback keeps hyphenated compounds as ONE token (unlike the segmenter).
    expect(originals("Hello, world! it's well-known.", 'not a lang')).toEqual([
      'Hello',
      'world',
      "it's",
      'well-known',
    ]);
  });
});
