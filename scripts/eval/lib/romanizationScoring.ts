import { damerauLevenshtein } from '../../../lib/textCompare/editDistance';

/**
 * Scoring for `pnpm eval:rom`.
 *
 * Gold and engine disagree on notation without disagreeing on the word, and
 * exact string equality would score those as total failures and tell us
 * nothing. So the scorer folds away the conventions that carry no claim about
 * pronunciation, then reports edit distance.
 *
 * Every fold here was found by auditing real mismatches, and each was worth
 * points that had been attributed to the engines rather than to this file.
 */

/**
 * Syllable separators. Romanization systems disagree about them without
 * disagreeing about sound: Revised Romanization writes geugeo or geu-geo,
 * Hebrew marks a shva as b'seder or beseder, Pinyin joins a word as tāmen or
 * spaces it as tā men. None of that is a pronunciation claim.
 */
const SEPARATORS = /[-‑'`‘’ʼ]/g;

/** Punctuation the gold sometimes kept (a Korean row had a question mark). */
const PUNCTUATION = /[.,!?;:"()[\]]/g;

/** Case-folded, separators normalized to one space, punctuation dropped. */
export function canonicalize(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .replace(PUNCTUATION, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tone and length diacritics removed. The gap between the diacritic-preserving
 * score and this one separates "wrong syllables" from "right syllables, wrong
 * tones", which are different problems with different fixes.
 */
export function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');
}

/**
 * Edit distance over the longer string's length: 0 identical, 1 disjoint.
 *
 * Uses the repo's `damerauLevenshtein`, which splits with `Array.from` and so
 * counts by code point rather than UTF-16 unit — necessary here, since a
 * romanization is full of combining marks that a code-unit walk would charge
 * twice.
 */
function normalizedDistance(a: string, b: string): number {
  const longest = Math.max([...a].length, [...b].length);
  return longest === 0 ? 0 : damerauLevenshtein(a, b) / longest;
}

/**
 * Similarity, scored the more forgiving of two ways: separators normalized,
 * and separators removed entirely. The separator question has no single right
 * answer across systems, so the benchmark does not pick a side.
 */
function similarity(gold: string, got: string): number {
  const spaced = 1 - normalizedDistance(gold, got);
  const joined =
    1 - normalizedDistance(gold.replace(/\s+/g, ''), got.replace(/\s+/g, ''));
  return Math.max(spaced, joined);
}

export type RomanizationScore = {
  /** 1 - edit distance against the closest accepted reading. */
  similarity: number;
  /** The same with tone and length diacritics stripped. */
  baseSimilarity: number;
  /** Matched an accepted reading outright after normalization. */
  exact: boolean;
};

/**
 * Score `got` against every romanization the row accepts, taking the best.
 *
 * A gold row carries more than one accepted form for two reasons, and both
 * exist so the benchmark measures pronunciation rather than convention:
 * an ambiguous headword has several attested readings (Arabic كيف حالك is
 * masculine -ka or feminine -ki), and a source's own scholarly form is as
 * correct as the learner-facing one (Arabic gold strips Wiktionary's macrons
 * to kitab, but kitāb is right and Arabic vowel length is phonemic).
 */
export function scoreRomanization(
  accepted: readonly string[],
  got: string,
): RomanizationScore {
  const candidate = canonicalize(got);
  const options = accepted.map(canonicalize).filter((o) => o.length > 0);
  if (options.length === 0 || candidate.length === 0) {
    return { similarity: 0, baseSimilarity: 0, exact: false };
  }
  let best = { similarity: -1, baseSimilarity: 0, exact: false };
  for (const option of options) {
    const value = similarity(option, candidate);
    if (value > best.similarity) {
      best = {
        similarity: value,
        baseSimilarity: similarity(
          stripDiacritics(option),
          stripDiacritics(candidate),
        ),
        exact: option === candidate,
      };
    }
  }
  return best;
}
