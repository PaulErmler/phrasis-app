/**
 * Media Session ownership for the app's audio.
 *
 * iOS routes the lock screen, Control Center and headphone buttons to the
 * page that owns the Now Playing slot, and keeps the slot on a page only
 * while that page has action handlers registered and a media element with a
 * source. Two surfaces register here: the card player for the whole lesson,
 * and the milestone celebration on top of it for a few seconds. Registrations
 * form a stack so the celebration's teardown restores the player's handlers
 * instead of nulling every action, which used to leave the lock-screen
 * buttons dead from the end of a celebration until the next card change.
 */

export interface MediaSessionRegistration {
  title: string;
  artist: string;
  onPlay: () => void;
  onPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  /** Lock-screen scrubber. Without it the scrubber is inert. */
  onSeekTo?: (seconds: number) => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
}

export interface MediaSessionHandle {
  /** Change this registration's metadata. Applied at once when it is on top. */
  update(meta: { title: string; artist: string }): void;
  /** Remove this registration and re-apply whatever is below it. */
  pop(): void;
}

const ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'nexttrack',
  'previoustrack',
  'seekto',
  'seekbackward',
  'seekforward',
];

const ARTWORK = [
  { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
];

const stack: MediaSessionRegistration[] = [];

function mediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return null;
  }
  return navigator.mediaSession;
}

function setHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // Some browsers don't support every action.
  }
}

function applyMetadata(session: MediaSession): void {
  const top = stack[stack.length - 1];
  if (!top) {
    session.metadata = null;
    return;
  }
  session.metadata = new MediaMetadata({
    title: top.title,
    artist: top.artist,
    album: 'Flexling',
    artwork: ARTWORK,
  });
}

function applyHandlers(session: MediaSession): void {
  const top = stack[stack.length - 1];
  if (!top) {
    for (const action of ACTIONS) setHandler(session, action, null);
    return;
  }
  setHandler(session, 'play', () => top.onPlay());
  setHandler(session, 'pause', () => top.onPause());
  setHandler(session, 'nexttrack', () => top.onNextTrack());
  setHandler(session, 'previoustrack', () => top.onPreviousTrack());
  const { onSeekTo, onSeekBackward, onSeekForward } = top;
  setHandler(
    session,
    'seekto',
    onSeekTo
      ? (details) => {
          if (typeof details.seekTime === 'number') onSeekTo(details.seekTime);
        }
      : null,
  );
  setHandler(
    session,
    'seekbackward',
    onSeekBackward ? () => onSeekBackward() : null,
  );
  setHandler(
    session,
    'seekforward',
    onSeekForward ? () => onSeekForward() : null,
  );
}

/**
 * Register as the current Media Session owner. The returned handle pops the
 * registration; whatever was registered below it comes back, handlers and
 * metadata alike. `playbackState` is left alone by both push and pop: it
 * describes the element that is (or was) playing, and the caller that owns
 * that element sets it.
 */
export function pushMediaSession(
  registration: MediaSessionRegistration,
): MediaSessionHandle {
  const entry: MediaSessionRegistration = { ...registration };
  stack.push(entry);
  const session = mediaSession();
  if (session) {
    applyMetadata(session);
    applyHandlers(session);
  }
  const isTop = () => stack[stack.length - 1] === entry;
  return {
    update(meta) {
      entry.title = meta.title;
      entry.artist = meta.artist;
      const s = mediaSession();
      if (s && isTop()) applyMetadata(s);
    },
    pop() {
      const index = stack.indexOf(entry);
      if (index === -1) return;
      stack.splice(index, 1);
      const s = mediaSession();
      if (s) {
        applyMetadata(s);
        applyHandlers(s);
      }
    },
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
  const session = mediaSession();
  if (!session || typeof session.setPositionState !== 'function') return;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  try {
    session.setPositionState({
      duration: durationSec,
      playbackRate: playbackRate || 1,
      position: Math.max(0, Math.min(positionSec, durationSec)),
    });
  } catch {
    // Ignore errors from invalid state
  }
}

/**
 * Set the Media Session playback state. `none` releases the Now Playing slot
 * on iOS (the next lock-screen Play goes to whatever app we interrupted), so
 * it belongs at the end of a lesson only; mid-session pauses are `paused`.
 */
export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState,
): void {
  const session = mediaSession();
  if (!session) return;
  session.playbackState = state;
}

/** How many registrations are stacked. Test hook. */
export function mediaSessionStackDepthForTests(): number {
  return stack.length;
}

/** Drop every registration. Test hook. */
export function resetMediaSessionForTests(): void {
  stack.length = 0;
  const session = mediaSession();
  if (session) {
    applyMetadata(session);
    applyHandlers(session);
  }
}
