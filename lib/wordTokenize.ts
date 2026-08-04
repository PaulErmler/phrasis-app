import { getSegmenter } from './textCompare/segment';
import { getLanguageByCode } from './languages';

export type Token = { normalized: string; original: string };

/**
 * A word is "all lowercase" if lowercasing it is a no-op. Used to decide
 * which casing variant to keep as the display form: if we've ever seen
 * the word in all-lowercase form, prefer that (covers English "the" at
 * sentence start being downgraded from "The"). Words that never appear
 * lowercase — German nouns, proper nouns — keep their capitalized form.
 */
export function isAllLowercase(s: string): boolean {
  return s === s.toLowerCase();
}

// Segmenter construction is measurable on hot paths (review writes,
// migrations, edit flows) — `getSegmenter` caches per normalized BCP-47 tag.
export function getWordSegmenter(language: string): Intl.Segmenter {
  // Internal codes are not BCP-47: `zh_traditional` → "zh-traditional" has a
  // variant subtag over 8 chars, so Intl.Segmenter throws RangeError and the
  // caller's fallback treats the whole sentence as one token. The registry's
  // `compareLocale` (zh-TW, yue-Hant-HK, …) is the valid tag for exactly this
  // purpose; only underscore-normalize codes that don't carry one.
  const bcp47 =
    getLanguageByCode(language)?.compareLocale ?? language.replace(/_/g, '-');
  return getSegmenter(bcp47, 'word');
}

/**
 * For languages written without word boundaries (zh/ja/yue/th — see
 * `hasWordBoundaries` in lib/languages.ts), append the Intl.Segmenter word
 * tokens to the text so whitespace/punctuation-tokenized search engines
 * (Convex full-text search) can match words in the middle of a sentence.
 * The original text is kept in front so anything that matched before keeps
 * matching. No-op for space-delimited languages.
 */
export function appendSearchSegments(text: string, language: string): string {
  const segments = searchSegments(text, language);
  if (segments.length === 0) return text;
  return `${text} ${segments.join(' ')}`;
}

/**
 * Deduped Intl.Segmenter word tokens for a language written without word
 * boundaries; empty for space-delimited languages. Single source of the
 * no-boundary guard + dedupe, shared by the index side
 * (`appendSearchSegments`) and the query side (`augmentSearchQuery` in
 * convex/features/library.ts) so the two can never segment differently.
 */
export function searchSegments(text: string, language: string): string[] {
  if (getLanguageByCode(language)?.hasWordBoundaries !== false) {
    return [];
  }
  return [...new Set(tokenizeText(text, language).map((t) => t.original))];
}

export function tokenizeText(text: string, language: string): Token[] {
  const nfc = text.normalize('NFC');
  try {
    const segmenter = getWordSegmenter(language);
    return [...segmenter.segment(nfc)]
      .filter((seg) => seg.isWordLike)
      .map((seg) => ({
        original: seg.segment,
        normalized: seg.segment.toLowerCase().normalize('NFC'),
      }));
  } catch {
    // Unknown/invalid BCP-47 tag — fall back to a Unicode-letter split so a
    // bad language code never crashes a deck save. Behaviour is correct for
    // Latin-script languages; imperfect but non-fatal for others.
    return [...nfc.matchAll(/\p{L}[\p{L}\p{M}\p{N}'’-]*/gu)].map((m) => ({
      original: m[0],
      normalized: m[0].toLowerCase().normalize('NFC'),
    }));
  }
}
