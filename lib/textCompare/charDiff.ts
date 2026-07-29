import { diffArrays } from 'diff';
import {
  normalize,
  isPunctuationOnly,
  type NormalizeOptions,
} from './normalize';
import { segmentGraphemes } from './segment';
import { damerauLevenshtein } from './editDistance';

export type CharChunkKind = 'equal' | 'added' | 'removed';

export interface CharChunk {
  kind: CharChunkKind;
  text: string;
  /** Set on a mismatched chunk that is pure punctuation while
   * `ignorePunctuation` is on — it didn't affect the accuracy, so the UI
   * renders it neutrally instead of as an error. */
  ignored?: boolean;
}

export interface CharDiffResult {
  chunks: CharChunk[];
  /** 0–1, based on Damerau–Levenshtein over normalized graphemes */
  accuracy: number;
}

export interface CharDiffOptions extends NormalizeOptions {
  locale?: string;
}

export function charDiff(
  expected: string,
  actual: string,
  opts: CharDiffOptions = {},
): CharDiffResult {
  const locale = opts.locale ?? 'en';

  // Render diff against original (un-folded) text so the UI shows what the user
  // actually typed and what was actually expected. Accuracy uses normalized form.
  const expectedRender = expected.normalize('NFC');
  const actualRender = actual.normalize('NFC');

  const expectedGraphemes = segmentGraphemes(expectedRender, locale);
  const actualGraphemes = segmentGraphemes(actualRender, locale);

  const changes = diffArrays(expectedGraphemes, actualGraphemes);
  const chunks: CharChunk[] = changes.map((c) => {
    const kind: CharChunkKind = c.added
      ? 'added'
      : c.removed
        ? 'removed'
        : 'equal';
    const text = c.value.join('');
    const ignored =
      opts.ignorePunctuation && kind !== 'equal' && isPunctuationOnly(text);
    return ignored ? { kind, text, ignored: true } : { kind, text };
  });

  const expectedNorm = segmentGraphemes(normalize(expected, opts), locale);
  const actualNorm = segmentGraphemes(normalize(actual, opts), locale);
  const distance = damerauLevenshtein(expectedNorm, actualNorm);
  const denom = Math.max(expectedNorm.length, actualNorm.length);
  const accuracy =
    denom === 0
      ? actual.length === 0
        ? 1
        : 0
      : Math.max(0, 1 - distance / denom);

  return { chunks, accuracy };
}
