/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { hasLocalRomanization } from '../../lib/localRomanization';

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
