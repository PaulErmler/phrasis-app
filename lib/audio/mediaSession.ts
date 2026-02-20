export interface MediaSessionOptions {
  title: string;
  artist: string;
  onPlay: () => void;
  onPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
}

type ActionType = 'play' | 'pause' | 'nexttrack' | 'previoustrack';

/**
 * Wire up the Media Session API with metadata and action handlers.
 * Returns a teardown function that clears all handlers.
 */
export function setupMediaSession(options: MediaSessionOptions): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return () => {};
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: options.title,
    artist: options.artist,
  });

  const handlers: [ActionType, MediaSessionActionHandler][] = [
    ['play', () => options.onPlay()],
    ['pause', () => options.onPause()],
    ['nexttrack', () => options.onNextTrack()],
    ['previoustrack', () => options.onPreviousTrack()],
  ];

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some browsers don't support all actions
    }
  }

  return () => {
    for (const [action] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Update the Media Session position state to reflect the current
 * playback position of the audio element.
 */
export function updateMediaSessionPosition(
  durationSec: number,
  positionSec: number,
  playbackRate = 1,
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec,
      playbackRate,
      position: Math.min(positionSec, durationSec),
    });
  } catch {
    // Ignore errors from invalid state
  }
}

/**
 * Set the Media Session playback state.
 */
export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState,
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }
  navigator.mediaSession.playbackState = state;
}
