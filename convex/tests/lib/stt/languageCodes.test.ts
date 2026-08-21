/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import {
  toAzureSttLocale,
  toAzureSttLocales,
  buildAutoDetectLocales,
  AUTO_DETECT_LOCALES,
} from '../../../lib/stt/languageCodes';
import { SUPPORTED_LANGUAGES } from '../../../../lib/languages';

/**
 * Characterization tests for the Azure STT locale mapping. These pin the exact
 * locale for every supported code so the "single source of truth" refactor
 * (locale data moving onto the Language record) provably preserves behavior,
 * and fail loudly if a language is added without an STT-locale decision.
 */

const EXPECTED_AZURE: Record<string, string> = {
  en: 'en-US',
  en_gb: 'en-GB',
  en_us: 'en-US',
  en_au: 'en-AU',
  es: 'es-ES',
  es_latam: 'es-MX',
  es_mixed: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  pt_pt: 'pt-PT',
  ru: 'ru-RU',
  pl: 'pl-PL',
  sk: 'sk-SK',
  hi: 'hi-IN',
  bn: 'bn-IN',
  tr: 'tr-TR',
  hu: 'hu-HU',
  ro: 'ro-RO',
  cs: 'cs-CZ',
  zh: 'zh-CN',
  zh_traditional: 'zh-TW',
  yue: 'zh-HK',
  yue_traditional: 'zh-HK',
  ja: 'ja-JP',
  ko: 'ko-KR',
  vi: 'vi-VN',
  vi_south: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  sv: 'sv-SE',
  da: 'da-DK',
  // Symmetric default (no explicit azureSttLocale), live-verified Jul 2026.
  is: 'is-IS',
  fi: 'fi-FI',
  nl: 'nl-NL',
  el: 'el-GR',
  he: 'he-IL',
  fa: 'fa-IR',
  fil: 'fil-PH',
  ar: 'ar-SA',
  ar_sa: 'ar-SA',
  ar_eg: 'ar-EG',
  ar_iq: 'ar-IQ',
  ar_lev: 'ar-LB',
  sw: 'sw-KE',
  sw_tz: 'sw-TZ',
  nb: 'nb-NO',
  ca: 'ca-ES',
  ms: 'ms-MY',
  hr: 'hr-HR',
  sl: 'sl-SI',
  uk: 'uk-UA',
  sr: 'sr-RS',
  // Symmetric default (no explicit azureSttLocale).
  bg: 'bg-BG',
  lt: 'lt-LT',
  lv: 'lv-LV',
  et: 'et-EE',
  ta: 'ta-IN',
  te: 'te-IN',
};

describe('toAzureSttLocale', () => {
  it('maps every supported code to its documented Azure STT locale', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(toAzureSttLocale(lang.code), `code=${lang.code}`).toBe(
        EXPECTED_AZURE[lang.code],
      );
    }
  });

  it('has an Azure-locale decision for every supported code (no silent gaps)', () => {
    const missing = SUPPORTED_LANGUAGES.filter(
      (l) => !(l.code in EXPECTED_AZURE),
    ).map((l) => l.code);
    expect(missing, `codes without an expected Azure mapping: ${missing.join(', ')}`).toEqual([]);
  });

  it('preserves the legacy `cmn` alias used by Google voice locale prefixes', () => {
    expect(toAzureSttLocale('cmn')).toBe('zh-CN');
  });

  it('falls back to `<code>-<UPPER>` for unmapped codes', () => {
    expect(toAzureSttLocale('xx')).toBe('xx-XX');
  });
});

describe('toAzureSttLocales', () => {
  it('returns the explicit regionVariant when provided', () => {
    expect(toAzureSttLocales('es_mixed', 'es-MX')).toEqual(['es-MX']);
    expect(toAzureSttLocales('de', 'de-DE')).toEqual(['de-DE']);
  });

  it('expands es_mixed to both Spanish classifiers when no variant is known', () => {
    expect(toAzureSttLocales('es_mixed')).toEqual(['es-ES', 'es-MX']);
  });

  it('returns the single locale for non-mixed codes', () => {
    expect(toAzureSttLocales('fr')).toEqual(['fr-FR']);
    expect(toAzureSttLocales('ar_lev')).toEqual(['ar-LB']);
  });
});

describe('buildAutoDetectLocales', () => {
  it('returns the 8-locale base unchanged when no course context is given', () => {
    expect(buildAutoDetectLocales()).toEqual([...AUTO_DETECT_LOCALES]);
    expect(buildAutoDetectLocales([])).toEqual([...AUTO_DETECT_LOCALES]);
  });

  it('appends novel course locales after the base, deduped', () => {
    const result = buildAutoDetectLocales(['de', 'ja']);
    expect(result.slice(0, 8)).toEqual([...AUTO_DETECT_LOCALES]);
    expect(result).toContain('de-DE');
    expect(result).toContain('ja-JP');
  });

  it('does not duplicate a course locale already in the base', () => {
    const result = buildAutoDetectLocales(['en', 'es']); // both already in base
    expect(result).toEqual([...AUTO_DETECT_LOCALES]);
  });

  it('expands a mixed-dialect course code into its variants', () => {
    const result = buildAutoDetectLocales(['es_mixed']);
    // es-ES already in base; es-MX is the novel one appended.
    expect(result).toContain('es-MX');
  });

  it('never exceeds Azure’s 10-candidate cap', () => {
    const result = buildAutoDetectLocales([
      'de',
      'ja',
      'ko',
      'vi',
      'th',
      'id',
      'sv',
    ]);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});
