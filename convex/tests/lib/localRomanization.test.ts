/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import {
  hasLocalRomanization,
  romanizeLocal,
  getRomanizationSource,
  ROMANIZATION_SOURCES,
} from '../../lib/localRomanization';

/**
 * Characterizes which languages romanize locally (in-process libraries) vs via
 * Google Cloud v3. Guards the "single source of truth" refactor that derives
 * this set from a `romanizationBackend` field on the Language record.
 */
describe('hasLocalRomanization', () => {
  const LOCAL = [
    'zh',
    'zh_traditional',
    'yue',
    'yue_traditional',
    'el',
    'ko',
    'he',
    'ar',
    'ar_sa',
    'ar_eg',
    'ar_iq',
    'ar_lev',
    'fa',
  ];
  // Romanized, but via Google Cloud v3 (not local).
  const GOOGLE_V3 = ['ru', 'hi', 'bn', 'ja'];
  // Not romanized at all.
  const NONE = ['en', 'de', 'fr', 'es', 'th'];

  it('returns true for every locally-romanized language', () => {
    for (const code of LOCAL) {
      expect(hasLocalRomanization(code), `code=${code}`).toBe(true);
    }
  });

  it('returns false for Google-v3 and non-romanized languages', () => {
    for (const code of [...GOOGLE_V3, ...NONE]) {
      expect(hasLocalRomanization(code), `code=${code}`).toBe(false);
    }
  });
});

describe('romanizeLocal — Persian (fa)', () => {
  it('routes fa through @sindresorhus/transliterate', () => {
    expect(getRomanizationSource('fa')).toBe(
      ROMANIZATION_SOURCES.sindresorhusTransliterate,
    );
  });

  it('transliterates the Perso-Arabic consonant skeleton', () => {
    // Short vowels are not written in the script, so they're absent (slam, not salam).
    expect(romanizeLocal('سلام', 'fa')).toBe('slam');
    expect(romanizeLocal('فارسی', 'fa')).toBe('farsy');
  });

  it('strips the zero-width non-joiner (U+200C) between word parts', () => {
    expect(romanizeLocal('می‌روم', 'fa')).toBe('myrwm');
    expect(romanizeLocal('می‌روم', 'fa')).not.toMatch(/‌/);
  });

  it('leaves no non-ASCII residue (ezafe hamza U+0654 / superscript alef U+0670)', () => {
    // The ezafe hamza on -e/-eh words is common; it (and superscript alef) must
    // not leak into the learner-facing romanization.
    expect(romanizeLocal('خانهٔ من', 'fa')).not.toMatch(/[\u0080-\uFFFF]/);
    expect(romanizeLocal('رحمٰن', 'fa')).not.toMatch(/[\u0080-\uFFFF]/);
  });
});
