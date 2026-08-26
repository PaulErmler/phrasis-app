/**
 * Generic text-comparison utilities used for TTS validation and
 * potentially other fuzzy-match scenarios.
 */

import {
  romanizeLocal,
  shouldRomanizeForTtsMatch,
} from './localRomanization';

// Moved to lib/textCompare/normalize.ts so the client's local writing gate
// (lib/textCompare/bestMatch.ts) shares the exact same normalization;
// re-exported here so server callers keep their import site.
import { normalizeForComparison } from '../../lib/textCompare/normalize';
export { normalizeForComparison };

/**
 * Punctuation that is SILENT when a sentence is spoken aloud: sentence
 * separators/terminators (periods, commas, colons, Arabic ، ؛ ۔, CJK
 * 。、 and fullwidth forms), quotes, brackets, dashes, and '_' runs.
 * Any punctuation NOT listed here counts as audible, so unknown marks
 * fail safe toward "sounds different" (an unneeded audio regeneration)
 * rather than keeping stale audio. '%' ("Prozent"), '&' ("und"), '#',
 * '@' are all \p{Po} and must stay audible. Notably absent: '?' '؟'
 * and friends (statement→question flips intonation) and ';'. U+037E
 * GREEK QUESTION MARK NFC-normalizes to ';' (U+003B), so listing
 * semicolons would make Greek questions sound like statements (an
 * English 'a; b' edit regenerating audio is the cheap trade-off).
 * '¡'/'¿' ARE listed. The closing mark decides the intonation, so
 * '¿Cómo estás?' must equal 'Cómo estás?'; '!' is treated as spoken
 * the same as a period.
 */
const INAUDIBLE_PUNCTUATION = /[.,!¡¿،؛۔。、．，…:·'"‘’“”„‚«»‹›()[\]{}\-–—_~]/u;

/**
 * True when two versions of a sentence sound identical spoken aloud:
 * they differ only in inaudible punctuation (e.g. '_' runs, commas,
 * periods, Arabic ، ۔) and/or whitespace runs. Deliberately narrower
 * than `normalizeForComparison`: keeps case and symbols (`\p{S}`, "€"
 * is pronounced), keeps punctuation outside the INAUDIBLE allowlist
 * (question marks change intonation; '%'/'&' are pronounced), and
 * keeps punctuation between two digits ('3.5' vs '35' reads
 * differently. The flip side is that '1,000' vs '1000' also counts
 * as different and regenerates audio it didn't need to, the
 * cheap-and-safe direction).
 *
 * Used to decide whether a translation-text change needs its audio
 * regenerated (editCard, flagTranslation retranslation, and the
 * trailing-underscore backfill all produce punctuation-only diffs).
 */
export function soundsSame(a: string, b: string): boolean {
  const normalize = (text: string) =>
    text
      .normalize('NFC')
      .replace(/\p{P}/gu, (mark, i: number, s: string) =>
        !INAUDIBLE_PUNCTUATION.test(mark) ||
        (/\d/.test(s[i - 1] ?? '') && /\d/.test(s[i + 1] ?? ''))
          ? mark
          : '',
      )
      .replace(/\s+/g, ' ')
      .trim();
  return normalize(a) === normalize(b);
}

/**
 * Levenshtein edit-distance between two strings.
 * O(n*m), fine for short sentences.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

const MAX_EDIT_DISTANCE = 1;

/**
 * Fuzzy comparison: accept if the normalized texts are identical
 * or differ by at most 1 character (edit distance).
 */
export function textsMatch(original: string, transcribed: string): boolean {
  const a = normalizeForComparison(original);
  const b = normalizeForComparison(transcribed);
  if (a === b) return true;

  return levenshtein(a, b) <= MAX_EDIT_DISTANCE;
}

/**
 * Language-aware strict comparison.
 *
 * For Chinese and Korean (languages with a local romanizer and where Scribe
 * commonly produces homophone-character substitutions), romanize both sides
 * before comparing. A hanzi homophone swap, e.g. 在 vs 再, 他 vs 她. Maps
 * to the same pinyin and matches at edit distance 0.
 *
 * For all other languages, falls back to comparing the raw strings.
 *
 * `compare` decides what "match" means at the leaves: the default is the
 * TTS-validation `textsMatch` (≤1 edit tolerant); the writing grader's gate
 * passes exact-normalized equality instead (writingAnswersMatch). The
 * romanize-both-sides flow lives ONLY here so the zh/ko homophone rule can't
 * drift between the two callers.
 */
export function textsMatchForLanguage(
  original: string,
  transcribed: string,
  language: string,
  compare: (a: string, b: string) => boolean = textsMatch,
): boolean {
  if (shouldRomanizeForTtsMatch(language)) {
    const a = romanizeLocal(original, language);
    const b = romanizeLocal(transcribed, language);
    if (a !== null && b !== null) {
      return compare(a, b);
    }
  }
  return compare(original, transcribed);
}
