import { describe, it, expect } from 'vitest';
import {
  alignWordTimings,
  matchRatio,
  type ScribeWord,
} from '@/lib/audio/alignTimings';

describe('alignWordTimings', () => {
  it('returns empty array for empty text', () => {
    expect(alignWordTimings('', null)).toEqual([]);
    expect(alignWordTimings('', [])).toEqual([]);
  });

  it('marks all tokens unmatched when scribe is null/empty', () => {
    const aligned = alignWordTimings('hola mundo', null);
    expect(aligned).toHaveLength(2);
    expect(aligned.every((w) => w.matched === false)).toBe(true);
    expect(aligned.every((w) => w.start === 0 && w.end === 0)).toBe(true);
  });

  it('matches each token 1:1 with scribe and copies timings', () => {
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.6, end: 1.2 },
    ];
    const aligned = alignWordTimings('hola mundo', scribe);
    expect(aligned).toEqual([
      { display: 'hola', leading: '', start: 0, end: 0.5, matched: true },
      { display: 'mundo', leading: ' ', start: 0.6, end: 1.2, matched: true },
    ]);
  });

  it('strips surrounding punctuation when matching tokens', () => {
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.6, end: 1.2 },
    ];
    const aligned = alignWordTimings('¡Hola, mundo!', scribe);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(true);
    expect(aligned[0].display).toBe('¡Hola,');
    expect(aligned[1].display).toBe('mundo!');
  });

  it('treats pure-punctuation tokens as unmatched and interpolates their timing', () => {
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.8, end: 1.4 },
    ];
    const aligned = alignWordTimings('hola — mundo', scribe);
    expect(aligned).toHaveLength(3);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(false);
    expect(aligned[1].display).toBe('—');
    expect(aligned[1].start).toBe(0.5);
    expect(aligned[1].end).toBe(0.8);
    expect(aligned[2].matched).toBe(true);
  });

  it('matches NFC-composed text against decomposed scribe output', () => {
    const composed = 'café'; // single combined codepoint
    const decomposed = 'cafe\u0301'; // base + combining acute
    const scribe: ScribeWord[] = [{ word: decomposed, start: 0, end: 0.4 }];
    const aligned = alignWordTimings(composed, scribe);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[0].start).toBe(0);
    expect(aligned[0].end).toBe(0.4);
  });

  it('uses the lookahead window to skip a single inserted scribe filler', () => {
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.4 },
      { word: 'uh', start: 0.5, end: 0.6 }, // filler scribe inserted
      { word: 'mundo', start: 0.7, end: 1.3 },
    ];
    const aligned = alignWordTimings('hola mundo', scribe);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(true);
    expect(aligned[1].start).toBe(0.7);
  });

  it('interpolates unmatched runs that fall outside the lookahead window', () => {
    const scribe: ScribeWord[] = [
      { word: 'a', start: 0, end: 0.2 },
      { word: 'd', start: 1.0, end: 1.2 },
    ];
    const aligned = alignWordTimings('a b c d', scribe);
    expect(aligned).toHaveLength(4);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[3].matched).toBe(true);
    expect(aligned[1].matched).toBe(false);
    expect(aligned[2].matched).toBe(false);
    // Interpolation walks left-to-right and reads each preceding entry's
    // filled-in end, so partials[1] anchors on the matched 'a' (end=0.2)
    // while partials[2] then anchors on partials[1]'s new end (1.0).
    expect(aligned[1].start).toBe(0.2);
    expect(aligned[1].end).toBe(1.0);
    expect(aligned[2].start).toBe(1.0);
    expect(aligned[2].end).toBe(1.0);
  });

  it('inherits the next match boundary for leading-unmatched runs', () => {
    const scribe: ScribeWord[] = [
      { word: 'mundo', start: 1.0, end: 1.5 },
    ];
    const aligned = alignWordTimings('hola querido mundo', scribe);
    expect(aligned[0].matched).toBe(false);
    // No prevEnd → start defaults to nextStart (1.0); end is also nextStart.
    expect(aligned[0].start).toBe(1.0);
    expect(aligned[0].end).toBe(1.0);
    expect(aligned[1].matched).toBe(false);
    expect(aligned[1].start).toBe(1.0);
    expect(aligned[1].end).toBe(1.0);
    expect(aligned[2].matched).toBe(true);
  });

  it('inherits the previous match boundary for trailing-unmatched runs', () => {
    const scribe: ScribeWord[] = [{ word: 'hola', start: 0, end: 0.5 }];
    const aligned = alignWordTimings('hola querido mundo', scribe);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(false);
    expect(aligned[1].start).toBe(0.5);
    expect(aligned[1].end).toBe(0.5);
    expect(aligned[2].matched).toBe(false);
    expect(aligned[2].start).toBe(0.5);
    expect(aligned[2].end).toBe(0.5);
  });

  it('preserves whitespace such that joining leading+display reconstructs the source', () => {
    const text = '  hola,\tmundo!\n  bonito  ';
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.4 },
      { word: 'mundo', start: 0.5, end: 1.0 },
      { word: 'bonito', start: 1.1, end: 1.6 },
    ];
    const aligned = alignWordTimings(text, scribe);
    const reconstructed = aligned.map((w) => w.leading + w.display).join('');
    // Trailing whitespace after the last token isn't captured (tokeniser
    // anchors leading whitespace only); everything up through the last token
    // must round-trip.
    expect(text.startsWith(reconstructed)).toBe(true);
    expect(reconstructed.endsWith('bonito')).toBe(true);
  });
});

describe('matchRatio', () => {
  it('returns 0 for an empty array', () => {
    expect(matchRatio([])).toBe(0);
  });

  it('returns 1 when every token matched', () => {
    const aligned = alignWordTimings('hola mundo', [
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.6, end: 1.0 },
    ]);
    expect(matchRatio(aligned)).toBe(1);
  });

  it('returns 0 when no tokens matched', () => {
    const aligned = alignWordTimings('hola mundo', null);
    expect(matchRatio(aligned)).toBe(0);
  });

  it('returns 0.5 when half the tokens matched', () => {
    const aligned = alignWordTimings('hola mundo', [
      { word: 'hola', start: 0, end: 0.5 },
    ]);
    expect(matchRatio(aligned)).toBe(0.5);
  });
});
