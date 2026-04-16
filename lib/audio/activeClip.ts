import type { LanguageCue } from './mergeAudio';

/**
 * Translate a position on the merged-audio timeline into the currently
 * playing language clip and the time offset within that clip.
 *
 * Each repetition of a language produces its own cue, so `localTime` naturally
 * resets to 0 at each repetition — no special casing required by callers.
 * Returns null when `currentTime` is before the first cue (typically 0 at card
 * load, before playback begins).
 */
export function resolveActiveClip(
  cues: ReadonlyArray<LanguageCue>,
  currentTime: number,
): { language: string; localTime: number } | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].startSec <= currentTime) {
      return {
        language: cues[i].language,
        localTime: currentTime - cues[i].startSec,
      };
    }
  }
  return null;
}
