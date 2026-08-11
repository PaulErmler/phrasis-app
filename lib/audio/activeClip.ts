import { audibleCues, type LanguageCue } from './mergeAudio';

/**
 * Translate a position on the merged-audio timeline into the currently
 * playing language clip and the time offset within that clip.
 *
 * Each repetition of a language produces its own cue, so `localTime` naturally
 * resets to 0 at each repetition — no special casing required by callers.
 * Returns null when `currentTime` is before the first cue (typically 0 at card
 * load, before playback begins).
 *
 * Silent placeholders are dropped up front (see `audibleCues`), so a
 * zero-repetition language is never reported as the active clip.
 *
 * Clips are time-stretched at merge time, so the returned `localTime` is
 * rescaled to the original (1×) timeline that word timings live on — otherwise
 * highlighting drifts because a stretched clip is `original / speed` long. The
 * speed is read from the matched cue (per-occurrence, so the same language can
 * play at different speeds before vs after base); `speedByLanguage` is an
 * optional legacy fallback for cues that predate the per-cue `speed` field.
 */
export function resolveActiveClip(
  cues: ReadonlyArray<LanguageCue>,
  currentTime: number,
  speedByLanguage?: Record<string, number>,
): { language: string; localTime: number } | null {
  const audible = audibleCues(cues);
  for (let i = audible.length - 1; i >= 0; i--) {
    if (audible[i].startSec <= currentTime) {
      const language = audible[i].language;
      const mergedLocal = currentTime - audible[i].startSec;
      const speed = audible[i].speed ?? speedByLanguage?.[language] ?? 1;
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
  /**
   * 0-based occurrence of `language` among the audible cues with the same
   * language — silent placeholders are not repetitions, so both this and
   * `mergedTimeForCuePosition` count the same set.
   */
  repIndex: number;
  /** In the original (1×) frame — same units as word timings. */
  localTimeOriginal: number;
}

export function resolveActiveCuePosition(
  cues: ReadonlyArray<LanguageCue>,
  currentTime: number,
  speedByLanguage?: Record<string, number>,
): ActiveCuePosition | null {
  const audible = audibleCues(cues);
  for (let i = audible.length - 1; i >= 0; i--) {
    if (audible[i].startSec <= currentTime) {
      const language = audible[i].language;
      let repIndex = 0;
      for (let j = 0; j < i; j++) {
        if (audible[j].language === language) repIndex++;
      }
      const speed = audible[i].speed ?? speedByLanguage?.[language] ?? 1;
      const localTimeOriginal = (currentTime - audible[i].startSec) * speed;
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
  const audible = audibleCues(newCues);
  let seen = 0;
  for (let i = 0; i < audible.length; i++) {
    if (audible[i].language !== pos.language) continue;
    if (seen === pos.repIndex) {
      const newSpeed = audible[i].speed ?? newSpeedByLanguage[pos.language] ?? 1;
      return audible[i].startSec + pos.localTimeOriginal / newSpeed;
    }
    seen++;
  }
  return null;
}
