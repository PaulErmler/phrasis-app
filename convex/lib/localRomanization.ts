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
import { transliterate as transliterateHebrew } from 'hebrew-transliteration';
import { getLshk } from 'cantonese-romanisation';
// @ts-expect-error no type declarations for arabic-transliterate (pure JS, ~74KB, zero deps)
import arabictransliterate from 'arabic-transliterate';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';

/**
 * Languages we can romanize locally without a network call. Derived from each
 * Language's `romanizationBackend === 'local'` flag (single source of truth in
 * lib/languages.ts); languages on `'google-v3'` (ru/hi/bn/ja) are excluded.
 *
 * Arabic was moved here off the Google v3 path after a regression where the
 * romanizeText endpoint started returning `{"romanizations":[{}]}` for short
 * Arabic strings (200 OK, empty entry — the Vyshantha/arabic-transliterate
 * library produces a deterministic IJMES romanization with zero deps, fine
 * for the Convex V8 runtime).
 */
export const LOCAL_ROMANIZATION_LANGUAGES = new Set(
  SUPPORTED_LANGUAGES.filter((l) => l.romanizationBackend === 'local').map(
    (l) => l.code,
  ),
);

export function hasLocalRomanization(code: string): boolean {
  return LOCAL_ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Stable identifiers for each romanization backend. Persisted on rows
 * alongside `romanizedText` so a future strategy swap can find rows
 * produced by the old method (`romanizationSource != currentSource`) and
 * regenerate them. Bump the `-v<n>` suffix when changing the library OR
 * its configuration in a way that should invalidate existing rows.
 */
export const ROMANIZATION_SOURCES = {
  chineseToPinyin: 'chinese-to-pinyin-v1',
  greekUtils: 'greek-utils-v1',
  hangulRomanization: 'hangul-romanization-v1',
  hebrewTransliteration: 'hebrew-transliteration-v1',
  cantoneseRomanisation: 'cantonese-romanisation-v1',
  arabicTransliterate: 'arabic-transliterate-v1',
  googleV3: 'google-v3-v1',
} as const;

export type RomanizationSource =
  (typeof ROMANIZATION_SOURCES)[keyof typeof ROMANIZATION_SOURCES];

/**
 * Resolve the source identifier we'll use (or just used) for a language.
 * Mirrors the routing in `romanizeLocal` + `romanizeText` so callers can
 * record the source alongside the result without coupling to the function
 * internals.
 */
export function getRomanizationSource(language: string): RomanizationSource {
  if (language === 'zh' || language === 'zh_traditional') {
    return ROMANIZATION_SOURCES.chineseToPinyin;
  }
  if (language === 'el') return ROMANIZATION_SOURCES.greekUtils;
  if (language === 'ko') return ROMANIZATION_SOURCES.hangulRomanization;
  if (language === 'he') return ROMANIZATION_SOURCES.hebrewTransliteration;
  if (language === 'yue' || language === 'yue_traditional') {
    return ROMANIZATION_SOURCES.cantoneseRomanisation;
  }
  if (
    language === 'ar' ||
    language === 'ar_sa' ||
    language === 'ar_eg' ||
    language === 'ar_iq' ||
    language === 'ar_lev'
  ) {
    return ROMANIZATION_SOURCES.arabicTransliterate;
  }
  // Everything else in ROMANIZATION_LANGUAGES (ru, hi, ja, bn) routes
  // through Google v3 — see `romanizeText` in convex/features/translation.ts.
  return ROMANIZATION_SOURCES.googleV3;
}

/**
 * Subset of local-romanization languages where romanizing BEFORE strict
 * TTS comparison is worthwhile. Chinese (Simplified + Traditional) and Korean
 * benefit because Scribe often returns a homophone character with
 * identical/near-identical romanization; Greek is excluded because the
 * hanzi/hangul ambiguity doesn't apply — Greek orthography is already closely
 * phonetic.
 */
export const TTS_ROMANIZATION_LANGUAGES = new Set([
  'zh', 'zh_traditional', 'ko',
]);

export function shouldRomanizeForTtsMatch(code: string): boolean {
  return TTS_ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Romanize `text` in `language` using a local library.
 * Returns `null` when the language has no local romanizer — the caller must
 * fall back to a remote romanization API.
 */
export function romanizeLocal(text: string, language: string): string | null {
  if (language === 'zh' || language === 'zh_traditional') {
    return pinyin(text) as string;
  }
  if (language === 'el') return greekUtils.toPhoneticLatin(text);
  if (language === 'ko') return romanizeHangul(text);
  if (language === 'he') return transliterateHebrew(text);
  if (language === 'yue' || language === 'yue_traditional') {
    return romanizeCantonese(text);
  }
  if (
    language === 'ar' ||
    language === 'ar_sa' ||
    language === 'ar_eg' ||
    language === 'ar_iq' ||
    language === 'ar_lev'
  ) {
    // IJMES Arabic→Latin transliteration. The library treats all dialects as
    // the same script (it operates on the Arabic Unicode block), so the
    // dialect tail of the code is irrelevant here. Pass language='Arabic'
    // (the library's switch key, NOT the BCP-47 tag).
    return arabictransliterate(text, 'arabic2latin', 'Arabic') as string;
  }
  return null;
}

/**
 * Convert a Cantonese string to LSHK / Jyutping notation. The
 * `cantonese-romanisation` library returns one array of candidate readings
 * per input codepoint (e.g. `[["ng4"], ["oi2", "ngoi2"], ["ji4"]]`). We pick
 * the first reading per codepoint and pass non-Han characters (punctuation,
 * spaces, Latin) through unchanged so the result reads like prose.
 *
 * Consecutive non-Han codepoints are coalesced into a single segment so
 * Latin runs and digits keep their internal spacing (e.g. "你好abc 123" →
 * "nei5 hou2 abc 123", not "nei5 hou2 a b c 1 2 3").
 *
 * The library's lookup table is traditional-character oriented; simplified
 * Cantonese (`yue`) will hit gaps and fall through to the raw character. For
 * traditional Cantonese (`yue_traditional`) coverage is good.
 */
function romanizeCantonese(text: string): string {
  // Treat the string as an array of Unicode codepoints (handles surrogate
  // pairs correctly for rare characters).
  const codepoints = Array.from(text);
  const readings = getLshk(text) as string[][];

  const segments: string[] = [];
  let buffer = '';
  for (let i = 0; i < codepoints.length; i++) {
    const reading = readings[i]?.[0];
    if (reading && reading.length > 0) {
      // Flush any pending non-Han run before emitting the Jyutping syllable.
      if (buffer.length > 0) {
        segments.push(buffer);
        buffer = '';
      }
      segments.push(reading);
    } else {
      // Empty array → no Jyutping known for this codepoint; buffer it so
      // adjacent non-Han codepoints stay glued together.
      buffer += codepoints[i];
    }
  }
  if (buffer.length > 0) segments.push(buffer);

  return segments
    .join(' ')
    .replace(/\s+([,.!?;:、。！？；：])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
