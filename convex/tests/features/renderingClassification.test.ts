/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { verdictForClassification } from '../../features/renderingClassification';

/**
 * The rendering classifier as a VERIFIER (docs/architecture/rendering-keys.md):
 * a wording is `ok` when it agrees with the speaker its key names, `mismatch`
 * when it contradicts it, `unknown` without a usable answer.
 */
describe('verdictForClassification', () => {
  it('no answer is unknown, never a mismatch', () => {
    expect(verdictForClassification('ja', 'male', null)).toBe('unknown');
  });

  it('the voice must agree with any first-person marking, and unmarked is fine', () => {
    expect(
      verdictForClassification('ru', 'female', { gender: 'feminine' }),
    ).toBe('ok');
    expect(
      verdictForClassification('ru', 'female', { gender: 'masculine' }),
    ).toBe('mismatch');
    expect(
      verdictForClassification('ru', 'female', { gender: 'unmarked' }),
    ).toBe('ok');
  });

  it('a language that marks no first person ignores the gender answer', () => {
    // Turkish never marks the speaker's gender.
    expect(
      verdictForClassification('tr', 'female', { gender: 'masculine' }),
    ).toBe('ok');
  });
});
