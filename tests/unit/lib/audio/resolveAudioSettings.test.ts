import { describe, it, expect } from 'vitest';
import {
  resolveAudioSettings,
  applyOnlyNewListening,
} from '@/lib/audio/mergeAudio';
import type { CourseSettings } from '@/components/app/learning/types';
import {
  DEFAULT_PLAY_TARGET_BEFORE_BASE,
  DEFAULT_PLAY_TARGET_AFTER_BASE,
  DEFAULT_PAUSE_TARGET_TO_BASE,
} from '@/lib/constants/audioPlayback';

const cs = (partial: Partial<CourseSettings>): CourseSettings =>
  partial as unknown as CourseSettings;

describe('resolveAudioSettings — target before/after base', () => {
  it('defaults to the historical base→target sequence (after on, before off)', () => {
    const r = resolveAudioSettings(null);
    expect(r.playTargetBefore).toBe(DEFAULT_PLAY_TARGET_BEFORE_BASE);
    expect(r.playTargetAfter).toBe(DEFAULT_PLAY_TARGET_AFTER_BASE);
    expect(r.playTargetBefore).toBe(false);
    expect(r.playTargetAfter).toBe(true);
    expect(r.beforeReps).toEqual({});
    expect(r.beforeRepPauses).toEqual({});
    expect(r.beforeSpeeds).toEqual({});
    expect(r.pauseT2B).toBe(DEFAULT_PAUSE_TARGET_TO_BASE);
  });

  it('reflects stored toggles and independent before-base records', () => {
    const r = resolveAudioSettings(
      cs({
        playTargetBeforeBase: true,
        playTargetAfterBase: false,
        targetBeforeRepetitions: { es: 3 },
        targetBeforeRepetitionPauses: { es: 4 },
        targetBeforePlaybackSpeeds: { es: 0.7 },
        pauseTargetToBase: 6,
      }),
    );
    expect(r.playTargetBefore).toBe(true);
    expect(r.playTargetAfter).toBe(false);
    expect(r.beforeReps).toEqual({ es: 3 });
    expect(r.beforeRepPauses).toEqual({ es: 4 });
    expect(r.beforeSpeeds.es).toBe(0.7);
    expect(r.pauseT2B).toBe(6);
  });

  it('keeps before- and after-base speeds independent for the same language', () => {
    const r = resolveAudioSettings(
      cs({
        languagePlaybackSpeeds: { es: 1.2 },
        targetBeforePlaybackSpeeds: { es: 0.7 },
      }),
    );
    expect(r.speeds.es).toBe(1.2);
    expect(r.beforeSpeeds.es).toBe(0.7);
  });

  it('applies per-card overrides to the before-base speeds too', () => {
    const r = resolveAudioSettings(
      cs({ targetBeforePlaybackSpeeds: { es: 0.7 } }),
      { es: 0.9 },
    );
    expect(r.beforeSpeeds.es).toBe(0.9);
  });

  it('does not fabricate a before-speed entry for a language that only has reps', () => {
    // resolveAudioSettings only carries explicitly-set before speeds; the
    // fallback to DEFAULT_PLAYBACK_SPEED happens downstream in mergeCardAudio's
    // beforeSpeedFor, not here. (A vacuous `r.beforeSpeeds.es ?? DEFAULT` check
    // would pass for any implementation — assert the actual returned shape.)
    const r = resolveAudioSettings(cs({ targetBeforeRepetitions: { es: 2 } }));
    expect(r.beforeSpeeds).toEqual({});
    expect(r.beforeSpeeds.es).toBeUndefined();
  });

  it('supports both groups enabled at once', () => {
    const r = resolveAudioSettings(
      cs({ playTargetBeforeBase: true, playTargetAfterBase: true }),
    );
    expect(r.playTargetBefore).toBe(true);
    expect(r.playTargetAfter).toBe(true);
  });

  it('passes the before-group reps and rep-pauses through verbatim', () => {
    // reps/rep-pauses are not clamped or defaulted here (mergeCardAudio applies
    // DEFAULT_REPETITIONS_TARGET / DEFAULT_PAUSE_BETWEEN_REPETITIONS per-language),
    // so the resolved maps must be exactly what was stored.
    const r = resolveAudioSettings(
      cs({
        targetBeforeRepetitions: { es: 3, fr: 0 },
        targetBeforeRepetitionPauses: { es: 4, fr: 1.5 },
      }),
    );
    expect(r.beforeReps).toEqual({ es: 3, fr: 0 });
    expect(r.beforeRepPauses).toEqual({ es: 4, fr: 1.5 });
  });
});

describe('resolveAudioSettings — "Only new" limit mapping', () => {
  it('maps undefined / 0 to Infinity (always), and 1-10 to the number', () => {
    expect(resolveAudioSettings(null).beforeOnlyNewReps).toBe(Infinity);
    expect(
      resolveAudioSettings(cs({ targetBeforeOnlyNewReps: 0 })).beforeOnlyNewReps,
    ).toBe(Infinity);
    expect(
      resolveAudioSettings(cs({ targetBeforeOnlyNewReps: 3 })).beforeOnlyNewReps,
    ).toBe(3);
  });
});

describe('applyOnlyNewListening', () => {
  // Build a resolved settings object with Practice Listening on and a limit.
  const withLimit = (limit: number, playTargetBefore = true) => ({
    ...resolveAudioSettings(
      cs({
        playTargetBeforeBase: playTargetBefore,
        targetBeforeOnlyNewReps: limit,
      }),
    ),
  });

  it('no-ops when Practice Listening is off', () => {
    const s = withLimit(2, false);
    expect(applyOnlyNewListening(s, { reviewCount: 99 })).toBe(s);
  });

  it('no-ops when the limit is Infinity (always)', () => {
    const s = withLimit(0); // 0 → Infinity
    expect(s.beforeOnlyNewReps).toBe(Infinity);
    expect(applyOnlyNewListening(s, { reviewCount: 99 })).toBe(s);
  });

  it('keeps Practice Listening on while the card is still new (count < limit)', () => {
    const s = withLimit(3);
    expect(applyOnlyNewListening(s, { reviewCount: 0 }).playTargetBefore).toBe(true);
    expect(applyOnlyNewListening(s, { reviewCount: 2 }).playTargetBefore).toBe(true);
  });

  it('graduates the card once count reaches the limit (before off, after unchanged)', () => {
    const s = withLimit(3); // Practice Speaking defaults to on
    const g = applyOnlyNewListening(s, { reviewCount: 3 });
    expect(g.playTargetBefore).toBe(false);
    // Speaking was on (default) and is left as-is — not forced.
    expect(g.playTargetAfter).toBe(true);
  });

  it('no-ops when Practice Speaking is off ("Only new" needs both groups on)', () => {
    const s = {
      ...resolveAudioSettings(
        cs({
          playTargetBeforeBase: true,
          playTargetAfterBase: false,
          targetBeforeOnlyNewReps: 2,
        }),
      ),
    };
    expect(s.playTargetAfter).toBe(false);
    // "Only new" graduates Listening → Speaking, so with Speaking off it is
    // inert (treated as ∞): Practice Listening keeps playing on every review.
    expect(applyOnlyNewListening(s, { reviewCount: 99 })).toBe(s);
  });

  it('counts max(active reviews, radio plays) in radio mode', () => {
    const s = withLimit(4);
    // Active reviews 0 but 5 radio plays → graduated (radio plays count).
    const radio = applyOnlyNewListening(s, {
      reviewCount: 0,
      radioReviewCount: 5,
    });
    expect(radio.playTargetBefore).toBe(false);
    // Active reviews 1 and 2 radio plays → max is 2 < 4 → still new.
    const stillNew = applyOnlyNewListening(s, {
      reviewCount: 1,
      radioReviewCount: 2,
    });
    expect(stillNew.playTargetBefore).toBe(true);
  });
});
