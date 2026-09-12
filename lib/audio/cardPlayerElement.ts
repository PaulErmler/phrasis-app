/**
 * The one `HTMLAudioElement` the card player plays through, shared by every
 * LearnView mount for the life of the page.
 *
 * Why a page-level singleton instead of one element per hook instance:
 *
 * 1. Autoplay policy. WebKit (iOS Safari, home-screen web app) lets an
 *    element play programmatically only once THAT element has been started
 *    from a user gesture. The tap that opens the learn view is spent before a
 *    per-mount element exists, so the first card's autoplay ran outside any
 *    gesture and was refused. `unlockCardPlayerElement` runs inside the
 *    first tap anywhere in the app (see `lib/audio/gestureUnlock.ts`) and the
 *    unlock survives every later mount because the element is never
 *    recreated.
 *
 * 2. Session identity. iOS keeps the Now Playing slot on the page as long as
 *    the same element keeps a source; a fresh element per lesson has to win
 *    the slot back from whatever app was playing before.
 *
 * The element stays detached from the DOM on purpose: `new Audio()` that was
 * never inserted is never "removed from a document", so the spec's pause-on-
 * removal step cannot fire, and `AppUpdateGate` relies on the element being
 * undiscoverable by a DOM sweep.
 */

import { getSilenceBlobUrl } from './silence';
import { unlockElementInGesture } from './unlockElement';

let element: HTMLAudioElement | null = null;
let unlocked = false;

export function getCardPlayerElement(): HTMLAudioElement {
  if (!element) {
    element = new Audio();
    element.preload = 'auto';
    // Modern browsers default preservesPitch to true, but set it explicitly
    // (plus the webkit prefix for older Safari) so any future call that
    // touches `playbackRate` on this element stays pitch-stable.
    element.preservesPitch = true;
    (element as HTMLAudioElement & { webkitPreservesPitch?: boolean })
      .webkitPreservesPitch = true;
  }
  return element;
}

/** True once the element has been started from a user gesture. */
export function isCardPlayerUnlocked(): boolean {
  return unlocked;
}

/**
 * Lift the element's gesture restriction (see `unlockElementInGesture`).
 * Must run inside a user gesture. Returns whether the element is unlocked
 * afterwards; an element holding a card, paused, is skipped (a `play()`
 * there would be audible) and the caller keeps listening for the next tap.
 * An empty or silence-parked element is fine.
 */
export function unlockCardPlayerElement(): boolean {
  if (unlocked) return true;
  const el = getCardPlayerElement();
  if (!el.paused) {
    // Already playing from a gesture of its own.
    unlocked = true;
    return true;
  }
  if (el.getAttribute('src') !== null && el.src !== getSilenceBlobUrl()) {
    return false;
  }
  unlockElementInGesture(el);
  unlocked = true;
  return true;
}

/** Test hook: drop the cached element and the unlocked flag. */
export function resetCardPlayerElementForTests(): void {
  element = null;
  unlocked = false;
}
