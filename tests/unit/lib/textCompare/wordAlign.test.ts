import { describe, it, expect } from 'vitest';
import { alignWords } from '@/lib/textCompare/wordAlign';
import { scoreWordAlignment } from '@/lib/textCompare/score';

describe('alignWords', () => {
  it('returns all equal when strings match exactly', () => {
    const r = alignWords('the quick brown fox', 'the quick brown fox');
    expect(r.counts.equal).toBe(4);
    expect(r.counts.typo).toBe(0);
    expect(r.counts.wrong).toBe(0);
    expect(r.counts.missing).toBe(0);
    expect(r.counts.extra).toBe(0);
  });

  it('returns empty result for two empty strings', () => {
    const r = alignWords('', '');
    expect(r.words).toEqual([]);
    expect(r.counts).toEqual({
      equal: 0,
      typo: 0,
      wrong: 0,
      missing: 0,
      extra: 0,
    });
  });

  it('detects missing words in the actual output', () => {
    const r = alignWords('the quick brown fox', 'the brown fox');
    expect(r.counts.missing).toBe(1);
    expect(r.counts.equal).toBe(3);
    const missing = r.words.find((w) => w.tag === 'missing');
    expect(missing?.expected).toBe('quick');
  });

  it('detects extra words in the actual output', () => {
    const r = alignWords('the fox', 'the quick fox');
    expect(r.counts.extra).toBe(1);
    expect(r.counts.equal).toBe(2);
    const extra = r.words.find((w) => w.tag === 'extra');
    expect(extra?.actual).toBe('quick');
  });

  it('classifies small edit distance as typo, larger as wrong', () => {
    const typoResult = alignWords('beautiful', 'beutiful'); // missing one char
    expect(typoResult.counts.typo).toBe(1);

    const wrongResult = alignWords('cat', 'dog');
    expect(wrongResult.counts.wrong).toBe(1);
  });

  it('honours foldCase when comparing', () => {
    const strict = alignWords('Hello World', 'hello world');
    // without folding, "Hello" vs "hello" might still align as typo/equal depending on edit distance
    const lax = alignWords('Hello World', 'hello world', { foldCase: true });
    expect(lax.counts.equal).toBe(2);
    // Strict: one-char case difference counts as dist 1 on len 5 → typo threshold=1, so typo
    expect(strict.counts.typo + strict.counts.equal).toBe(2);
  });

  it('preserves raw surface forms in aligned output', () => {
    const r = alignWords('Hello World', 'Hello World');
    expect(r.words.map((w) => w.expected)).toEqual(['Hello', 'World']);
  });

  it('surfaces punctuation differences as missing entries', () => {
    const r = alignWords('hello, world!', 'hello world');
    // Both words still align as equal.
    expect(r.words.filter((w) => w.kind === 'word' && w.tag === 'equal')).toHaveLength(2);
    // The comma and the exclamation are both missing from the user's input.
    const missingPunct = r.words.filter(
      (w) => w.kind === 'punct' && w.tag === 'missing',
    );
    expect(missingPunct.map((w) => w.expected)).toEqual([',', '!']);
  });

  it('tags every punctuation token with kind: "punct"', () => {
    const r = alignWords('Hello, world!', 'Hello, world!');
    const punct = r.words.filter((w) => w.kind === 'punct');
    expect(punct.map((w) => w.actual)).toEqual([',', '!']);
    expect(punct.every((w) => w.tag === 'equal')).toBe(true);
  });

  it('detects a missing terminal period', () => {
    const r = alignWords('Das ist ein Test.', 'Das ist ein Test');
    const missing = r.words.filter((w) => w.tag === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].kind).toBe('punct');
    expect(missing[0].expected).toBe('.');
  });

  it('detects wrong terminal punctuation', () => {
    const r = alignWords('Where are you going?', 'Where are you going.');
    const wrong = r.words.find((w) => w.tag === 'wrong');
    expect(wrong).toBeDefined();
    expect(wrong?.kind).toBe('punct');
    expect(wrong?.expected).toBe('?');
    expect(wrong?.actual).toBe('.');
  });

  it('detects an extra comma in the middle', () => {
    const r = alignWords('I think it works.', 'I think, it works.');
    const extra = r.words.find((w) => w.tag === 'extra');
    expect(extra).toBeDefined();
    expect(extra?.kind).toBe('punct');
    expect(extra?.actual).toBe(',');
  });

  it('detects missing Spanish opening question mark', () => {
    const r = alignWords('¿Cómo estás?', 'Cómo estás?');
    const missing = r.words.filter((w) => w.tag === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].kind).toBe('punct');
    expect(missing[0].expected).toBe('¿');
  });

  it('never pairs a word with a punctuation mark', () => {
    const r = alignWords('Test.', 'Test');
    // Word still aligns as equal. The period becomes a `missing` punct entry,
    // not a wrong substitution against "Test".
    const wordEntry = r.words.find((w) => w.kind === 'word');
    expect(wordEntry?.tag).toBe('equal');
    const punctEntry = r.words.find((w) => w.kind === 'punct');
    expect(punctEntry?.tag).toBe('missing');
    expect(punctEntry?.expected).toBe('.');
  });

  describe('scoreWordAlignment integration', () => {
    it('weights a missing punctuation mark as 1/4 of a word', () => {
      // 4 equal words + 1 missing period (weight 0.25)
      // expectedWeight = 4 + 0.25 = 4.25; correct = 4
      const r = alignWords('Das ist ein Test.', 'Das ist ein Test');
      expect(scoreWordAlignment(r)).toBeCloseTo(4 / 4.25, 4);
    });

    it('penalizes a punctuation mistake less than a word mistake', () => {
      // Same 4 equal words; one variant misses the period, the other has a
      // wrong word. The wrong-word version must score strictly lower.
      const missingPunct = alignWords(
        'Das ist ein Test.',
        'Das ist ein Test',
      );
      const wrongWord = alignWords('Das ist ein Test', 'Das ist ein Buch');
      expect(scoreWordAlignment(missingPunct)).toBeGreaterThan(
        scoreWordAlignment(wrongWord),
      );
    });

    it('co-occurring punctuation errors add a small penalty on top of word errors', () => {
      // typo on "brown" + missing terminal period vs. typo only.
      // The punct mistake must add a measurable but small penalty.
      const withPunctMistake = alignWords(
        'The quick brown fox jumps.',
        'The quick brwn fox jumps',
      );
      const wordOnly = alignWords(
        'The quick brown fox jumps',
        'The quick brwn fox jumps',
      );
      const wordScore = scoreWordAlignment(wordOnly);
      const combinedScore = scoreWordAlignment(withPunctMistake);
      // Combined < word-only, but by less than a full word weight would cost.
      expect(combinedScore).toBeLessThan(wordScore);
      expect(wordScore - combinedScore).toBeLessThan(0.1);
    });
  });

  describe('ignorePunctuation', () => {
    const OPTS = { ignorePunctuation: true };

    it('scores a missing terminal period as perfect', () => {
      const r = alignWords('Das ist ein Test.', 'Das ist ein Test', OPTS);
      expect(scoreWordAlignment(r, OPTS)).toBe(1);
    });

    it('scores completely different punctuation as perfect', () => {
      const r = alignWords('Yes, really!', 'Yes really...', OPTS);
      expect(scoreWordAlignment(r, OPTS)).toBe(1);
    });

    it('keeps punctuation in the alignment so the diff can render it', () => {
      const r = alignWords('Das ist ein Test.', 'Das ist ein Test', OPTS);
      const punct = r.words.filter((w) => w.kind === 'punct');
      expect(punct).toHaveLength(1);
      expect(punct[0].expected).toBe('.');
    });

    it('forgives a missing apostrophe inside a word', () => {
      const r = alignWords("I don't know", 'I dont know', OPTS);
      expect(scoreWordAlignment(r, OPTS)).toBe(1);
    });

    it('still penalizes a wrong word', () => {
      const r = alignWords('Das ist ein Test.', 'Das ist ein Buch', OPTS);
      expect(scoreWordAlignment(r, OPTS)).toBeLessThan(1);
    });
  });
});
