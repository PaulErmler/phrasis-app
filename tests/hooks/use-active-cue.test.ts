import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveCue, type MergedPlayback } from '@/hooks/use-active-cue';
import type { LanguageCue } from '@/lib/audio/mergeAudio';
import { createPlaybackClock } from '@/lib/audio/playbackClock';

/**
 * `useActiveCue` decides which line shows the karaoke word highlight. A silent
 * cue is a reveal-only placeholder for a language whose repetitions are 0.
 * There is no clip behind it, so it must never become the active cue.
 */
function render(languageCues: LanguageCue[]) {
  const clock = createPlaybackClock();
  // The clock reads position off the attached media element; a stub with a
  // writable currentTime is enough to drive it.
  const media = { currentTime: 0 };
  clock.attach(media as HTMLAudioElement);

  const mergedPlayback: MergedPlayback = {
    isPlaying: true,
    clock,
    languageCues,
    speedByLanguage: {},
  };
  const hook = renderHook(() => useActiveCue(mergedPlayback));

  const seek = (t: number) =>
    act(() => {
      media.currentTime = t;
      clock.notifyOnce();
    });

  return { ...hook, seek };
}

describe('useActiveCue', () => {
  it('tracks the audible cue the timeline is inside', () => {
    const { result, seek } = render([
      { language: 'en', startSec: 0, speed: 1 },
      { language: 'es', startSec: 5, speed: 1 },
    ]);
    expect(result.current?.language).toBe('en');

    seek(5.5);
    expect(result.current?.language).toBe('es');
    expect(result.current?.cueStartSec).toBe(5);
  });

  it('skips a silent cue and stays on the language that is sounding', () => {
    const { result, seek } = render([
      { language: 'en', startSec: 0, speed: 1 },
      { language: 'es', startSec: 5, speed: 1, reveals: true, silent: true },
    ]);

    seek(6);
    expect(result.current?.language).toBe('en');
  });

  it('has no active cue when only silent cues have started', () => {
    const { result, seek } = render([
      { language: 'en', startSec: 0, speed: 1, reveals: true, silent: true },
      { language: 'es', startSec: 9, speed: 1 },
    ]);

    seek(3);
    expect(result.current).toBeNull();
  });
});
