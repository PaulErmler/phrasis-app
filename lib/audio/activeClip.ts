import type { LanguageCue } from './mergeAudio';

/**
 * Translate a position on the merged-audio timeline into the currently
 * playing language clip and the time offset within that clip.
 *
 * Each repetition of a language produces its own cue, so `localTime` naturally
 * resets to 0 at each repetition — no special casing required by callers.
 * Returns null when `currentTime` is before the first cue (typically 0 at card
 * load, before playback begins).
 *
 * When clips were time-stretched at merge time (per-language speed), pass
 * `speedByLanguage` so the returned `localTime` is rescaled to the original
 * (1×) timeline that word timings live on. Word-highlighting would drift
 * without this rescale because a stretched clip is `original / speed` long.
 */
export function resolveActiveClip(
  cues: ReadonlyArray<LanguageCue>,
  currentTime: number,
  speedByLanguage?: Record<string, number>,
): { language: string; localTime: number } | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].startSec <= currentTime) {
      const language = cues[i].language;
      const mergedLocal = currentTime - cues[i].startSec;
      const speed = speedByLanguage?.[language] ?? 1;
      return {
        language,
        localTime: mergedLocal * speed,
      };
    }
  }
  return null;
}
