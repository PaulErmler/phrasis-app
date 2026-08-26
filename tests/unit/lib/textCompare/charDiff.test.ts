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

  // The char path is what ja/zh/th/yue use. See `hasWordBoundaries` in
  // lib/languages.ts, so this is the one that matters for Japanese.
  describe('ignorePunctuation', () => {
    const OPTS = { ignorePunctuation: true, locale: 'ja' };

    it('scores a missing Japanese full stop as perfect', () => {
      expect(
        charDiff('今日は暑いですね。', '今日は暑いですね', OPTS).accuracy,
      ).toBe(1);
      expect(
        charDiff('今日は暑いですね。', '今日は暑いですね').accuracy,
      ).toBeLessThan(1);
    });

    it('scores a missing Japanese comma as perfect', () => {
      expect(charDiff('はい、そうです。', 'はいそうです', OPTS).accuracy).toBe(
        1,
      );
    });

    it('still penalizes a wrong character', () => {
      expect(
        charDiff('今日は暑いですね。', '今日は寒いですね', OPTS).accuracy,
      ).toBeLessThan(1);
    });

    it('flags punctuation-only mismatches as ignored, not as errors', () => {
      const r = charDiff('今日は暑いですね。', '今日は暑いですね', OPTS);
      const mismatched = r.chunks.filter((c) => c.kind !== 'equal');
      expect(mismatched).toHaveLength(1);
      expect(mismatched[0].text).toBe('。');
      expect(mismatched[0].ignored).toBe(true);
    });

    it('does not mark real mismatches as ignored', () => {
      const r = charDiff('今日は暑いですね', '今日は寒いですね', OPTS);
      expect(r.chunks.filter((c) => c.ignored)).toHaveLength(0);
    });

    it('leaves chunks unflagged when the option is off', () => {
      const r = charDiff('今日は暑いですね。', '今日は暑いですね');
      expect(r.chunks.some((c) => c.ignored)).toBe(false);
    });

    it('still renders the punctuation in the chunks', () => {
      const r = charDiff('今日は暑いですね。', '今日は暑いですね', OPTS);
      const joinedExpected = r.chunks
        .filter((c) => c.kind !== 'added')
        .map((c) => c.text)
        .join('');
      expect(joinedExpected).toBe('今日は暑いですね。');
    });

    // Thai takes the char path but uses real spaces. A missing space costs
    // accuracy, so it must not render as a neutral "ignored" chunk.
    it('does not mark a missing space as ignored (Thai)', () => {
      const r = charDiff('สวัสดี ครับ', 'สวัสดีครับ', {
        ignorePunctuation: true,
        locale: 'th',
      });
      expect(r.accuracy).toBeLessThan(1);
      const mismatched = r.chunks.filter((c) => c.kind !== 'equal');
      expect(mismatched).toHaveLength(1);
      expect(mismatched[0].text).toBe(' ');
      expect(mismatched[0].ignored).toBeUndefined();
    });

    it('does not mark a punctuation+space chunk as ignored when the space is scored', () => {
      const r = charDiff('Hello, world', 'Helloworld', {
        ignorePunctuation: true,
        locale: 'en',
      });
      expect(r.accuracy).toBeLessThan(1);
      expect(r.chunks.some((c) => c.ignored)).toBe(false);
    });
  });
});
