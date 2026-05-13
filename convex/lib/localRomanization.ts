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

/** Languages we can romanize locally without a network call. */
export const LOCAL_ROMANIZATION_LANGUAGES = new Set([
  'zh', 'zh_traditional',
  'yue', 'yue_traditional',
  'el', 'ko', 'he',
]);

export function hasLocalRomanization(code: string): boolean {
  return LOCAL_ROMANIZATION_LANGUAGES.has(code);
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
