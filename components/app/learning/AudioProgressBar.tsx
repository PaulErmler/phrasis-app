'use client';

import { useState, useEffect, useRef, memo } from 'react';
import { Slider } from '@/components/ui/slider';
import { updateMediaSessionPosition } from '@/lib/audio/mediaSession';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const AudioProgressBar = memo(function AudioProgressBar({
  audioRef,
  durationSec,
  isPlaying,
  onSeek,
}: {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  durationSec: number;
  isPlaying: boolean;
  onSeek: (seconds: number) => void;
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setCurrentTime(0);
  }, [durationSec]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const audio = audioRef.current;
    if (audio) setCurrentTime(audio.currentTime);

    if (isPlaying) {
      timerRef.current = setInterval(() => {
        if (audio && !audio.paused) {
          setCurrentTime(audio.currentTime);
          updateMediaSessionPosition(audio.duration || 0, audio.currentTime);
        }
      }, 33);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, audioRef]);

  if (durationSec <= 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">
        {formatTime(currentTime)}
      </span>
      <Slider
        value={[currentTime]}
        max={durationSec}
        step={0.1}
        onValueChange={([v]) => {
          setCurrentTime(v);
          onSeek(v);
        }}
        className="flex-1"
      />
      <span className="text-[11px] text-muted-foreground tabular-nums w-8">
        {formatTime(durationSec)}
      </span>
    </div>
  );
});
