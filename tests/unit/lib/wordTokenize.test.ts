import { describe, it, expect } from 'vitest';
import {
  isAllLowercase,
  getWordSegmenter,
  tokenizeText,
  appendSearchSegments,
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

  it('resolves registry compareLocale for codes whose hyphenated form is invalid BCP-47', () => {
    // "zh-traditional" / "yue-traditional" have an over-long variant subtag.
    // Intl.Segmenter throws RangeError on them, and the tokenizer fallback
    // would swallow a whole unspaced sentence as one token. The registry's
    // compareLocale (zh-TW / yue-Hant-HK) must be used instead.
    expect(() => getWordSegmenter('zh_traditional')).not.toThrow();
    expect(() => getWordSegmenter('yue_traditional')).not.toThrow();
  });
});

describe('tokenizeText: space-delimited language (en)', () => {
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

  it('folds every apostrophe variant to ASCII so the spellings share one key', () => {
    const keys = (text: string, language: string) =>
      tokenizeText(text, language).map((t) => t.normalized);
    // U+2019 is a word character for the segmenter; U+00B4 is not and used
    // to split "J´aime" into "j" and "aime".
    expect(keys("J'aime", 'fr')).toEqual(["j'aime"]);
    expect(keys('J’aime', 'fr')).toEqual(["j'aime"]);
    expect(keys('J´aime', 'fr')).toEqual(["j'aime"]);
    expect(keys('l’homme', 'fr')).toEqual(keys("l'homme", 'fr'));
    expect(originals('J’aime', 'fr')).toEqual(["J'aime"]);
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

describe('tokenizeText: no-word-boundary language (ja)', () => {
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

describe('tokenizeText: Traditional-script codes (zh_traditional / yue_traditional)', () => {
  it('segments Traditional Chinese into words, not one sentence-token', () => {
    expect(originals('你真的體貼', 'zh_traditional')).toEqual([
      '你',
      '真的',
      '體貼',
    ]);
  });

  it('segments Traditional Cantonese into words', () => {
    expect(originals('你真的體貼', 'yue_traditional')).toEqual([
      '你',
      '真的',
      '體貼',
    ]);
  });
});

describe('appendSearchSegments', () => {
  it('appends segmented words for Chinese so mid-sentence words become tokens', () => {
    const out = appendSearchSegments('你真的体贴', 'zh');
    expect(out.startsWith('你真的体贴 ')).toBe(true);
    expect(out.split(' ')).toContain('体贴');
  });

  it('appends segmented words for Traditional Chinese and Cantonese', () => {
    // The changelog's CJK-search fix claims these languages work; without the
    // compareLocale resolution the "segments" were the whole sentence again
    // and an infix query like 體貼 matched nothing.
    expect(
      appendSearchSegments('你真的體貼', 'zh_traditional').split(' '),
    ).toContain('體貼');
    expect(
      appendSearchSegments('你真的體貼', 'yue_traditional').split(' '),
    ).toContain('體貼');
  });

  it('appends segmented words for Japanese', () => {
    // ICU segments 話して as 話+し+て; a query for 話して gets the same
    // segmentation on the query side, so the shared 話 token still matches.
    const words = appendSearchSegments('ゆっくり話して', 'ja').split(' ');
    expect(words).toContain('ゆっくり');
    expect(words).toContain('話');
  });

  it('appends segmented words for Thai', () => {
    const words = appendSearchSegments('พูดช้าๆหน่อย', 'th').split(' ');
    expect(words.length).toBeGreaterThan(1);
  });

  it('dedupes repeated segments', () => {
    const words = appendSearchSegments('体贴体贴', 'zh').split(' ');
    expect(words.filter((w) => w === '体贴')).toHaveLength(1);
  });

  it('returns space-delimited languages unchanged', () => {
    expect(appendSearchSegments('Hello, world!', 'en')).toBe('Hello, world!');
    expect(appendSearchSegments('¿Cómo estás?', 'es')).toBe('¿Cómo estás?');
    // Korean and Vietnamese use spaces, no segmentation either.
    expect(appendSearchSegments('안녕하세요 반갑습니다', 'ko')).toBe(
      '안녕하세요 반갑습니다',
    );
  });

  it('returns unknown language codes unchanged', () => {
    expect(appendSearchSegments('anything at all', 'zz_nope')).toBe(
      'anything at all',
    );
  });

  it('returns punctuation-only CJK input unchanged (no empty append)', () => {
    expect(appendSearchSegments('。、！', 'ja')).toBe('。、！');
  });
});

describe('tokenizeText: invalid language tag fallback', () => {
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
