import { describe, expect, it } from 'vitest';
import {
  fitReading,
  hasKanji,
  katakanaToHiragana,
  parseFurigana,
  serializeFurigana,
  splitFuriganaByRanges,
  type FuriganaSegment,
} from '@/lib/furigana';

/** Shorthand: fit + serialize, the exact pipeline the Node action runs. */
function annotate(surface: string, reading: string): string | null {
  const fitted = fitReading(surface, reading);
  return fitted === null ? null : serializeFurigana(fitted);
}

describe('katakanaToHiragana', () => {
  it('converts readings and leaves everything else alone', () => {
    expect(katakanaToHiragana('マイアサ')).toBe('まいあさ');
    expect(katakanaToHiragana('コーヒー')).toBe('こーひー');
    expect(katakanaToHiragana('ツヅケ')).toBe('つづけ');
    expect(katakanaToHiragana('毎朝 abc')).toBe('毎朝 abc');
  });
});

describe('hasKanji', () => {
  it('detects kanji and the iteration mark, not kana or latin', () => {
    expect(hasKanji('毎朝')).toBe(true);
    expect(hasKanji('人々')).toBe(true);
    expect(hasKanji('ひらがな')).toBe(false);
    expect(hasKanji('コーヒー')).toBe(false);
    expect(hasKanji('Hello')).toBe(false);
  });
});

describe('fitReading', () => {
  it('splits okurigana off a kanji stem', () => {
    expect(annotate('起きます', 'おきます')).toBe('起[お]きます');
    expect(annotate('乗っ', 'のっ')).toBe('乗[の]っ');
    expect(annotate('忙しかっ', 'いそがしかっ')).toBe('忙[いそが]しかっ');
  });

  it('anchors on kana in the middle of a word', () => {
    expect(annotate('話し合い', 'はなしあい')).toBe('話[はな]し合[あ]い');
    expect(annotate('見上げる', 'みあげる')).toBe('見上[みあ]げる');
  });

  it('keeps a kanji run as ONE ruby unit instead of guessing per character', () => {
    // The failure this exists to prevent: per-kanji splitting renders this as
    // 出[し]身[ゅっしん], whose second reading is not pronounceable Japanese.
    expect(annotate('出身', 'しゅっしん')).toBe('出身[しゅっしん]');
    expect(annotate('日本語', 'にほんご')).toBe('日本語[にほんご]');
    expect(annotate('彼女', 'かのじょ')).toBe('彼女[かのじょ]');
  });

  it('handles leading kana, iteration marks, and counter ヶ', () => {
    expect(annotate('お茶', 'おちゃ')).toBe('お茶[ちゃ]');
    expect(annotate('人々', 'ひとびと')).toBe('人々[ひとびと]');
    // ヶ reads as か here, so it must stay inside the ruby run.
    expect(annotate('ヶ月', 'かげつ')).toBe('ヶ月[かげつ]');
  });

  it('matches a katakana surface run against a hiragana reading', () => {
    expect(annotate('ビール瓶', 'びーるびん')).toBe('ビール瓶[びん]');
  });

  it('returns null rather than guessing when the reading cannot be aligned', () => {
    // A dictionary-form reading against a conjugated surface.
    expect(fitReading('続け', 'つづける')).toBeNull();
    // Okurigana that does not appear in the reading at all.
    expect(fitReading('起きます', 'おきた')).toBeNull();
    // Nothing to annotate.
    expect(fitReading('ひらがな', 'ひらがな')).toBeNull();
  });
});

describe('parseFurigana', () => {
  it('round-trips what fitReading produced', () => {
    const text = '毎朝七時に起きます。';
    const annotated = '毎朝[まいあさ]七時[しちじ]に起[お]きます。';
    const parsed = parseFurigana(annotated, text);
    expect(parsed).toEqual([
      { text: '毎朝', reading: 'まいあさ' },
      { text: '七時', reading: 'しちじ' },
      { text: 'に' },
      { text: '起', reading: 'お' },
      { text: 'きます。' },
    ]);
    expect(serializeFurigana(parsed!)).toBe(annotated);
  });

  it('rejects an annotation that no longer matches an edited sentence', () => {
    // The stale-annotation guard: the card was edited after the furigana was
    // generated, so rendering it would put kana over the wrong characters.
    expect(
      parseFurigana(
        '毎朝[まいあさ]七時[しちじ]に起[お]きます。',
        '毎晩十時に寝ます。',
      ),
    ).toBeNull();
  });

  it('leaves a literal bracket in the sentence alone', () => {
    // Body is not kana, so it is not a reading — and the text still matches.
    expect(parseFurigana('見[see]る', '見[see]る')).toEqual([
      { text: '見[see]る' },
    ]);
  });

  it('handles a sentence with no annotations at all', () => {
    expect(parseFurigana('ひらがなだけ。', 'ひらがなだけ。')).toEqual([
      { text: 'ひらがなだけ。' },
    ]);
  });
});

describe('splitFuriganaByRanges', () => {
  const segments: FuriganaSegment[] = [
    { text: '毎朝', reading: 'まいあさ' },
    { text: 'に' },
    { text: '起', reading: 'お' },
    { text: 'きます。' },
  ];

  it('cuts plain runs to the requested chunk lengths', () => {
    // 毎朝 / に / 起きます / 。
    expect(splitFuriganaByRanges(segments, [2, 1, 4, 1])).toEqual([
      [{ text: '毎朝', reading: 'まいあさ' }],
      [{ text: 'に' }],
      [{ text: '起', reading: 'お' }, { text: 'きます' }],
      [{ text: '。' }],
    ]);
  });

  it('never splits a ruby run across chunks, and skips the chunks it swallowed', () => {
    // A tokenizer that cuts 毎|朝 would otherwise orphan half a reading.
    expect(splitFuriganaByRanges(segments, [1, 1, 1, 5])).toEqual([
      [{ text: '毎朝', reading: 'まいあさ' }],
      [],
      [{ text: 'に' }],
      [{ text: '起', reading: 'お' }, { text: 'きます。' }],
    ]);
  });

  it('reconstructs the full text no matter how the chunks fall', () => {
    for (const lengths of [[8], [1, 7], [3, 3, 2], [2, 2, 2, 2]]) {
      const joined = splitFuriganaByRanges(segments, lengths)
        .flat()
        .map((seg) => seg.text)
        .join('');
      expect(joined).toBe('毎朝に起きます。');
    }
  });
});
