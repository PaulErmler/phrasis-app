'use client';

import { useCallback, useState } from 'react';

export interface ButtonPlaybackActive {
  language: string;
  localTime: number;
}

export interface ButtonPlaybackState {
  /** The language currently playing via a per-language AudioButton, or null. */
  active: ButtonPlaybackActive | null;
  /** Pass to every AudioButton so they broadcast their playback position. */
  onTimeUpdate: (language: string, localTime: number) => void;
  /** Pass to every AudioButton so the active clip clears on stop. */
  onStop: (language: string) => void;
}

/**
 * Tracks which per-language AudioButton is currently playing and at what
 * time. Mutual exclusion comes for free. Any new language replaces the
 * previous entry. Used to drive `<HighlightedText>` when the merged card
 * audio isn't running (e.g. library previews, individual-language replays).
 */
export function useButtonPlayback(): ButtonPlaybackState {
  const [active, setActive] = useState<ButtonPlaybackActive | null>(null);

  const onTimeUpdate = useCallback((language: string, localTime: number) => {
    setActive({ language, localTime });
  }, []);

  const onStop = useCallback((language: string) => {
    setActive((prev) => (prev?.language === language ? null : prev));
  }, []);

  return { active, onTimeUpdate, onStop };
}
