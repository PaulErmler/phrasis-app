import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKaraokeIndex, type ClockBinding } from '@/hooks/use-karaoke-index';
import type { AlignedWord } from '@/lib/audio/alignTimings';
import { createPlaybackClock } from '@/lib/audio/playbackClock';

const word = (display: string, start: number, end: number): AlignedWord => ({
  display,
  leading: '',
  trailing: '',
  start,
  end,
  matched: true,
});

// Word i is current for t in [start_i, start_{i+1}); past the last end → -1.
const ALIGNED = [word('uno', 0, 1), word('dos', 1, 2), word('tres', 2, 3)];

/** Clock + writable media stub, as in use-active-cue.test.ts. */
function bind(cueStartSec = 0, speed = 1) {
  const clock = createPlaybackClock();
  const media = { currentTime: 0 };
  clock.attach(media as HTMLAudioElement);
  const binding: ClockBinding = { clock, cueStartSec, speed };
  const seek = (t: number) =>
    act(() => {
      media.currentTime = t;
      clock.notifyOnce();
    });
  return { binding, seek };
}

describe('useKaraokeIndex', () => {
  it('derives the index from localTime when no clock is bound', () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: number }) => useKaraokeIndex(ALIGNED, true, t, undefined),
      { initialProps: { t: 0.5 } },
    );
    expect(result.current).toBe(0);

    rerender({ t: 1.5 });
    expect(result.current).toBe(1);

    rerender({ t: -0.2 });
    expect(result.current).toBe(-1);
  });

  it('is -1 while inactive, even with a bound clock mid-word', () => {
    const { binding, seek } = bind();
    const { result } = renderHook(() =>
      useKaraokeIndex(ALIGNED, false, 1.5, binding),
    );
    seek(1.5);
    expect(result.current).toBe(-1);
  });

  it('follows the playback clock while bound', () => {
    const { binding, seek } = bind();
    const { result } = renderHook(() =>
      useKaraokeIndex(ALIGNED, true, 0, binding),
    );
    // Initial compute from clock.getTime() (0 → first word).
    expect(result.current).toBe(0);

    seek(1.2);
    expect(result.current).toBe(1);

    seek(2.5);
    expect(result.current).toBe(2);

    // Past the last word's end there is nothing to highlight.
    seek(5);
    expect(result.current).toBe(-1);
  });

  it('rescales merged-timeline time into the 1× frame via cueStartSec and speed', () => {
    const { binding, seek } = bind(5, 2);
    const { result } = renderHook(() =>
      useKaraokeIndex(ALIGNED, true, 0, binding),
    );
    // merged t = 5.6 → local (5.6 - 5) × 2 = 1.2 → 'dos'.
    seek(5.6);
    expect(result.current).toBe(1);
  });

  it('falls back to localTime when the binding goes away', () => {
    const { binding, seek } = bind();
    const initialProps: { b: ClockBinding | undefined } = { b: binding };
    const { result, rerender } = renderHook(
      ({ b }: { b: ClockBinding | undefined }) =>
        useKaraokeIndex(ALIGNED, true, 1.5, b),
      { initialProps },
    );
    seek(2.5);
    expect(result.current).toBe(2);

    rerender({ b: undefined });
    expect(result.current).toBe(1);
  });
});
