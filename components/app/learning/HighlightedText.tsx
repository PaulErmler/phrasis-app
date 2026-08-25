'use client';

import { Fragment, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  alignWordTimings,
  matchRatio,
  normalise,
} from '@/lib/audio/alignTimings';
import { highlightWord } from '@/lib/wordCloud';
import { useFuriganaDisplay } from './useFuriganaDisplay';
import { HighlightedRuby } from './Ruby';
import { getTextDirection, languageSupportsKaraoke } from '@/lib/languages';
import { useKaraokeIndex, type ClockBinding } from '@/hooks/use-karaoke-index';
import type { WordTiming } from './types';

interface Props {
  /** Canonical source text. This is what the user always sees. */
  text: string;
  /** BCP-47 language code of `text`. Drives locale-aware word segmentation. */
  language: string;
  /** Per-word timings from Scribe's transcription. Null/empty → plain text. */
  wordTimings: WordTiming[] | null | undefined;
  /** Time in seconds within THIS clip (already offset by the clip's cue start). */
  localTime: number;
  /**
   * Merged-playback word-position source. When set (and active), the word
   * index ticks from a clock subscription inside this leaf instead of the
   * `localTime` prop, no parent re-renders per frame.
   */
  clockBinding?: ClockBinding;
  /** True when the merged audio is currently playing THIS clip. */
  isActive: boolean;
  /** User setting, when false, always render plain text. */
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
  /**
   * Bracketed furigana annotation for `text` (lib/furigana.ts format). When
   * set AND it still reconstructs `text` exactly, kanji runs render as ruby
   * in the plain branch — the only branch Japanese reaches, since ja has
   * `supportsKaraoke: false` and so never enters the per-word karaoke path.
   * Composes with `highlightTerm` (see HighlightedRuby).
   */
  furigana?: string;
}

/**
 * If fewer than this fraction of real-text tokens matched Scribe's output the
 * alignment is unreliable (likely a non-whitespace-delimited script or a
 * mis-transcribed clip). Fall back to showing plain text. We'd rather show
 * no highlight than a desynced one.
 */
const MIN_MATCH_RATIO = 0.5;

/**
 * Karaoke-style text: the current word is primary-coloured, every other word
 * renders as plain default text, same as before play and after the audio
 * ends, so the rendered output is identical in those two states. Always
 * renders the canonical text from the database; Scribe's timings are aligned
 * onto those tokens but never shown directly, so transcription drift can't
 * change what the user reads.
 */
export function HighlightedText({
  text,
  language,
  wordTimings,
  localTime,
  clockBinding,
  isActive,
  enabled,
  className,
  highlightTerm,
  furigana,
}: Props) {
  const aligned = useMemo(
    () => alignWordTimings(text, wordTimings, language),
    [text, wordTimings, language],
  );

  const { segments: furiganaSegments, rubyClass } = useFuriganaDisplay(
    furigana,
    text,
  );

  const canHighlight = useMemo(() => {
    if (!languageSupportsKaraoke(language)) return false;
    return (
      !!wordTimings &&
      wordTimings.length > 0 &&
      matchRatio(aligned) >= MIN_MATCH_RATIO
    );
  }, [language, wordTimings, aligned]);

  const currentIndex = useKaraokeIndex(
    aligned,
    isActive && canHighlight,
    localTime,
    clockBinding,
  );

  // Indices of aligned tokens that match the search term (case-insensitive,
  // punctuation-tolerant via the same normalise() the alignment uses). When
  // karaoke is rendering, these tokens get the accent-orange colour, except
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
  // the same word reuse the cached children. React skips reconciliation of
  // every span every frame, which is the main mobile flicker source. When
  // currentIndex does change, only the previously-current and newly-current
  // spans get a different className; the rest diff to a no-op.
  const wordSpans = useMemo(() => {
    return aligned.map((w, i) => {
      const isCurrent = i === currentIndex;
      const isHighlighted = highlightedIndices?.has(i) ?? false;
      return (
        // Fragment (not wrapper span) so the rendered span count stays at one
        // per word. Tests query `container.querySelectorAll('span')` and
        // index by word position. Trailing is "" on every token except the
        // last, so this is effectively a single text node after the final
        // word's colored span.
        <Fragment key={i}>
          <span
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
          {w.trailing}
        </Fragment>
      );
    });
  }, [aligned, currentIndex, highlightedIndices]);

  // Explicit direction keeps RTL sentence-final punctuation at the sentence
  // end; `text-left` keeps the sentence flush with the LTR layout (see
  // ClickableWords for the bidi rationale).
  const dir = getTextDirection(language);
  const dirClassName = cn(
    className,
    dir === 'rtl' && 'text-left',
    // Extra leading so the reading line doesn't collide with the row above.
    rubyClass,
  );

  if (!enabled || !canHighlight) {
    return (
      <p dir={dir} className={dirClassName}>
        {furiganaSegments !== null ? (
          <HighlightedRuby
            segments={furiganaSegments}
            text={text}
            language={language}
            term={highlightTerm}
          />
        ) : highlightTerm ? (
          highlightWord(text, highlightTerm, language)
        ) : (
          text
        )}
      </p>
    );
  }

  // Single render path for active + idle when highlighting is possible. Idle
  // still renders per-word spans (currentIndex is -1 so no blue is applied),
  // which keeps the DOM structure identical across an isActive flip. That's
  // what prevents the search-word orange from disappearing at play start.
  return <p dir={dir} className={dirClassName}>{wordSpans}</p>;
}
