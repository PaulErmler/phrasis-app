import { PROGRESS_SOUND_URL } from '@/lib/constants/learning';

/**
 * The milestone celebration's success sound, as ONE long-lived
 * `HTMLAudioElement` shared across celebrations.
 *
 * Why a singleton instead of `new Audio(url)` per celebration:
 *
 * 1. Autoplay policy. The celebration mounts after the review mutation
 *    resolves, i.e. never inside a user gesture, and in audio mode the review
 *    itself was triggered by the card's `ended` event. WebKit (iOS Safari,
 *    home-screen PWA) only lets an element play programmatically once THAT
 *    element has been started from a user gesture, so a fresh element per
 *    celebration is refused with NotAllowedError and the screen runs silent.
 *    The main card player relies on the same one-element pattern, which is
 *    why card audio keeps working mid-session while the celebration didn't.
 *    `installCelebrationSoundUnlock` starts (and immediately pauses) this
 *    element on the first tap / key in learning mode, which lifts the
 *    restriction for every later programmatic `play()`.
 *
 * 2. Cold buffer. A fresh element re-fetches / re-decodes the file every
 *    time, so playback started hundreds of ms after `play()` on mobile and
 *    the counter animation (tuned to the audio's peaks) ran ahead of the
 *    sound. The singleton keeps the decoded buffer after the first play.
 */

let element: HTMLAudioElement | null = null;
let unlocked = false;

export function getCelebrationSound(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return null;
  }
  if (!element) {
    element = new Audio(PROGRESS_SOUND_URL);
    element.preload = 'auto';
  }
  return element;
}

/** Warm the buffer at session start (HTTP cache + decode where the platform
 * honours `preload`). Safe to call repeatedly. */
export function warmCelebrationSound(): void {
  const el = getCelebrationSound();
  if (!el || unlocked) return;
  try {
    el.load();
  } catch {
    // Nothing to do; playback will load on demand.
  }
}

/** True once the element has been started from a user gesture (or the
 * platform never needed one, see `installCelebrationSoundUnlock`). */
export function isCelebrationSoundUnlocked(): boolean {
  return unlocked;
}

/**
 * Listen for the first user gesture and use it to unlock the element: call
 * `play()` inside the gesture, then `pause()` synchronously so nothing is
 * audible. WebKit lifts the element's gesture restriction at the top of
 * `play()`, before any data is loaded, so the immediate pause doesn't undo
 * it; the rejected play promise (AbortError) is expected and dropped.
 *
 * Returns a teardown. Listeners remove themselves after a successful unlock.
 * `touchend` and `click` are the events WebKit counts as media gestures
 * (`touchstart` / `pointerdown` are not), `keydown` covers desktop.
 */
export function installCelebrationSoundUnlock(): () => void {
  if (typeof window === 'undefined' || unlocked) return () => {};
  const el = getCelebrationSound();
  if (!el) return () => {};

  const events = ['touchend', 'click', 'keydown'] as const;
  const remove = () => {
    for (const ev of events) {
      window.removeEventListener(ev, unlock, true);
    }
  };
  const unlock = () => {
    if (unlocked) {
      remove();
      return;
    }
    // A celebration already playing (the unlock listener is installed by the
    // learning screen, which also hosts the celebration) must not be reset.
    if (!el.paused) {
      unlocked = true;
      remove();
      return;
    }
    const attempt = el.play();
    el.pause();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {});
    }
    unlocked = true;
    remove();
  };
  for (const ev of events) {
    window.addEventListener(ev, unlock, true);
  }
  return remove;
}

/**
 * Restart the sound from the beginning. Resolves once playback has actually
 * begun (the element's `playing` event or the play promise, whichever comes
 * first) so callers can align animations to real audio time; rejects when
 * the browser refused to play.
 */
export function playCelebrationSound(): {
  element: HTMLAudioElement | null;
  started: Promise<void>;
} {
  const el = getCelebrationSound();
  if (!el) {
    return { element: null, started: Promise.reject(new Error('no audio')) };
  }
  try {
    el.currentTime = 0;
  } catch {
    // Before metadata some engines throw; the load below starts at 0 anyway.
  }
  const started = new Promise<void>((resolve, reject) => {
    let settled = false;
    const onPlaying = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('playing', onPlaying);
      resolve();
    };
    el.addEventListener('playing', onPlaying);
    const attempt = el.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(onPlaying, (err: unknown) => {
        if (settled) return;
        settled = true;
        el.removeEventListener('playing', onPlaying);
        reject(err);
      });
    } else {
      // Legacy engines without a play promise: rely on `playing`.
    }
  });
  return { element: el, started };
}

/** Stop the sound and rewind so the next celebration starts clean. */
export function stopCelebrationSound(): void {
  const el = element;
  if (!el) return;
  el.pause();
  try {
    el.currentTime = 0;
  } catch {
    // ignore
  }
}

/** Test hook: drop the cached element and the unlocked flag. */
export function resetCelebrationSoundForTests(): void {
  element = null;
  unlocked = false;
}
