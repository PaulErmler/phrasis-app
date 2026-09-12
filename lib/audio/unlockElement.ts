/**
 * Lift an element's autoplay restriction from inside a user gesture. WebKit
 * (iOS Safari, home-screen web app) lets an element play programmatically
 * only once THAT element has been started from a gesture, and it removes
 * the restriction at the top of `play()`, before any data is loaded, so a
 * muted `play()` followed by an immediate `pause()` is enough and stays
 * silent. The immediate pause rejects the play promise with AbortError,
 * which is expected and dropped.
 */
export function unlockElementInGesture(el: HTMLAudioElement): void {
  const wasMuted = el.muted;
  el.muted = true;
  let attempt: Promise<void> | undefined;
  try {
    attempt = el.play();
  } catch {
    // Legacy engines without a play promise.
  }
  el.pause();
  el.muted = wasMuted;
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch(() => {});
  }
}
