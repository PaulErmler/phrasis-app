/**
 * Generic text-comparison utilities used for TTS validation and
 * potentially other fuzzy-match scenarios.
 */

/**
 * Strip punctuation, collapse whitespace, lowercase — so that minor
 * transcription differences (e.g. period vs no period) don't cause
 * a false mismatch.
 */
export function normalizeForComparison(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein edit-distance between two strings.
 * O(n*m) — fine for short sentences.
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
