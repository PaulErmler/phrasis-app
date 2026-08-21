import { describe, it, expect } from 'vitest';
import {
  alignWordTimings,
  matchRatio,
  type ScribeWord,
} from '@/lib/audio/alignTimings';

describe('alignWordTimings', () => {
  it('returns empty array for empty text', () => {
    expect(alignWordTimings('', null, 'en')).toEqual([]);
    expect(alignWordTimings('', [], 'en')).toEqual([]);
  });

  it('marks all tokens unmatched when scribe is null/empty', () => {
    const aligned = alignWordTimings('hola mundo', null, 'es');
    expect(aligned).toHaveLength(2);
    expect(aligned.every((w) => w.matched === false)).toBe(true);
    expect(aligned.every((w) => w.start === 0 && w.end === 0)).toBe(true);
  });

  it('matches each token 1:1 with scribe and copies timings', () => {
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.6, end: 1.2 },
    ];
    const aligned = alignWordTimings('hola mundo', scribe, 'es');
    expect(aligned).toEqual([
      { display: 'hola', leading: '', trailing: '', start: 0, end: 0.5, matched: true },
      { display: 'mundo', leading: ' ', trailing: '', start: 0.6, end: 1.2, matched: true },
    ]);
  });

  it('folds intra-sentence punctuation into leading and parks trailing on the last token', () => {
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.6, end: 1.2 },
    ];
    const aligned = alignWordTimings('¡Hola, mundo!', scribe, 'es');
    expect(aligned).toHaveLength(2);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(true);
    // Intra-sentence non-word runs go to the next token's `leading`; the
    // trailing "!" (no token after it) is parked on the last token's
    // `trailing` so the renderer can place it OUTSIDE the clickable span.
    expect(aligned[0].display).toBe('Hola');
    expect(aligned[0].leading).toBe('¡');
    expect(aligned[0].trailing).toBe('');
    expect(aligned[1].display).toBe('mundo');
    expect(aligned[1].leading).toBe(', ');
    expect(aligned[1].trailing).toBe('!');
  });

  it('keeps the last Arabic word free of trailing punctuation', () => {
    // Regression: Arabic sentences ending in punctuation glued the final "؟"
    // onto the last word's display, so the clickable span contained mixed
    // RTL+LTR content and the popover trigger silently failed. The trailing
    // run now lives on `.trailing`, leaving `.display` as pure Arabic.
    const aligned = alignWordTimings('كيف حالك؟', null, 'ar');
    expect(aligned).toHaveLength(2);
    expect(aligned[0].display).toBe('كيف');
    expect(aligned[0].trailing).toBe('');
    expect(aligned[1].display).toBe('حالك');
    expect(aligned[1].trailing).toBe('؟');
  });

  it('does not produce tokens for pure-punctuation runs between words', () => {
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.8, end: 1.4 },
    ];
    const aligned = alignWordTimings('hola — mundo', scribe, 'es');
    expect(aligned).toHaveLength(2);
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(true);
    // The em-dash is non-word and folds into the next token's leading.
    expect(aligned[1].leading).toContain('—');
  });

  it('matches NFC-composed text against decomposed scribe output', () => {
    const composed = 'café'; // single combined codepoint
    const decomposed = 'café'; // base + combining acute
    const scribe: ScribeWord[] = [{ word: decomposed, start: 0, end: 0.4 }];
    const aligned = alignWordTimings(composed, scribe, 'fr');
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
    const aligned = alignWordTimings('hola mundo', scribe, 'es');
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(true);
    expect(aligned[1].start).toBe(0.7);
  });

  it('interpolates unmatched runs that fall outside the lookahead window', () => {
    const scribe: ScribeWord[] = [
      { word: 'a', start: 0, end: 0.2 },
      { word: 'd', start: 1.0, end: 1.2 },
    ];
    const aligned = alignWordTimings('a b c d', scribe, 'en');
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
    const aligned = alignWordTimings('hola querido mundo', scribe, 'es');
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
    const aligned = alignWordTimings('hola querido mundo', scribe, 'es');
    expect(aligned[0].matched).toBe(true);
    expect(aligned[1].matched).toBe(false);
    expect(aligned[1].start).toBe(0.5);
    expect(aligned[1].end).toBe(0.5);
    expect(aligned[2].matched).toBe(false);
    expect(aligned[2].start).toBe(0.5);
    expect(aligned[2].end).toBe(0.5);
  });

  it('round-trips arbitrary whitespace and punctuation', () => {
    const text = '  hola,\tmundo!\n  bonito  ';
    const scribe: ScribeWord[] = [
      { word: 'hola', start: 0, end: 0.4 },
      { word: 'mundo', start: 0.5, end: 1.0 },
      { word: 'bonito', start: 1.1, end: 1.6 },
    ];
    const aligned = alignWordTimings(text, scribe, 'es');
    const reconstructed = aligned
      .map((w) => w.leading + w.display + w.trailing)
      .join('');
    // Joining leading+display+trailing across all tokens reconstructs the
    // full source. Every codepoint is in either an inter-word leading run
    // on the next token or in the final trailing slot on the last token.
    expect(reconstructed).toBe(text);
  });

  it('segments Korean by eojeol and matches Scribe per-eojeol output', () => {
    const text = '제가 당신보다 그를 더 오래전부터 알고 지냈어요.';
    const scribe: ScribeWord[] = [
      { word: '제가', start: 0.56, end: 0.899 },
      { word: '당신보다', start: 1.059, end: 1.74 },
      { word: '그를', start: 1.799, end: 2.059 },
      { word: '더', start: 2.139, end: 2.22 },
      { word: '오래전부터', start: 2.339, end: 2.879 },
      { word: '알고', start: 3, end: 3.22 },
      { word: '지냈어요.', start: 3.319, end: 3.819 },
    ];
    const aligned = alignWordTimings(text, scribe, 'ko');
    expect(aligned).toHaveLength(7);
    expect(aligned.every((w) => w.matched)).toBe(true);
    expect(matchRatio(aligned)).toBe(1);
  });

  it('segments Japanese into multiple word tokens, not a single sentence token', () => {
    const text = 'どうするかはもう決めたわ。';
    const aligned = alignWordTimings(text, null, 'ja');
    // Intl.Segmenter "ja" identifies multiple word-like segments. The exact
    // count depends on the ICU dictionary in the test runtime, but it must be
    // strictly more than one (otherwise the "whole sentence as one word" bug
    // is back).
    expect(aligned.length).toBeGreaterThan(1);
  });

  it('falls back to whitespace tokenization when the language tag is invalid', () => {
    const aligned = alignWordTimings('hola mundo', null, '!!!not-a-locale!!!');
    // Should not throw; fallback regex still produces the two whitespace-
    // separated tokens.
    expect(aligned).toHaveLength(2);
    expect(aligned[0].display).toBe('hola');
    expect(aligned[1].display).toBe('mundo');
  });
});

describe('matchRatio', () => {
  it('returns 0 for an empty array', () => {
    expect(matchRatio([])).toBe(0);
  });

  it('returns 1 when every token matched', () => {
    const aligned = alignWordTimings(
      'hola mundo',
      [
        { word: 'hola', start: 0, end: 0.5 },
        { word: 'mundo', start: 0.6, end: 1.0 },
      ],
      'es',
    );
    expect(matchRatio(aligned)).toBe(1);
  });

  it('returns 0 when no tokens matched', () => {
    const aligned = alignWordTimings('hola mundo', null, 'es');
    expect(matchRatio(aligned)).toBe(0);
  });

  it('returns 0.5 when half the tokens matched', () => {
    const aligned = alignWordTimings(
      'hola mundo',
      [{ word: 'hola', start: 0, end: 0.5 }],
      'es',
    );
    expect(matchRatio(aligned)).toBe(0.5);
  });
});
