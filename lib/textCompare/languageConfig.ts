import type { NormalizeOptions } from './normalize';

/** Subset of CompareConfig that's actually consumed by charDiff/alignWords.
 * Kept separate so callers don't accidentally rely on hasWordBoundaries
 * flowing through those functions (it doesn't — it's a caller-side branch). */
export interface DiffOptions extends Required<
  Pick<NormalizeOptions, 'foldCase' | 'foldDiacritics' | 'collapseWhitespace'>
> {
  /** BCP-47 locale passed to Intl.Segmenter */
  locale: string;
}

export interface CompareConfig extends DiffOptions {
  /** Whether the script uses spaces between words. False for zh/ja/th — falls back to char-level diff for short answers. */
  hasWordBoundaries: boolean;
}

const DEFAULT: CompareConfig = {
  locale: 'en',
  foldCase: false,
  foldDiacritics: false,
  collapseWhitespace: true,
  hasWordBoundaries: true,
};

const PER_LANGUAGE: Record<string, Partial<CompareConfig>> = {
  en: { locale: 'en' },
  en_gb: { locale: 'en-GB' },
  en_us: { locale: 'en-US' },
  en_au: { locale: 'en-AU' },
  de: { locale: 'de' },
  es: { locale: 'es' },
  es_latam: { locale: 'es-419' },
  es_mixed: { locale: 'es' },
  fr: { locale: 'fr' },
  it: { locale: 'it' },
  pt: { locale: 'pt' },
  nl: { locale: 'nl' },
  sv: { locale: 'sv' },
  nb: { locale: 'nb' },
  da: { locale: 'da' },
  fi: { locale: 'fi' },
  pl: { locale: 'pl' },
  sk: { locale: 'sk' },
  ru: { locale: 'ru' },
  el: { locale: 'el' },
  hi: { locale: 'hi' },
  bn: { locale: 'bn' },
  tr: { locale: 'tr' },
  hu: { locale: 'hu' },
  ro: { locale: 'ro' },
  cs: { locale: 'cs' },
  he: { locale: 'he' },
  ar: { locale: 'ar' },
  ar_sa: { locale: 'ar-SA' },
  ar_eg: { locale: 'ar-EG' },
  ar_iq: { locale: 'ar-IQ' },
  ar_lev: { locale: 'ar-LB' },
  sw: { locale: 'sw-KE' },
  sw_tz: { locale: 'sw-TZ' },
  ko: { locale: 'ko' },
  vi: { locale: 'vi' },
  id: { locale: 'id' },
  zh: { locale: 'zh', hasWordBoundaries: false },
  zh_traditional: { locale: 'zh-TW', hasWordBoundaries: false },
  yue: { locale: 'yue-Hans-HK', hasWordBoundaries: false },
  yue_traditional: { locale: 'yue-Hant-HK', hasWordBoundaries: false },
  ja: { locale: 'ja', hasWordBoundaries: false },
  th: { locale: 'th', hasWordBoundaries: false },
};

export function getCompareConfig(languageCode: string): CompareConfig {
  return { ...DEFAULT, ...(PER_LANGUAGE[languageCode] ?? {}) };
}

/** Strip hasWordBoundaries before passing to charDiff/alignWords so option
 * shapes match exactly. */
export function toDiffOptions(cfg: CompareConfig): DiffOptions {
  const { hasWordBoundaries: _ignored, ...rest } = cfg;
  return rest;
}
