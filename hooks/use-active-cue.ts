'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LanguageCue } from '@/lib/audio/mergeAudio';
import type { PlaybackClock } from '@/lib/audio/playbackClock';

/** Merged-audio playback surface passed down from useAudioPlayer. */
export interface MergedPlayback {
  isPlaying: boolean;
  clock: PlaybackClock;
  languageCues: ReadonlyArray<LanguageCue>;
  /** Merge-time stretch speeds, fallback for cues without a `speed` field. */
  speedByLanguage: Record<string, number>;
}

/** The active language cue — changes a handful of times per playback. */
export interface ActiveCue {
  language: string;
  /** Cue start on the merged timeline, for per-frame localTime derivation. */
  cueStartSec: number;
  /** Stretch speed of this clip (scales merged time back to 1× timings). */
  speed: number;
}

/**
 * Low-frequency replacement for deriving the active clip from a 60 Hz
 * `currentTime` in React state: subscribes to the playback clock and calls
 * setState only when the ACTIVE CUE INDEX changes (a few times per card),
 * not every frame. Word-level highlighting derives per-frame positions
 * inside the leaf via useKaraokeIndex.
 */
export function useActiveCue(
  mergedPlayback: MergedPlayback | undefined,
): ActiveCue | null {
  const isPlaying = mergedPlayback?.isPlaying ?? false;
  const clock = mergedPlayback?.clock;
  const languageCues = mergedPlayback?.languageCues;

  const [cueIndex, setCueIndex] = useState(-1);

  useEffect(() => {
    if (!isPlaying || !clock || !languageCues || languageCues.length === 0) {
      setCueIndex(-1);
      return;
    }
    const compute = (timeSec: number) => {
      let idx = -1;
      for (let i = languageCues.length - 1; i >= 0; i--) {
        if (languageCues[i].startSec <= timeSec) {
          idx = i;
          break;
        }
      }
      setCueIndex((prev) => (prev === idx ? prev : idx));
    };
    compute(clock.getTime());
    return clock.subscribe(compute);
  }, [isPlaying, clock, languageCues]);

  return useMemo(() => {
    if (!isPlaying || !mergedPlayback || cueIndex < 0) return null;
    const cue = mergedPlayback.languageCues[cueIndex];
    if (!cue) return null;
    return {
      language: cue.language,
      cueStartSec: cue.startSec,
      speed: cue.speed ?? mergedPlayback.speedByLanguage[cue.language] ?? 1,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, cueIndex, mergedPlayback?.languageCues, mergedPlayback?.speedByLanguage]);
}
