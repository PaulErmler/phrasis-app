import { getLanguageByCode } from './languages';
import { getWordSegmenter } from './wordTokenize';

/**
 * Pairing a sentence's words with the units of its annotation lines, for the
 * interlinear stack the card can expand under a sentence.
 *
 * The app stores each aid as ONE STRING, not as pairs, so alignment has to be
 * recovered here. That is only sound when the unit count matches the word
 * count, which is exactly what the gloss prompt demands and the eval measures
 * (100% on the shipped model for spaced languages). Where it does not match,
 * this returns nothing for that aid rather than guessing: a mapping that pairs
 * the wrong words is worse than no mapping, because the reader cannot tell.
 *
 * The real fix is for the model to return the pairs instead of a string, which
 * would make this exact for every language including the ones written without
 * spaces. Until then this is the honest half.
 */

/** One column of the stack: a word and whatever aligned under it. */
export type AlignedWord = {
  source: string;
  romanization?: string;
  hyperliteral?: string;
  ipa?: string;
};

export type AlignmentInput = {
  text: string;
  language: string;
  romanization?: string;
  hyperliteral?: string;
  ipa?: string;
  /**
   * The gloss as per-word pairs, when the row has them. These SUPERSEDE the
   * recovered split: the model segmented the sentence itself, so they are
   * exact where splitting on spaces is a guess and, for a language written
   * without spaces, impossible. Thai `สบายดี ขอบใจนะ!` is the case that
   * forced this: two space-separated tokens, four gloss units, no way to pair
   * them from the strings alone.
   */
  hyperliteralPairs?: readonly { source: string; gloss: string }[];
};

type AidKey = 'romanization' | 'hyperliteral' | 'ipa';
const AIDS: readonly AidKey[] = ['romanization', 'hyperliteral', 'ipa'];

/**
 * The sentence's words as a reader sees them.
 *
 * A language written with spaces splits on whitespace and keeps punctuation
 * attached, because that is the unit the model was asked to gloss. One written
 * without spaces (Japanese, Chinese, Cantonese, Thai) has no such unit, so the
 * Intl segmenter supplies one — it will not always agree with how the model
 * split the sentence, and when it does not, the count check below drops the
 * aid rather than pairing the wrong things.
 */
export function sentenceWords(text: string, language: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (getLanguageByCode(language)?.hasWordBoundaries !== false) {
    return trimmed.split(/\s+/);
  }
  try {
    return [...getWordSegmenter(language).segment(trimmed)]
      .filter((seg) => seg.segment.trim().length > 0)
      .map((seg) => seg.segment);
  } catch {
    return [trimmed];
  }
}

/** An aid's units, or null when it is absent or is the failure sentinel. */
function units(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.split(/\s+/);
}

/**
 * The stack's columns, or `null` when no aid aligns and there is nothing to
 * show. An aid whose unit count differs from the word count is left out of
 * every column; the others still pair.
 */
export function alignAnnotations(input: AlignmentInput): AlignedWord[] | null {
  // The model's own segmentation when it gave one; otherwise recover a split
  // from the sentence and hope the counts agree.
  const pairs =
    input.hyperliteral === undefined ? undefined : input.hyperliteralPairs;
  const words =
    pairs && pairs.length > 0
      ? pairs.map((p) => p.source)
      : sentenceWords(input.text, input.language);
  if (words.length === 0) return null;

  const aligned: Partial<Record<AidKey, string[]>> = {};
  if (pairs && pairs.length > 0) {
    // Exact by construction; no count check to pass.
    aligned.hyperliteral = pairs.map((p) => p.gloss);
  }
  for (const aid of AIDS) {
    if (aligned[aid] !== undefined) continue;
    const parts = units(input[aid]);
    if (parts !== null && parts.length === words.length) aligned[aid] = parts;
  }
  if (Object.keys(aligned).length === 0) return null;

  return words.map((source, i) => {
    const column: AlignedWord = { source };
    for (const aid of AIDS) {
      const parts = aligned[aid];
      if (parts) column[aid] = parts[i];
    }
    return column;
  });
}

/**
 * Whether the card should offer the mapping control at all. Same question as
 * `alignAnnotations`, asked without building the columns, so a card can decide
 * whether to render the button without doing the work twice.
 */
export function canAlign(input: AlignmentInput): boolean {
  return alignAnnotations(input) !== null;
}
