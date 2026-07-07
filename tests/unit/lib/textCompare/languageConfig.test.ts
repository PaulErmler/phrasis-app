import { describe, it, expect } from 'vitest';
import { getCompareConfig, toDiffOptions } from '@/lib/textCompare/languageConfig';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';

/**
 * Per-code expected compare config (locale + hasWordBoundaries). Characterizes
 * the current behavior so the "single source of truth" refactor (config derived
 * from the Language record) provably preserves it, and fails if a language is
 * added without a compare-locale decision.
 */
const EXPECTED_COMPARE: Record<string, { locale: string; hasWordBoundaries: boolean }> = {
  en: { locale: 'en', hasWordBoundaries: true },
  en_gb: { locale: 'en-GB', hasWordBoundaries: true },
  en_us: { locale: 'en-US', hasWordBoundaries: true },
  en_au: { locale: 'en-AU', hasWordBoundaries: true },
  es: { locale: 'es', hasWordBoundaries: true },
  es_latam: { locale: 'es-419', hasWordBoundaries: true },
  es_mixed: { locale: 'es', hasWordBoundaries: true },
  fr: { locale: 'fr', hasWordBoundaries: true },
  de: { locale: 'de', hasWordBoundaries: true },
  it: { locale: 'it', hasWordBoundaries: true },
  pt: { locale: 'pt', hasWordBoundaries: true },
  pt_pt: { locale: 'pt-PT', hasWordBoundaries: true },
  ro: { locale: 'ro', hasWordBoundaries: true },
  ru: { locale: 'ru', hasWordBoundaries: true },
  pl: { locale: 'pl', hasWordBoundaries: true },
  sk: { locale: 'sk', hasWordBoundaries: true },
  cs: { locale: 'cs', hasWordBoundaries: true },
  nl: { locale: 'nl', hasWordBoundaries: true },
  sv: { locale: 'sv', hasWordBoundaries: true },
  da: { locale: 'da', hasWordBoundaries: true },
  fi: { locale: 'fi', hasWordBoundaries: true },
  el: { locale: 'el', hasWordBoundaries: true },
  hi: { locale: 'hi', hasWordBoundaries: true },
  bn: { locale: 'bn', hasWordBoundaries: true },
  tr: { locale: 'tr', hasWordBoundaries: true },
  hu: { locale: 'hu', hasWordBoundaries: true },
  zh: { locale: 'zh', hasWordBoundaries: false },
  zh_traditional: { locale: 'zh-TW', hasWordBoundaries: false },
  yue: { locale: 'yue-Hans-HK', hasWordBoundaries: false },
  yue_traditional: { locale: 'yue-Hant-HK', hasWordBoundaries: false },
  ja: { locale: 'ja', hasWordBoundaries: false },
  ko: { locale: 'ko', hasWordBoundaries: true },
  vi: { locale: 'vi', hasWordBoundaries: true },
  th: { locale: 'th', hasWordBoundaries: false },
  id: { locale: 'id', hasWordBoundaries: true },
  ar: { locale: 'ar', hasWordBoundaries: true },
  ar_sa: { locale: 'ar-SA', hasWordBoundaries: true },
  ar_eg: { locale: 'ar-EG', hasWordBoundaries: true },
  ar_iq: { locale: 'ar-IQ', hasWordBoundaries: true },
  ar_lev: { locale: 'ar-LB', hasWordBoundaries: true },
  he: { locale: 'he', hasWordBoundaries: true },
  fa: { locale: 'fa', hasWordBoundaries: true },
  fil: { locale: 'fil', hasWordBoundaries: true },
  sw: { locale: 'sw-KE', hasWordBoundaries: true },
  sw_tz: { locale: 'sw-TZ', hasWordBoundaries: true },
  nb: { locale: 'nb', hasWordBoundaries: true },
  ca: { locale: 'ca', hasWordBoundaries: true },
  ms: { locale: 'ms', hasWordBoundaries: true },
  hr: { locale: 'hr', hasWordBoundaries: true },
  sl: { locale: 'sl', hasWordBoundaries: true },
  uk: { locale: 'uk', hasWordBoundaries: true },
  sr: { locale: 'sr', hasWordBoundaries: true },
  lt: { locale: 'lt', hasWordBoundaries: true },
  lv: { locale: 'lv', hasWordBoundaries: true },
  et: { locale: 'et', hasWordBoundaries: true },
  ta: { locale: 'ta', hasWordBoundaries: true },
  te: { locale: 'te', hasWordBoundaries: true },
};

describe('getCompareConfig', () => {
  it('returns defaults for unknown languages', () => {
    const cfg = getCompareConfig('xx-unknown');
    expect(cfg.locale).toBe('en');
    expect(cfg.hasWordBoundaries).toBe(true);
    expect(cfg.foldCase).toBe(false);
    expect(cfg.foldDiacritics).toBe(false);
    expect(cfg.collapseWhitespace).toBe(true);
  });

  it('returns correct locale for supported languages', () => {
    expect(getCompareConfig('de').locale).toBe('de');
    expect(getCompareConfig('es').locale).toBe('es');
    expect(getCompareConfig('fr').locale).toBe('fr');
  });

  it('flags zh/ja/th as languages without word boundaries', () => {
    expect(getCompareConfig('zh').hasWordBoundaries).toBe(false);
    expect(getCompareConfig('ja').hasWordBoundaries).toBe(false);
    expect(getCompareConfig('th').hasWordBoundaries).toBe(false);
  });

  it('keeps word boundaries enabled for typical languages', () => {
    expect(getCompareConfig('en').hasWordBoundaries).toBe(true);
    expect(getCompareConfig('ko').hasWordBoundaries).toBe(true);
  });

  it('returns the documented locale + word-boundary flag for every supported code', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const cfg = getCompareConfig(lang.code);
      const expected = EXPECTED_COMPARE[lang.code];
      expect(expected, `no expected compare config for code=${lang.code}`).toBeDefined();
      expect(cfg.locale, `locale for ${lang.code}`).toBe(expected.locale);
      expect(cfg.hasWordBoundaries, `hasWordBoundaries for ${lang.code}`).toBe(
        expected.hasWordBoundaries,
      );
    }
  });
});

describe('toDiffOptions', () => {
  it('strips hasWordBoundaries from the config', () => {
    const cfg = getCompareConfig('zh');
    const diff = toDiffOptions(cfg);
    expect('hasWordBoundaries' in diff).toBe(false);
    expect(diff.locale).toBe('zh');
  });

  it('keeps all other diff fields intact', () => {
    const cfg = getCompareConfig('en');
    const diff = toDiffOptions(cfg);
    expect(diff.locale).toBe('en');
    expect(diff.foldCase).toBe(false);
    expect(diff.collapseWhitespace).toBe(true);
  });
});
