/**
 * WebKit's Audio Session API (`navigator.audioSession`, Safari 16.4+). It is
 * the web's `AVAudioSession.setCategory(.playback)`: declaring `playback`
 * tells iOS the page is a music-style player that should interrupt other
 * apps, keep going with the screen locked, and hold the Now Playing slot
 * across pauses. Left at the default `auto`, WebKit guesses the category
 * from which APIs the page happened to call, and a page whose element is
 * looping silence between two cards is easy to guess wrong.
 *
 * Not implemented in Chrome, Edge or Firefox; every call here is a no-op
 * there.
 */

export type AudioSessionType =
  | 'auto'
  | 'playback'
  | 'transient'
  | 'transient-solo'
  | 'ambient'
  | 'play-and-record';

export type AudioSessionState = 'active' | 'interrupted' | 'inactive';

export interface AudioSessionLike extends EventTarget {
  type: AudioSessionType;
  readonly state: AudioSessionState;
}

declare global {
  interface Navigator {
    audioSession?: AudioSessionLike;
  }
}

let declared = false;

function session(): AudioSessionLike | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.audioSession ?? null;
}

/**
 * Declare the page a `playback` session. Set once, inside a user gesture,
 * and never flipped again mid-session: iOS gets confused by category
 * changes while audio is running. Returns whether the declaration is in
 * place (false where the API is missing).
 */
export function declareAudioSessionType(): boolean {
  if (declared) return true;
  const s = session();
  if (!s) return false;
  try {
    s.type = 'playback';
  } catch {
    return false;
  }
  declared = true;
  return true;
}

/**
 * Observe session state changes. `interrupted` means another app took the
 * audio session (a call, Siri, another player); a `play()` while the state
 * is not `active` returns without error and produces no sound.
 */
export function observeAudioSessionState(
  listener: (state: AudioSessionState) => void,
): () => void {
  const s = session();
  if (!s) return () => {};
  const onChange = () => listener(s.state);
  s.addEventListener('statechange', onChange);
  return () => s.removeEventListener('statechange', onChange);
}

/** Test hook: forget that the type was declared. */
export function resetAudioSessionForTests(): void {
  declared = false;
}
