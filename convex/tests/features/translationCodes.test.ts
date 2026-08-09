/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { toGoogleTranslateCode } from '../../features/translation';
import { SUPPORTED_LANGUAGES } from '../../../lib/languages';

/**
 * Characterization tests for the Google Translate / romanization code mapping.
 * Pins the exact output per supported code so the "single source of truth"
 * refactor (mapping derived from the Language record) provably preserves
 * behavior. Most codes pass through unchanged; only variants/dialects collapse.
 */
const EXPECTED_GOOGLE: Record<string, string> = {
  en: 'en',
  en_gb: 'en',
  en_us: 'en',
  en_au: 'en',
  es: 'es',
  es_latam: 'es',
  es_mixed: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  pt_pt: 'pt-PT',
  ro: 'ro',
  ru: 'ru',
  pl: 'pl',
  sk: 'sk',
  cs: 'cs',
  nl: 'nl',
  sv: 'sv',
  da: 'da',
  is: 'is',
  fi: 'fi',
  el: 'el',
  hi: 'hi',
  bn: 'bn',
  tr: 'tr',
  hu: 'hu',
  zh: 'zh',
  zh_traditional: 'zh-TW',
  yue: 'yue',
  yue_traditional: 'yue',
  ja: 'ja',
  ko: 'ko',
  vi: 'vi',
  vi_south: 'vi',
  th: 'th',
  id: 'id',
  ar: 'ar',
  ar_sa: 'ar',
  ar_eg: 'ar',
  ar_iq: 'ar',
  ar_lev: 'ar',
  he: 'he',
  fa: 'fa',
  fil: 'tl',
  sw: 'sw',
  sw_tz: 'sw',
  // Jul 2026 expansion — all pass-through except Norwegian (Google Translate
  // v2 catalogs Bokmål under 'no').
  nb: 'no',
  ca: 'ca',
  ms: 'ms',
  hr: 'hr',
  sl: 'sl',
  uk: 'uk',
  sr: 'sr',
  bg: 'bg',
  lt: 'lt',
  lv: 'lv',
  et: 'et',
  ta: 'ta',
  te: 'te',
};

describe('toGoogleTranslateCode', () => {
  it('maps every supported code to its documented Google Translate code', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(toGoogleTranslateCode(lang.code), `code=${lang.code}`).toBe(
        EXPECTED_GOOGLE[lang.code],
      );
    }
  });

  it('has a Google-code decision for every supported code (no silent gaps)', () => {
    const missing = SUPPORTED_LANGUAGES.filter(
      (l) => !(l.code in EXPECTED_GOOGLE),
    ).map((l) => l.code);
    expect(missing, `codes without an expected Google mapping: ${missing.join(', ')}`).toEqual([]);
  });

  it('passes unknown codes through unchanged', () => {
    expect(toGoogleTranslateCode('zz')).toBe('zz');
  });
});
