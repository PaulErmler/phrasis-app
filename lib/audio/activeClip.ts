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

/**
 * Like `resolveActiveClip` but also reports the repetition index of the active
 * clip within its language. Used to capture-and-restore playback position
 * across a remerge: the user's structural position `(language, repIndex,
 * localTimeOriginal)` is invariant under a speed-only settings change, so the
 * equivalent merged-timeline time in the new blob can be recovered via
 * `mergedTimeForCuePosition`.
 */
export interface ActiveCuePosition {
  language: string;
  /** 0-based occurrence of `language` among all cues with the same language. */
  repIndex: number;
  /** In the original (1×) frame — same units as word timings. */
  localTimeOriginal: number;
}

export function resolveActiveCuePosition(
  cues: ReadonlyArray<LanguageCue>,
  currentTime: number,
  speedByLanguage?: Record<string, number>,
): ActiveCuePosition | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].startSec <= currentTime) {
      const language = cues[i].language;
      let repIndex = 0;
      for (let j = 0; j < i; j++) {
        if (cues[j].language === language) repIndex++;
      }
      const speed = speedByLanguage?.[language] ?? 1;
      const localTimeOriginal = (currentTime - cues[i].startSec) * speed;
      return { language, repIndex, localTimeOriginal };
    }
  }
  return null;
}

/**
 * Map an `ActiveCuePosition` captured from one merge onto the merged-timeline
 * time of another (e.g. after a speed-only remerge). Returns null when the
 * target language/repIndex is absent in the new cue list — callers should
 * fall back to playing from the start.
 *
 * Caller is responsible for clamping the result to the new blob's duration.
 */
export function mergedTimeForCuePosition(
  newCues: ReadonlyArray<LanguageCue>,
  newSpeedByLanguage: Record<string, number>,
  pos: ActiveCuePosition,
): number | null {
  let seen = 0;
  for (let i = 0; i < newCues.length; i++) {
    if (newCues[i].language !== pos.language) continue;
    if (seen === pos.repIndex) {
      const newSpeed = newSpeedByLanguage[pos.language] ?? 1;
      return newCues[i].startSec + pos.localTimeOriginal / newSpeed;
    }
    seen++;
  }
  return null;
}
