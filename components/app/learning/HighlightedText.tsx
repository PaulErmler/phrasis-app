'use client';

import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  alignWordTimings,
  matchRatio,
  type AlignedWord,
} from '@/lib/audio/alignTimings';
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
   * Optional content to render in place of the plain text when highlighting
   * isn't active (e.g. a word-cloud dialog showing the searched word with
   * its own accent). Karaoke takes over during playback.
   */
  fallback?: ReactNode;
}

/**
 * Finds the word whose active window contains `t`. For non-last words the
 * window extends from the word's start to the next word's start (keeps the
 * highlight steady across any gap Scribe leaves between words). For the LAST
 * word it stops at the word's own `end` — once the final syllable finishes
 * the highlight should clear, even if the audio clip has trailing silence.
 */
function findCurrentIndex(words: AlignedWord[], t: number): number {
  if (words.length === 0) return -1;
  if (t < words[0].start) return -1;
  for (let i = 0; i < words.length; i++) {
    const nextStart =
      i < words.length - 1 ? words[i + 1].start : words[i].end;
    if (t >= words[i].start && t < nextStart) return i;
  }
  return -1;
}

/**
 * If fewer than this fraction of real-text tokens matched Scribe's output the
 * alignment is unreliable (likely a non-whitespace-delimited script or a
 * mis-transcribed clip). Fall back to showing plain text — we'd rather show
 * no highlight than a desynced one.
 */
const MIN_MATCH_RATIO = 0.5;

/**
 * Karaoke-style text: past words fade, current word is primary-coloured,
 * future words stay at reading weight. Always renders the canonical text from
 * the database — Scribe's timings are aligned onto those tokens, never shown
 * directly, so transcription drift can't change what the user reads.
 */
export function HighlightedText({
  text,
  wordTimings,
  localTime,
  isActive,
  enabled,
  className,
  fallback,
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

  // Memoized on currentIndex (not localTime), so 60 Hz ticks that fall inside
  // the same word reuse the cached children — React skips reconciliation of
  // every span every frame, which is the main mobile flicker source. When
  // currentIndex does change, only the previously-current and newly-current
  // spans get a different className; the rest diff to a no-op.
  const wordSpans = useMemo(() => {
    return aligned.map((w, i) => (
      <span
        key={i}
        className={cn(
          'transition-colors duration-200',
          i === currentIndex && 'text-primary',
        )}
      >
        {w.leading}
        {w.display}
      </span>
    ));
  }, [aligned, currentIndex]);

  if (!enabled || !canHighlight || !isActive) {
    return <p className={className}>{fallback ?? text}</p>;
  }

  return <p className={className}>{wordSpans}</p>;
}
