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
// migrations, edit flows). Cache per normalized BCP-47 tag.
const segmenterCache = new Map<string, Intl.Segmenter>();
export function getWordSegmenter(language: string): Intl.Segmenter {
  // `es_latam` and similar underscore-separated tags aren't valid BCP-47;
  // Intl.Segmenter would throw. Normalize to hyphens.
  const bcp47 = language.replace(/_/g, '-');
  let s = segmenterCache.get(bcp47);
  if (!s) {
    s = new Intl.Segmenter(bcp47, { granularity: 'word' });
    segmenterCache.set(bcp47, s);
  }
  return s;
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
