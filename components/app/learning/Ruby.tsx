/**
 * Renders parsed furigana segments as <ruby> annotations: kana readings set
 * above each kanji run, plain runs as bare text. Presentation only — parsing
 * and validation live in lib/furigana.ts, and callers pass segments that
 * already survived `parseFurigana`'s reconstruct-the-sentence check.
 *
 * `<rt>` carries no font-size here; the shared `.furigana-ruby` class in
 * globals.css sizes and colors readings so every surface matches.
 */
import { Fragment } from 'react';
import { splitFuriganaByRanges, type FuriganaSegment } from '@/lib/furigana';
import { getWordSegmenter } from '@/lib/wordTokenize';

export function Ruby({ segments }: { segments: FuriganaSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.reading === undefined ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <ruby key={i}>
            {seg.text}
            <rt>{seg.reading}</rt>
          </ruby>
        ),
      )}
    </>
  );
}

/**
 * Ruby composed with the word-cloud term highlight (HighlightedText's
 * `highlightTerm`): the sentence renders with its readings AND the matched
 * word in accent-orange, instead of having to pick one. Splits the furigana
 * segments at Intl.Segmenter word boundaries (mirroring `highlightWord` in
 * lib/wordCloud) and wraps matching words. Ruby units are atomic, so a unit
 * spanning a boundary stays whole in the piece containing its start and the
 * following piece renders its (possibly empty) remainder — never duplicated.
 */
export function HighlightedRuby({
  segments,
  text,
  language,
  term,
}: {
  segments: FuriganaSegment[];
  /** The sentence the segments reconstruct (parseFurigana already checked). */
  text: string;
  language: string;
  term?: string;
}) {
  if (!term) return <Ruby segments={segments} />;
  const target = term.toLowerCase().normalize('NFC');
  let pieces: { text: string; match: boolean }[];
  try {
    const segmenter = getWordSegmenter(language);
    pieces = [...segmenter.segment(text)].map((seg) => ({
      text: seg.segment,
      match:
        (seg.isWordLike ?? false) &&
        seg.segment.toLowerCase().normalize('NFC') === target,
    }));
  } catch {
    // Invalid locale: highlight-less ruby beats no ruby.
    return <Ruby segments={segments} />;
  }
  const chunks = splitFuriganaByRanges(
    segments,
    pieces.map((piece) => [...piece.text].length),
  );
  return (
    <>
      {pieces.map((piece, i) =>
        piece.match ? (
          <span
            key={i}
            className="font-medium"
            style={{ color: 'var(--accent-orange)' }}
          >
            <Ruby segments={chunks[i]} />
          </span>
        ) : (
          <Fragment key={i}>
            <Ruby segments={chunks[i]} />
          </Fragment>
        ),
      )}
    </>
  );
}
