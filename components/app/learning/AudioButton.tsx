'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';
import { getLanguageShortLabel } from '@/lib/languages';
import { computeAttenuation, getPeak } from '@/lib/audio/peakCache';

export interface AudioButtonProps {
  url: string | null;
  /** Canonical language code (e.g. "en", "es_latam"). Broadcast verbatim through onTimeUpdate/onStop so consumers can match against translation.language. The visible label is derived via getLanguageShortLabel. */
  language: string;
  /** Show a text label next to the icon (used in DeckCardsView). Default: false */
  showLabel?: boolean;
  /** If true, immediately stop current playback and prevent new playback. */
  stopPlayback?: boolean;
  /** Called just before this button starts playing audio (e.g. to stop the main player). */
  onPlay?: () => void;
  /** rAF-frequency time updates while playing; used for word highlighting. */
  onTimeUpdate?: (language: string, localTime: number) => void;
  /** Fired when playback ends, is paused, or the component unmounts. */
  onStop?: (language: string) => void;
  /**
   * Playback rate applied via `HTMLMediaElement.playbackRate`. Pitch is kept
   * stable by `preservesPitch = true`. Defaults to 1 so call sites that don't
   * care about speed (e.g. collection previews) get native speed automatically.
   */
  speed?: number;
}

export function AudioButton({
  url,
  language,
  showLabel = false,
  stopPlayback = false,
  onPlay,
  onTimeUpdate,
  onStop,
  speed = 1,
}: AudioButtonProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    if (!stopPlayback || !audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setIsLoading(false);
    onStopRef.current?.(language);
  }, [stopPlayback, language]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.onended = null;
        audio.onerror = null;
      }
      audioRef.current = null;
      onStopRef.current?.(language);
    };
  }, [language]);

  // Keep an already-running HTMLAudioElement in sync when the `speed` prop
  // changes mid-playback (e.g. user cycles the per-card speed badge while a
  // clip is playing). No-op when no element is mounted yet.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // rAF-driven time broadcast while playing. Native `timeupdate` at ~4 Hz is
  // too coarse for smooth per-word highlighting.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) onTimeUpdateRef.current?.(language, audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, language]);

  const handlePlay = async () => {
    if (!url) return;

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      onStopRef.current?.(language);
      return;
    }

    setIsLoading(true);
    onPlay?.();
    try {
      if (!audioRef.current || audioRef.current.src !== url) {
        audioRef.current = new Audio(url);
        audioRef.current.onended = () => {
          setIsPlaying(false);
          onStopRef.current?.(language);
        };
        audioRef.current.onerror = () => {
          setIsPlaying(false);
          setIsLoading(false);
          onStopRef.current?.(language);
        };
      }
      // Keep pitch stable across playbackRate changes. `preservesPitch`
      // defaults to true in modern browsers; setting it explicitly (including
      // the webkit alias) guards older Safari and makes intent obvious.
      audioRef.current.preservesPitch = true;
      const el = audioRef.current as HTMLAudioElement & {
        webkitPreservesPitch?: boolean;
      };
      el.webkitPreservesPitch = true;
      audioRef.current.playbackRate = speed;
      try {
        const peak = await getPeak(url);
        audioRef.current.volume = computeAttenuation(peak);
      } catch (peakErr) {
        console.warn('Peak measurement failed; playing at native volume', peakErr);
      }
      // Reusing a completed audio element: explicitly rewind so consecutive
      // replays actually play (and so the first onTimeUpdate broadcasts 0,
      // not the previous run's final position).
      if (audioRef.current.ended) {
        audioRef.current.currentTime = 0;
      }
      await audioRef.current.play();
      setIsPlaying(true);
    } catch (error) {
      console.error('Error playing audio:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Icon-only variant (learning mode)
  if (!showLabel) {
    if (!url) {
      return (
        <Button
          variant="ghost"
          size="icon"
          disabled
          className="h-8 w-8 text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      );
    }

    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePlay}
        disabled={isLoading || stopPlayback}
        className="h-8 w-8"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isPlaying ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </Button>
    );
  }

  // Labeled variant (deck cards view)
  if (!url) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        className="gap-1 text-muted-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Generating {getLanguageShortLabel(language)}...</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handlePlay}
      disabled={isLoading || stopPlayback}
      className="gap-1"
    >
      {isLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isPlaying ? (
        <VolumeX className="h-3 w-3" />
      ) : (
        <Volume2 className="h-3 w-3" />
      )}
      <span className="text-xs">{getLanguageShortLabel(language)}</span>
    </Button>
  );
}
