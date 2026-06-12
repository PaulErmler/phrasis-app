import type { NormalizeOptions } from './normalize';
import { SUPPORTED_LANGUAGES } from '../languages';

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

// Derived from each Language's `compareLocale` + `hasWordBoundaries` fields
// (single source of truth in lib/languages.ts). `locale` defaults to the
// internal code when `compareLocale` is unset; `hasWordBoundaries` is only set
// when a language opts out (zh/ja/th/yue — no spaces between words).
const PER_LANGUAGE: Record<string, Partial<CompareConfig>> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => {
    const cfg: Partial<CompareConfig> = { locale: l.compareLocale ?? l.code };
    if (l.hasWordBoundaries === false) cfg.hasWordBoundaries = false;
    return [l.code, cfg];
  }),
);

export function getCompareConfig(languageCode: string): CompareConfig {
  return { ...DEFAULT, ...(PER_LANGUAGE[languageCode] ?? {}) };
}

/** Strip hasWordBoundaries before passing to charDiff/alignWords so option
 * shapes match exactly. */
export function toDiffOptions(cfg: CompareConfig): DiffOptions {
  const { hasWordBoundaries: _ignored, ...rest } = cfg;
  return rest;
}
