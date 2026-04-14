import type { NormalizeOptions } from './normalize';

export interface CompareConfig extends Required<
  Pick<NormalizeOptions, 'foldCase' | 'foldDiacritics' | 'collapseWhitespace'>
> {
  /** BCP-47 locale passed to Intl.Segmenter */
  locale: string;
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
  de: { locale: 'de' },
  es: { locale: 'es' },
  fr: { locale: 'fr' },
  it: { locale: 'it' },
  pt: { locale: 'pt' },
  nl: { locale: 'nl' },
  pl: { locale: 'pl' },
  ru: { locale: 'ru' },
  el: { locale: 'el' },
  hi: { locale: 'hi' },
  ar: { locale: 'ar' },
  ko: { locale: 'ko' },
  zh: { locale: 'zh', hasWordBoundaries: false },
  ja: { locale: 'ja', hasWordBoundaries: false },
  th: { locale: 'th', hasWordBoundaries: false },
};

export function getCompareConfig(languageCode: string): CompareConfig {
  return { ...DEFAULT, ...(PER_LANGUAGE[languageCode] ?? {}) };
}
