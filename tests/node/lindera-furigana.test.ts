import { describe, it, expect } from 'vitest';

import { furiganaForText } from '@/convex/features/furigana';
import { parseFurigana } from '@/lib/furigana';
import { FURIGANA_LANGUAGES } from '@/lib/languages';

/**
 * Real-engine suite: loads the actual lindera WASM tokenizer with its
 * embedded IPADIC dictionary (Node runtime only — the convex/edge suite
 * stubs it, see tests/convexTestSetup.ts). Guards what the stub can't:
 * that the dictionary's surface readings fit real sentences, that the
 * output is lossless against the input, and that known reading traps
 * (okurigana, compounds, counters, mixed script) come out well-formed.
 */

describe('furiganaForText (real lindera + IPADIC)', () => {
  // Exact-output cases: everyday sentences whose readings are stable
  // dictionary entries. If an engine upgrade shifts one of these, that's
  // exactly what the furiganaSource version bump exists to catch — update
  // FURIGANA_SOURCES alongside the expectation.
  it.each([
    ['毎朝七時に起きます。', '毎朝[まいあさ]七[なな]時[じ]に起[お]きます。'],
    [
      '日本語を勉強しています。',
      '日本語[にほんご]を勉強[べんきょう]しています。',
    ],
    // Okurigana anchored mid-word, twice.
    ['彼は話し合いを続けた。', '彼[かれ]は話[はな]し合[あ]いを続[つづ]けた。'],
    // Compound readings stay one unit (no per-kanji guessing).
    [
      '山田さんは大阪出身です。',
      '山田[やまだ]さんは大阪[おおさか]出身[しゅっしん]です。',
    ],
    // Counter ヶ inside the ruby run.
    ['一ヶ月かかりました。', '一[いち]ヶ月[かげつ]かかりました。'],
    // Iteration mark 々.
    ['人々が集まってきた。', '人々[ひとびと]が集[あつ]まってきた。'],
    // Latin + katakana pass through untouched.
    [
      'コーヒーを飲みながら本を読む。',
      'コーヒーを飲[の]みながら本[ほん]を読[よ]む。',
    ],
  ])('%s → %s', async (text, expected) => {
    expect(await furiganaForText(text, 'ja')).toBe(expected);
  });

  it('output always parses back losslessly against its input', async () => {
    const sentences = [
      '駅の近くに新しいレストランができました。',
      '彼女は日本の文化にとても興味を持っている。',
      'Hello, これは日本語の mixed テキストです。',
      '１２３番の電車に乗ってください。',
      '昨日は雨が降っていたので、家にいました。',
    ];
    for (const text of sentences) {
      const annotated = await furiganaForText(text, 'ja');
      const segments = parseFurigana(annotated, text);
      expect(segments, annotated).not.toBeNull();
      expect(segments!.some((seg) => seg.reading !== undefined)).toBe(true);
    }
  });

  it("returns the '' sentinel quietly for sentences with no kanji", async () => {
    // Kana-only, and kana+Latin: nothing a reading could attach to. This is
    // common and expected, so it must NOT go through the error/log path —
    // the sentinel comes back directly and is stored as "done, empty".
    await expect(
      furiganaForText('すみません、ちょっといいですか。', 'ja'),
    ).resolves.toBe('');
    await expect(
      furiganaForText('Hello, これは mixed テキストです。', 'ja'),
    ).resolves.toBe('');
  });

  it('throws for non-furigana languages', async () => {
    await expect(furiganaForText('早上好', 'zh')).rejects.toThrow(
      /not supported/,
    );
  });

  it('only Japanese is registered for furigana', () => {
    expect([...FURIGANA_LANGUAGES]).toEqual(['ja']);
  });
});
