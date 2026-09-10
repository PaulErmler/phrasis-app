/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { verdictForClassification } from '../../features/renderingClassification';

/**
 * The rendering classifier as a VERIFIER (docs/architecture/rendering-keys.md):
 * a wording is `ok` when every axis its language marks agrees with the key,
 * `mismatch` when one contradicts it, `unknown` without a usable answer.
 */
describe('verdictForClassification', () => {
  it('no answer is unknown, never a mismatch', () => {
    expect(verdictForClassification('ja', 'male|desu-masu', null)).toBe(
      'unknown',
    );
  });

  it('the form must be the key form on a language that marks politeness', () => {
    expect(
      verdictForClassification('ja', 'male|desu-masu', {
        gender: 'unmarked',
        politeness: 'polite',
      }),
    ).toBe('ok');
    expect(
      verdictForClassification('ja', 'male|desu-masu', {
        gender: 'unmarked',
        politeness: 'casual',
      }),
    ).toBe('mismatch');
    // A two-form language reports the form's lowest level: Sie is 'polite'.
    expect(
      verdictForClassification('de', 'male|v', {
        gender: 'unmarked',
        politeness: 'polite',
      }),
    ).toBe('ok');
    expect(
      verdictForClassification('de', 'male|t', {
        gender: 'unmarked',
        politeness: 'polite',
      }),
    ).toBe('mismatch');
  });

  it('a form-free key never fails on politeness', () => {
    expect(
      verdictForClassification('de', 'male|none', {
        gender: 'unmarked',
        politeness: 'casual',
      }),
    ).toBe('ok');
  });

  it('an unmarked wording satisfies a form only on a pronoun language', () => {
    expect(
      verdictForClassification('vi', 'male|respectful', {
        gender: 'unmarked',
        politeness: 'unmarked',
      }),
    ).toBe('ok');
    expect(
      verdictForClassification('ja', 'male|desu-masu', {
        gender: 'unmarked',
        politeness: 'unmarked',
      }),
    ).toBe('mismatch');
    expect(
      verdictForClassification('de', 'male|v', {
        gender: 'unmarked',
        politeness: 'unmarked',
      }),
    ).toBe('mismatch');
  });

  it('the voice must agree with any first-person marking, and unmarked is fine', () => {
    expect(
      verdictForClassification('ru', 'female|none', {
        gender: 'feminine',
        politeness: 'unmarked',
      }),
    ).toBe('ok');
    expect(
      verdictForClassification('ru', 'female|none', {
        gender: 'masculine',
        politeness: 'unmarked',
      }),
    ).toBe('mismatch');
    expect(
      verdictForClassification('ru', 'female|none', {
        gender: 'unmarked',
        politeness: 'unmarked',
      }),
    ).toBe('ok');
  });

  it('a language that marks no first person ignores the gender answer', () => {
    // Turkish marks politeness (sen / siz) and never the speaker's gender.
    expect(
      verdictForClassification('tr', 'female|v', {
        gender: 'masculine',
        politeness: 'polite',
      }),
    ).toBe('ok');
  });
});
