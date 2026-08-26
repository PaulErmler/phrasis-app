import { describe, it, expect } from 'vitest';
import { bestCandidate, answersMatchExactly } from '@/lib/textCompare';

describe('bestCandidate', () => {
  it('ranks by the lenient score', () => {
    // Answer equals B up to punctuation; A shares only some words.
    const answer = 'me gustaría un café';
    const a = 'Quisiera un café.';
    const b = 'Me gustaría un café.';
    expect(bestCandidate([a, b], answer, 'es').text).toBe(b);
  });

  it('breaks lenient ties by the strict score', () => {
    // Both candidates normalize to the answer (lenient 100); only A also
    // matches the punctuation, so A must win even when listed second.
    const answer = 'Hola, ¿qué tal?';
    const a = 'Hola, ¿qué tal?';
    const b = 'Hola qué tal';
    const picked = bestCandidate([b, a], answer, 'es');
    expect(picked.text).toBe(a);
    expect(picked.pair.withPunctuation).toBe(100);
  });

  it('keeps the earlier candidate on a full tie (the primary is listed first)', () => {
    const answer = 'algo completamente distinto';
    const picked = bestCandidate(
      ['Uno dos tres.', 'Uno dos tres.'],
      answer,
      'es',
    );
    expect(picked.text).toBe('Uno dos tres.');
  });

  it('is deterministic regardless of the ignore-punctuation setting (the rule takes no setting)', () => {
    // The whole point: rating summary and diff share one pick with no
    // setting parameter to diverge on.
    const answer = 'buenos días señor';
    const candidates = ['Buenos días, señor.', 'Buenas tardes, señora.'];
    expect(bestCandidate(candidates, answer, 'es').text).toBe(candidates[0]);
  });

  it('throws on an empty candidate list', () => {
    expect(() => bestCandidate([], 'x', 'es')).toThrow();
  });
});

describe('answersMatchExactly', () => {
  it('ignores punctuation, case, and whitespace runs', () => {
    expect(
      answersMatchExactly('¿Cómo estás?', 'como estás'.replace('como', 'cómo')),
    ).toBe(true);
    expect(answersMatchExactly('Quisiera un café.', 'quisiera  un café')).toBe(
      true,
    );
  });

  it('does not absorb real typos (no rounding, no edit distance)', () => {
    expect(answersMatchExactly('Quisiera un café.', 'Quisiera un cafe.')).toBe(
      false,
    );
    const long = Array.from({ length: 60 }, () => 'bonita').join(' ');
    expect(answersMatchExactly(long, long.replace(/bonita$/, 'bonitaa'))).toBe(
      false,
    );
  });
});
