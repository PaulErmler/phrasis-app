/**
 * Renders parsed furigana segments as <ruby> annotations: kana readings set
 * above each kanji run, plain runs as bare text. Presentation only — parsing
 * and validation live in lib/furigana.ts, and callers pass segments that
 * already survived `parseFurigana`'s reconstruct-the-sentence check.
 *
 * The reading is carried as a `data-reading` attribute and painted by the
 * shared `.has-furigana rt::before { content: attr(data-reading) }` rule in
 * globals.css (which also sizes and colors it so every surface matches).
 * CSS-generated content never enters the document text, so selecting and
 * copying the sentence yields the base text alone — an `<rt>` text node
 * would ride along into the clipboard (毎朝まいあさ…) in every browser,
 * and `user-select: none` is only a hint some engines ignore when copying.
 */
import { Fragment } from 'react';
import { type FuriganaSegment } from '@/lib/furigana';
import {
  getWordMatchMask,
  HighlightSpan,
  renderMaskedText,
} from '@/lib/wordCloud/highlight';

export function Ruby({ segments }: { segments: FuriganaSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.reading === undefined ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <ruby key={i}>
            {seg.text}
            <rt data-reading={seg.reading} />
          </ruby>
        ),
      )}
    </>
  );
}

/**
 * Ruby composed with the word-cloud term highlight (HighlightedText's
 * `highlightTerm`): the sentence renders with its readings AND the matched
 * word in accent-orange, instead of having to pick one. The matching rule
 * and highlight styling are shared with `highlightWord`
 * (lib/wordCloud/highlight) via a per-code-point match mask.
 *
 * Walks the furigana segments against the mask directly: plain runs split
 * at mask transitions exactly like the plain-text renderer, while a ruby
 * unit is atomic — it highlights whole when ANY of its characters match.
 * Unit granularity is the best ruby can do, and it fails toward showing the
 * highlight: a term inside an analyzer compound (予報 in 天気予報[...])
 * lights up the whole compound instead of nothing. The earlier
 * split-by-piece approach lost the highlight entirely whenever the unit
 * landed in a different segmenter piece than the matching term.
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
  const mask = getWordMatchMask(text, term, language);
  // Invalid locale: highlight-less ruby beats no ruby.
  if (mask === null) return <Ruby segments={segments} />;

  // Offsets computed up front (not by mutating a counter inside the render
  // map — the react-compiler lint rejects reassignment from a render closure).
  const placed: Array<{ seg: FuriganaSegment; segMask: boolean[] }> = [];
  for (let offset = 0, i = 0; i < segments.length; i++) {
    const length = [...segments[i].text].length;
    placed.push({
      seg: segments[i],
      segMask: mask.slice(offset, offset + length),
    });
    offset += length;
  }
  return (
    <>
      {placed.map(({ seg, segMask }, i) => {
        if (seg.reading === undefined) {
          return (
            <Fragment key={i}>
              {renderMaskedText(seg.text, segMask, `${i}-`)}
            </Fragment>
          );
        }
        const unit = <Ruby segments={[seg]} />;
        return segMask.some(Boolean) ? (
          <HighlightSpan key={i}>{unit}</HighlightSpan>
        ) : (
          <Fragment key={i}>{unit}</Fragment>
        );
      })}
    </>
  );
}
