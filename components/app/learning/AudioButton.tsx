"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Volume2, VolumeX, Loader2 } from "lucide-react";

export interface AudioButtonProps {
  url: string | null;
  language: string;
  /** Show a text label next to the icon (used in DeckCardsView). Default: false */
  showLabel?: boolean;
  /** If true, immediately stop current playback and prevent new playback. */
  stopPlayback?: boolean;
}

export function AudioButton({
  url,
  language,
  showLabel = false,
  stopPlayback = false,
}: AudioButtonProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!stopPlayback || !audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setIsLoading(false);
  }, [stopPlayback]);

  const handlePlay = async () => {
    if (!url) return;

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      return;
    }

    setIsLoading(true);
    try {
      if (!audioRef.current || audioRef.current.src !== url) {
        audioRef.current = new Audio(url);
        audioRef.current.onended = () => setIsPlaying(false);
        audioRef.current.onerror = () => {
          setIsPlaying(false);
          setIsLoading(false);
        };
      }
      await audioRef.current.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Error playing audio:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Icon-only variant (learning mode)
  if (!showLabel) {
    if (!url) {
      return (
        <Button variant="ghost" size="icon" disabled className="h-8 w-8 text-muted-foreground">
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
      <Button variant="ghost" size="sm" disabled className="gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Generating {language}...</span>
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
      <span className="text-xs">{language}</span>
    </Button>
  );
}
