import { capture, CLIENT_EVENTS } from '@/lib/posthog/events';
import { audioSurfaceProperties } from './audioSurface';
import {
  declareAudioSessionType,
  observeAudioSessionState,
} from './audioSession';
import { unlockCardPlayerElement } from './cardPlayerElement';
import { unlockCelebrationSoundInGesture } from './celebrationSound';

/**
 * Use the first user gesture in the app to set up audio for the session:
 * declare the WebKit audio session `playback`, and lift the gesture
 * restriction on the card player's shared element and on the celebration
 * sound. Installed once at the `/app` root so the tap that opens the learn
 * view already counts; before, the element was created after that tap and
 * the first card's autoplay ran outside any gesture.
 *
 * `touchend` and `click` are the events WebKit counts as media gestures
 * (`touchstart` / `pointerdown` are not), `keydown` covers desktop. The
 * listeners stay installed until both elements are unlocked: a card
 * element holding a card, paused, is skipped by `unlockCardPlayerElement`
 * and gets the next tap instead.
 */
const GESTURE_EVENTS = ['touchend', 'click', 'keydown'] as const;

export function installAudioGestureUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};

  const stopObserving = observeAudioSessionState((state) => {
    if (state === 'active') return;
    capture(CLIENT_EVENTS.AUDIO_SESSION_STATE, {
      state,
      ...audioSurfaceProperties(),
    });
  });

  const remove = () => {
    for (const ev of GESTURE_EVENTS) {
      window.removeEventListener(ev, onGesture, true);
    }
  };
  const onGesture = () => {
    declareAudioSessionType();
    const card = unlockCardPlayerElement();
    const chime = unlockCelebrationSoundInGesture();
    if (card && chime) remove();
  };
  for (const ev of GESTURE_EVENTS) {
    window.addEventListener(ev, onGesture, true);
  }

  return () => {
    remove();
    stopObserving();
  };
}
