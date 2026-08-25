'use client';

/**
 * The single definition of "this word matches the highlighted stat term" and
 * of what a highlight looks like. `highlightWord` (plain text) and
 * `HighlightedRuby` (furigana) both build on these, so the matching rule and
 * the accent styling cannot drift apart between the two renderers.
 */
import type { ReactNode } from 'react';
import { getWordSegmenter } from '@/lib/wordTokenize';

/** The one way a matched term renders, wherever it appears. */
export function HighlightSpan({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span className="font-medium" style={{ color: 'var(--accent-orange)' }}>
      {children}
    </span>
  );
}

/**
 * Per-code-point mask over `text`: true where an `Intl.Segmenter` word piece
 * equals `term` (case-insensitive, NFC). Null when the locale is invalid —
 * callers pick their own fallback (regex for plain text, highlight-less ruby).
 */
export function getWordMatchMask(
  text: string,
  term: string,
  language: string,
): boolean[] | null {
  const target = term.toLowerCase().normalize('NFC');
  if (!target) return null;
  try {
    const segmenter = getWordSegmenter(language);
    const mask: boolean[] = [];
    for (const seg of segmenter.segment(text)) {
      const match =
        (seg.isWordLike ?? false) &&
        seg.segment.toLowerCase().normalize('NFC') === target;
      for (const _ch of seg.segment) mask.push(match);
    }
    return mask;
  } catch {
    return null;
  }
}

/**
 * `text` split at the mask's transitions, matched runs wrapped in
 * `HighlightSpan`. `mask` is indexed by code point and must cover the text.
 */
export function renderMaskedText(
  text: string,
  mask: readonly boolean[],
  keyPrefix = '',
): ReactNode[] {
  const chars = [...text];
  const nodes: ReactNode[] = [];
  let run = '';
  let runMatch: boolean | undefined;
  const flush = () => {
    if (!run) return;
    nodes.push(
      runMatch ? (
        <HighlightSpan key={`${keyPrefix}${nodes.length}`}>{run}</HighlightSpan>
      ) : (
        run
      ),
    );
    run = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const match = mask[i] ?? false;
    if (match !== runMatch) {
      flush();
      runMatch = match;
    }
    run += chars[i];
  }
  flush();
  return nodes;
}
