type Granularity = 'grapheme' | 'word' | 'sentence';

// Segmenter construction is measurable on hot paths (review writes,
// migrations, edit flows). Cache per locale + granularity.
const cache = new Map<string, Intl.Segmenter>();

export function getSegmenter(
  locale: string,
  granularity: Granularity,
): Intl.Segmenter {
  const key = `${locale}|${granularity}`;
  let seg = cache.get(key);
  if (!seg) {
    seg = new Intl.Segmenter(locale, { granularity });
    cache.set(key, seg);
  }
  return seg;
}

export function segmentGraphemes(
  input: string,
  locale: string = 'en',
): string[] {
  const out: string[] = [];
  for (const { segment } of getSegmenter(locale, 'grapheme').segment(input)) {
    out.push(segment);
  }
  return out;
}

export interface WordToken {
  text: string;
  isWord: boolean;
}

export function segmentWords(
  input: string,
  locale: string = 'en',
): WordToken[] {
  const out: WordToken[] = [];
  for (const { segment, isWordLike } of getSegmenter(locale, 'word').segment(
    input,
  )) {
    out.push({ text: segment, isWord: !!isWordLike });
  }
  return out;
}
