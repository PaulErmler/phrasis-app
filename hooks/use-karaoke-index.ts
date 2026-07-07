'use client';

import { useEffect, useState } from 'react';
import { findCurrentIndex, type AlignedWord } from '@/lib/audio/alignTimings';
import type { PlaybackClock } from '@/lib/audio/playbackClock';

/**
 * Frame-rate word-position source for a single text row during merged-audio
 * playback. `cueStartSec`/`speed` rescale merged-timeline time back into the
 * original 1× frame that word timings live in.
 */
export interface ClockBinding {
  clock: PlaybackClock;
  cueStartSec: number;
  speed: number;
}

/**
 * Current karaoke word index for a row.
 *
 * - With a `clockBinding` (merged playback): subscribes to the playback
 *   clock and derives the index per frame, but calls setState ONLY when the
 *   word index changes — a few times per second instead of 60 re-renders/s,
 *   contained to this leaf.
 * - Without one (AudioButton previews): derives directly from the
 *   `localTime` prop, which updates at the button's own low cadence.
 */
export function useKaraokeIndex(
  aligned: AlignedWord[],
  active: boolean,
  localTime: number,
  clockBinding: ClockBinding | undefined,
): number {
  const bound = active && clockBinding !== undefined;
  const [liveIndex, setLiveIndex] = useState(-1);

  const clock = clockBinding?.clock;
  const cueStartSec = clockBinding?.cueStartSec ?? 0;
  const speed = clockBinding?.speed ?? 1;

  useEffect(() => {
    if (!bound || !clock) {
      setLiveIndex(-1);
      return;
    }
    const compute = (timeSec: number) => {
      const local = (timeSec - cueStartSec) * speed;
      const idx = findCurrentIndex(aligned, local);
      setLiveIndex((prev) => (prev === idx ? prev : idx));
    };
    compute(clock.getTime());
    return clock.subscribe(compute);
  }, [bound, clock, cueStartSec, speed, aligned]);

  if (!active) return -1;
  return bound ? liveIndex : findCurrentIndex(aligned, localTime);
}
