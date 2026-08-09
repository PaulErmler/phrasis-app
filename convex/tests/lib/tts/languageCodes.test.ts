/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { toGeminiBcp47 } from '../../../lib/tts/languageCodes';
import { SUPPORTED_LANGUAGES } from '../../../../lib/languages';

/**
 * Characterization tests: pin the exact provider-locale output for every
 * supported language code. These guard the "single source of truth" refactor
 * (locale data moving onto the Language record) — the derived map must produce
 * identical output for every code. They also fail loudly if a language is added
 * to SUPPORTED_LANGUAGES without a Gemini-locale decision.
 */

// Expected Gemini BCP-47 for every supported code. Codes Gemini does not
// support (Cantonese) pass through unchanged.
const EXPECTED_GEMINI: Record<string, string> = {
  en: 'en-US',
  en_gb: 'en-GB',
  en_us: 'en-US',
  en_au: 'en-AU',
  es: 'es-ES',
  // es_latam now routes through Gemini, which has no `es-419` macro locale —
  // it uses `es-US` (American Spanish), matching the es_mixed es_latam variant.
  es_latam: 'es-US',
  es_mixed: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  pt_pt: 'pt-PT',
  ro: 'ro-RO',
  ru: 'ru-RU',
  pl: 'pl-PL',
  sk: 'sk-SK',
  cs: 'cs-CZ',
  nl: 'nl-NL',
  sv: 'sv-SE',
  da: 'da-DK',
  is: 'is-IS',
  fi: 'fi-FI',
  el: 'el-GR',
  hi: 'hi-IN',
  bn: 'bn-BD',
  tr: 'tr-TR',
  hu: 'hu-HU',
  zh: 'cmn-CN',
  zh_traditional: 'cmn-TW',
  // Cantonese: not supported by Gemini → passthrough.
  yue: 'yue',
  yue_traditional: 'yue_traditional',
  ja: 'ja-JP',
  ko: 'ko-KR',
  vi: 'vi-VN',
  vi_south: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  ar: 'ar-001',
  ar_sa: 'ar-001',
  ar_eg: 'ar-EG',
  ar_iq: 'ar-001',
  ar_lev: 'ar-001',
  he: 'he-IL',
  fa: 'fa-IR',
  fil: 'fil-PH',
  sw: 'sw-KE',
  sw_tz: 'sw-KE',
  nb: 'nb-NO',
  ca: 'ca-ES',
  ms: 'ms-MY',
  hr: 'hr-HR',
  sl: 'sl-SI',
  uk: 'uk-UA',
  sr: 'sr-RS',
  bg: 'bg-BG',
  lt: 'lt-LT',
  lv: 'lv-LV',
  et: 'et-EE',
  ta: 'ta-IN',
  te: 'te-IN',
};

describe('toGeminiBcp47', () => {
  it('maps every supported code to its documented Gemini locale', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(toGeminiBcp47(lang.code), `code=${lang.code}`).toBe(
        EXPECTED_GEMINI[lang.code],
      );
    }
  });

  it('has a Gemini-locale decision for every supported code (no silent gaps)', () => {
    const missing = SUPPORTED_LANGUAGES.filter(
      (l) => !(l.code in EXPECTED_GEMINI),
    ).map((l) => l.code);
    expect(missing, `codes without an expected Gemini mapping: ${missing.join(', ')}`).toEqual([]);
  });

  it('passes unknown codes through unchanged', () => {
    expect(toGeminiBcp47('xx-unknown')).toBe('xx-unknown');
  });
});
