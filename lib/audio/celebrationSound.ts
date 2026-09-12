import { PROGRESS_SOUND_URL } from '@/lib/constants/learning';
import { unlockElementInGesture } from './unlockElement';

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
let progressBlobUrl: string | null = null;
let progressBlobPending: Promise<string | null> | null = null;

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
 * Unlock the element from inside a user gesture (see
 * `unlockElementInGesture`); the app's first-tap installer in
 * `lib/audio/gestureUnlock.ts` calls this. Returns whether the element is
 * unlocked afterwards (false only where there is no `Audio` at all). A
 * celebration already playing must not be reset, so it just counts.
 */
export function unlockCelebrationSoundInGesture(): boolean {
  if (unlocked) return true;
  const el = getCelebrationSound();
  if (!el) return false;
  if (el.paused) unlockElementInGesture(el);
  unlocked = true;
  return true;
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

/**
 * The success sound as a blob URL, for the card player to play through its
 * own element when a milestone lands while the page is hidden (the screen is
 * skipped there, the sound is not). Fetched once at session start so the
 * hidden path never depends on the network. Resolves null on failure and
 * lets the next call retry.
 */
export function warmProgressSoundBlob(): Promise<string | null> {
  if (progressBlobUrl) return Promise.resolve(progressBlobUrl);
  if (progressBlobPending) return progressBlobPending;
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return Promise.resolve(null);
  }
  progressBlobPending = (async () => {
    try {
      const res = await fetch(PROGRESS_SOUND_URL);
      if (!res.ok) return null;
      const blob = await res.blob();
      progressBlobUrl = URL.createObjectURL(blob);
      return progressBlobUrl;
    } catch {
      return null;
    } finally {
      progressBlobPending = null;
    }
  })();
  return progressBlobPending;
}

/** Blob URL of the success sound, or null until `warmProgressSoundBlob` ran. */
export function getProgressSoundBlobUrl(): string | null {
  return progressBlobUrl;
}

/** Test hook: drop the cached element, the blob and the unlocked flag. */
export function resetCelebrationSoundForTests(): void {
  element = null;
  unlocked = false;
  progressBlobUrl = null;
  progressBlobPending = null;
}
