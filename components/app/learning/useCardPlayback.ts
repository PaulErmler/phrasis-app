'use client';

import { useMemo } from 'react';
import {
  useButtonPlayback,
  type ButtonPlaybackActive,
} from '@/hooks/use-button-playback';
import { useActiveCue, type MergedPlayback } from '@/hooks/use-active-cue';
import type { ClockBinding } from '@/hooks/use-karaoke-index';

/**
 * Shared merged-playback binding for the two card components
 * (FullReviewCardContent / LearningCardContent).
 *
 * Merged audio wins when it is actively playing; otherwise fall back to
 * whichever per-language AudioButton is running (for library previews /
 * individual replays). When nothing is playing, activeClip stays null and
 * the highlight leaves render neutral words.
 *
 * The merged path updates only on cue changes; per-frame word positions are
 * derived inside the highlight leaves from `clockBinding` (useKaraokeIndex),
 * so playback does not re-render the card component 60×/second.
 */
export function useCardPlayback(mergedPlayback: MergedPlayback | undefined) {
  const buttonPlayback = useButtonPlayback();
  const mergedCue = useActiveCue(mergedPlayback);
  const activeClip = useMemo<ButtonPlaybackActive | null>(() => {
    if (mergedCue) return { language: mergedCue.language, localTime: 0 };
    return buttonPlayback.active;
  }, [mergedCue, buttonPlayback.active]);
  const clockBinding = useMemo<ClockBinding | undefined>(() => {
    if (!mergedCue || !mergedPlayback) return undefined;
    return {
      clock: mergedPlayback.clock,
      cueStartSec: mergedCue.cueStartSec,
      speed: mergedCue.speed,
    };
  }, [mergedCue, mergedPlayback]);
  return { buttonPlayback, activeClip, clockBinding };
}

/**
 * Review count shown on the card: while in the FSRS review phase, total
 * reviews = preReviewCount + fsrsState.reps; otherwise just preReviewCount.
 */
export function displayReviewCount(
  preReviewCount: number,
  schedulingPhase: 'preReview' | 'review' | undefined,
  fsrsState: { reps: number } | null | undefined,
): number {
  return schedulingPhase === 'review' && fsrsState != null
    ? preReviewCount + fsrsState.reps
    : preReviewCount;
}
