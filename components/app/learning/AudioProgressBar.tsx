'use client';

import { useState, useEffect, useRef, memo } from 'react';
import { useTranslations } from 'next-intl';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { updateMediaSessionPosition } from '@/lib/audio/mediaSession';
import { audibleCues, type LanguageCue } from '@/lib/audio/mergeAudio';

export const AudioProgressBar = memo(function AudioProgressBar({
  audioRef,
  durationSec,
  isPlaying,
  onSeek,
  isMerging = false,
  languageCues,
}: {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  durationSec: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
  isMerging?: boolean;
  /** Cue boundaries (start of each language clip in the merged track). Used
   *  to draw separator tick marks on hover. The first cue at 0s is skipped. */
  languageCues?: ReadonlyArray<LanguageCue>;
}) {
  const t = useTranslations('LearningMode');
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    setCurrentTime(0);
  }, [durationSec]);

  // Reset the bar to the start whenever the merged track is re-baked while
  // paused. A settings-sheet edit (speed/rep/pause tweak or a language reorder)
  // pauses the audio and re-merges; resetting here keeps the bar from snapping
  // back to the old position (which read as a flicker). Reordering languages
  // keeps the same total duration, so the `durationSec` reset above can't catch
  // it. This cue-identity reset does. Skipped while playing so a mid-playback
  // speed change resumes smoothly instead of jumping to 0.
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  useEffect(() => {
    if (!isPlayingRef.current) setCurrentTime(0);
  }, [languageCues]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Always sync once on mount/state change so the bar reflects post-seek
    // position even when paused.
    setCurrentTime(audio.currentTime);
    updateMediaSessionPosition(audio.duration || 0, audio.currentTime);

    // Listen for seek events while paused so manual scrubs land.
    const onSeeked = () => {
      setCurrentTime(audio.currentTime);
      updateMediaSessionPosition(audio.duration || 0, audio.currentTime);
    };
    audio.addEventListener('seeked', onSeeked);

    if (!isPlaying) {
      return () => {
        audio.removeEventListener('seeked', onSeeked);
      };
    }

    // While playing, read currentTime each animation frame for a smoothly
    // sliding bar. The native `timeupdate` event only fires at ~250ms.
    let raf = 0;
    const tick = () => {
      setCurrentTime(audio.currentTime);
      updateMediaSessionPosition(audio.duration || 0, audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      audio.removeEventListener('seeked', onSeeked);
    };
  }, [isPlaying, audioRef]);

  // No audio loaded yet (card change / first load) → render the bar dimmed and
  // empty. A re-merge of already-loaded audio is NOT treated as inactive, so
  // the bar doesn't dim/flicker on every settings tweak; seeking is still
  // blocked mid-merge via `disabled` below.
  const noAudio = durationSec <= 0;

  // Cue boundaries to render as thin separator ticks on hover. Only audible
  // cues are clip boundaries (a zero-repetition language has no clip, so there
  // is nothing to separate there); of those, drop the leading 0s cue (it lines
  // up with the bar's left edge) and any cue past duration (shouldn't happen,
  // but defensive).
  const cueMarks =
    !noAudio && languageCues
      ? audibleCues(languageCues)
          .filter((c) => c.startSec > 0 && c.startSec < durationSec)
          .map((c) => (c.startSec / durationSec) * 100)
      : [];

  return (
    <SliderPrimitive.Root
      value={[noAudio ? 0 : currentTime]}
      max={noAudio ? 1 : durationSec}
      step={0.01}
      disabled={noAudio || isMerging}
      onValueChange={([v]) => {
        setCurrentTime(v);
        onSeek(v);
      }}
      className={`group relative flex w-full touch-none items-center select-none transition-opacity duration-150 ${
        noAudio ? 'opacity-30 pointer-events-none' : ''
      }`}
    >
      <SliderPrimitive.Track className="bg-primary/20 relative h-1 w-full grow overflow-hidden">
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
        {cueMarks.map((leftPct, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="bg-card pointer-events-none absolute top-0 h-full w-px opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            style={{ left: `${leftPct}%` }}
          />
        ))}
      </SliderPrimitive.Track>
      {/* No visible thumb. Would get clipped by the card's overflow-hidden.
          The fill edge already indicates drag position. */}
      <SliderPrimitive.Thumb
        aria-label={t('audioProgress')}
        className="block size-0 outline-none"
      />
    </SliderPrimitive.Root>
  );
});
