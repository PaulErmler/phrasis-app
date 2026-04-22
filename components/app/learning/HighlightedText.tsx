'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  alignWordTimings,
  findCurrentIndex,
  matchRatio,
  normalise,
} from '@/lib/audio/alignTimings';
import { highlightWord } from '@/lib/wordCloud';
import type { WordTiming } from './types';

interface Props {
  /** Canonical source text — this is what the user always sees. */
  text: string;
  /** Per-word timings from Scribe's transcription. Null/empty → plain text. */
  wordTimings: WordTiming[] | null | undefined;
  /** Time in seconds within THIS clip (already offset by the clip's cue start). */
  localTime: number;
  /** True when the merged audio is currently playing THIS clip. */
  isActive: boolean;
  /** User setting — when false, always render plain text. */
  enabled: boolean;
  className?: string;
  /**
   * Optional search term (e.g. the word a user tapped in the word cloud) to
   * persistently mark in accent-orange. The marked word stays orange whether
   * audio is playing or not; when karaoke reaches it, the blue current-word
   * highlight wins for that single span and orange resumes once playback
   * passes it.
   */
  highlightTerm?: string;
}

/**
 * If fewer than this fraction of real-text tokens matched Scribe's output the
 * alignment is unreliable (likely a non-whitespace-delimited script or a
 * mis-transcribed clip). Fall back to showing plain text — we'd rather show
 * no highlight than a desynced one.
 */
const MIN_MATCH_RATIO = 0.5;

/**
 * Karaoke-style text: the current word is primary-coloured, every other word
 * renders as plain default text — same as before play and after the audio
 * ends, so the rendered output is identical in those two states. Always
 * renders the canonical text from the database; Scribe's timings are aligned
 * onto those tokens but never shown directly, so transcription drift can't
 * change what the user reads.
 */
export function HighlightedText({
  text,
  wordTimings,
  localTime,
  isActive,
  enabled,
  className,
  highlightTerm,
}: Props) {
  const aligned = useMemo(
    () => alignWordTimings(text, wordTimings),
    [text, wordTimings],
  );
  const canHighlight = useMemo(
    () =>
      !!wordTimings &&
      wordTimings.length > 0 &&
      matchRatio(aligned) >= MIN_MATCH_RATIO,
    [wordTimings, aligned],
  );

  const currentIndex = useMemo(
    () => (isActive && canHighlight ? findCurrentIndex(aligned, localTime) : -1),
    [isActive, canHighlight, aligned, localTime],
  );

  // Indices of aligned tokens that match the search term (case-insensitive,
  // punctuation-tolerant via the same normalise() the alignment uses). When
  // karaoke is rendering, these tokens get the accent-orange colour — except
  // the currently-spoken one, which stays blue so playback position remains
  // visually unambiguous.
  const highlightedIndices = useMemo(() => {
    if (!highlightTerm) return null;
    const target = normalise(highlightTerm);
    if (!target) return null;
    const set = new Set<number>();
    aligned.forEach((w, i) => {
      if (normalise(w.display) === target) set.add(i);
    });
    return set.size > 0 ? set : null;
  }, [aligned, highlightTerm]);

  // Memoized on currentIndex (not localTime), so 60 Hz ticks that fall inside
  // the same word reuse the cached children — React skips reconciliation of
  // every span every frame, which is the main mobile flicker source. When
  // currentIndex does change, only the previously-current and newly-current
  // spans get a different className; the rest diff to a no-op.
  const wordSpans = useMemo(() => {
    return aligned.map((w, i) => {
      const isCurrent = i === currentIndex;
      const isHighlighted = highlightedIndices?.has(i) ?? false;
      return (
        <span
          key={i}
          className={cn(
            'transition-colors duration-200',
            isCurrent && 'text-primary',
          )}
          style={
            !isCurrent && isHighlighted
              ? { color: 'var(--accent-orange)' }
              : undefined
          }
        >
          {w.leading}
          {w.display}
        </span>
      );
    });
  }, [aligned, currentIndex, highlightedIndices]);

  if (!enabled || !canHighlight) {
    return (
      <p className={className}>
        {highlightTerm ? highlightWord(text, highlightTerm) : text}
      </p>
    );
  }

  // Single render path for active + idle when highlighting is possible. Idle
  // still renders per-word spans (currentIndex is -1 so no blue is applied),
  // which keeps the DOM structure identical across an isActive flip — that's
  // what prevents the search-word orange from disappearing at play start.
  return <p className={className}>{wordSpans}</p>;
}
