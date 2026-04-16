/**
 * Synchronous, in-process romanization for languages whose script we can
 * convert to Latin without a network call. Used both by `romanizeText`
 * (to avoid round-tripping to Google) and by TTS validation (so strict
 * hanzi/hangul/Greek comparisons can tolerate homophone swaps and
 * diacritic drift introduced by Scribe).
 *
 * Returns `null` for languages that require Google Cloud romanization.
 */

import { convert as romanizeHangul } from 'hangul-romanization';
// @ts-expect-error no type declarations for chinese-to-pinyin
import pinyin from 'chinese-to-pinyin';
// @ts-expect-error no type declarations for greek-utils
import greekUtils from 'greek-utils';

/** Languages we can romanize locally without a network call. */
export const LOCAL_ROMANIZATION_LANGUAGES = new Set(['zh', 'el', 'ko']);

export function hasLocalRomanization(code: string): boolean {
  return LOCAL_ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Subset of local-romanization languages where romanizing BEFORE strict
 * TTS comparison is worthwhile. Chinese and Korean benefit because Scribe
 * often returns a homophone character with identical/near-identical
 * romanization; Greek is excluded because the hanzi/hangul ambiguity
 * doesn't apply — Greek orthography is already closely phonetic.
 */
export const TTS_ROMANIZATION_LANGUAGES = new Set(['zh', 'ko']);

export function useRomanizationForTtsMatch(code: string): boolean {
  return TTS_ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Romanize `text` in `language` using a local library.
 * Returns `null` when the language has no local romanizer — the caller must
 * fall back to a remote romanization API.
 */
export function romanizeLocal(text: string, language: string): string | null {
  if (language === 'zh') return pinyin(text) as string;
  if (language === 'el') return greekUtils.toPhoneticLatin(text);
  if (language === 'ko') return romanizeHangul(text);
  return null;
}
