import { describe, it, expect } from 'vitest';
import { resolveAudioSettings } from '@/lib/audio/mergeAudio';
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
