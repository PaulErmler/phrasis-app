import { describe, it, expect } from 'vitest';
import { scoreWordAlignment } from '@/lib/textCompare/score';
import type {
  AlignedWord,
  WordAlignResult,
  WordTag,
} from '@/lib/textCompare/wordAlign';

function makeResult(
  counts: Partial<WordAlignResult['counts']>,
): WordAlignResult {
  const full = {
    equal: 0,
    typo: 0,
    wrong: 0,
    missing: 0,
    extra: 0,
    ...counts,
  };
  // Score reads from `words` (so punctuation tokens can be filtered out), so
  // expand the counts into a matching synthetic words array.
  const words: AlignedWord[] = [];
  (Object.keys(full) as WordTag[]).forEach((tag) => {
    for (let i = 0; i < full[tag]; i++) {
      words.push({ tag, kind: 'word', expected: 'x', actual: 'x' });
    }
  });
  return { words, counts: full };
}

describe('scoreWordAlignment', () => {
  it('returns 1 when there are no words at all', () => {
    expect(scoreWordAlignment(makeResult({}))).toBe(1);
  });

  it('returns 1 when every word is equal', () => {
    expect(scoreWordAlignment(makeResult({ equal: 4 }))).toBe(1);
  });

  it('returns 0 when every word is wrong', () => {
    expect(scoreWordAlignment(makeResult({ wrong: 3 }))).toBe(0);
  });

  it('awards partial credit for typos (0.7 weight)', () => {
    const score = scoreWordAlignment(makeResult({ typo: 1 }));
    expect(score).toBeCloseTo(0.7);
  });

  it('mixes equal + typo correctly', () => {
    const score = scoreWordAlignment(makeResult({ equal: 1, typo: 1 }));
    // (1 + 0.7) / 2 = 0.85
    expect(score).toBeCloseTo(0.85);
  });

  it('uses the larger of expected/actual counts as denominator', () => {
    // 1 equal + 3 extras → denom = max(1, 4) = 4; correct = 1 → 0.25
    const score = scoreWordAlignment(makeResult({ equal: 1, extra: 3 }));
    expect(score).toBeCloseTo(0.25);
  });

  it('clamps score to [0, 1]', () => {
    const score = scoreWordAlignment(makeResult({ equal: 2 }));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  describe('ignorePunctuation', () => {
    /** 3 equal words plus one punctuation token with the given tag. */
    function withPunct(tag: WordTag): WordAlignResult {
      const words: AlignedWord[] = [
        { tag: 'equal', kind: 'word', expected: 'a', actual: 'a' },
        { tag: 'equal', kind: 'word', expected: 'b', actual: 'b' },
        { tag: 'equal', kind: 'word', expected: 'c', actual: 'c' },
        {
          tag,
          kind: 'punct',
          expected: tag === 'extra' ? '' : '.',
          actual: tag === 'missing' ? '' : '.',
        },
      ];
      const counts = { equal: 3, typo: 0, wrong: 0, missing: 0, extra: 0 };
      counts[tag] += 1;
      return { words, counts };
    }

    it.each<WordTag>(['missing', 'extra', 'wrong'])(
      'gives full credit despite a %s punctuation token',
      (tag) => {
        expect(
          scoreWordAlignment(withPunct(tag), { ignorePunctuation: true }),
        ).toBe(1);
      },
    );

    it('still penalizes punctuation when the option is off', () => {
      expect(scoreWordAlignment(withPunct('missing'))).toBeLessThan(1);
    });

    it('leaves word-level scoring untouched', () => {
      const r = makeResult({ equal: 1, wrong: 1 });
      expect(scoreWordAlignment(r, { ignorePunctuation: true })).toBeCloseTo(
        scoreWordAlignment(r),
      );
    });

    it('returns 1 when the answer is punctuation only', () => {
      const words: AlignedWord[] = [
        { tag: 'missing', kind: 'punct', expected: '.', actual: '' },
      ];
      const result: WordAlignResult = {
        words,
        counts: { equal: 0, typo: 0, wrong: 0, missing: 1, extra: 0 },
      };
      // Everything is zero-weighted, so the denominator is 0 → treated as
      // "nothing to get wrong" rather than a divide-by-zero.
      expect(scoreWordAlignment(result, { ignorePunctuation: true })).toBe(1);
    });
  });
});
