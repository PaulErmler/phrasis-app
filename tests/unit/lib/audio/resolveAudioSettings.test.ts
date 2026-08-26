import { describe, it, expect } from 'vitest';
import {
  resolveAudioSettings,
  resolveModeSetting,
  applyOnlyNewListening,
} from '@/lib/audio/mergeAudio';
import type { CourseSettings } from '@/components/app/learning/types';
import {
  DEFAULT_PLAY_TARGET_BEFORE_BASE,
  DEFAULT_PLAY_TARGET_AFTER_BASE,
  DEFAULT_PAUSE_TARGET_TO_BASE,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_REPETITIONS_TARGET_WRITING,
} from '@/lib/constants/audioPlayback';

const cs = (partial: Partial<CourseSettings>): CourseSettings =>
  partial as unknown as CourseSettings;

describe('resolveModeSetting: the per-field precedence primitive', () => {
  const doc = cs({
    autoPlayAudio: false,
    autoPlayAudioFull: true,
    autoPlayAudioTranscribe: false,
    highlightWords: true,
    pauseBaseToBase: 4,
    pauseBaseToBaseFull: 5,
  });

  it('walks `*Transcribe ?? *Full ?? unsuffixed` per mode', () => {
    expect(resolveModeSetting(doc, 'autoPlayAudio', 'audio')).toBe(false);
    expect(resolveModeSetting(doc, 'autoPlayAudio', 'full')).toBe(true);
    expect(resolveModeSetting(doc, 'autoPlayAudio', 'transcribe')).toBe(false);
  });

  it('falls through undefined levels to the base value in every mode', () => {
    // highlightWords has no stored Full/Transcribe copy.
    expect(resolveModeSetting(doc, 'highlightWords', 'audio')).toBe(true);
    expect(resolveModeSetting(doc, 'highlightWords', 'full')).toBe(true);
    expect(resolveModeSetting(doc, 'highlightWords', 'transcribe')).toBe(true);
  });

  it('treats a stored false as a value, never as a gap', () => {
    expect(
      resolveModeSetting(
        cs({ autoPlayAudio: true, autoPlayAudioTranscribe: false }),
        'autoPlayAudio',
        'transcribe',
      ),
    ).toBe(false);
    expect(
      resolveModeSetting(
        cs({ autoPlayAudio: true, autoPlayAudioFull: false }),
        'autoPlayAudio',
        'full',
      ),
    ).toBe(false);
  });

  it('audio mode never reads the per-mode copies', () => {
    expect(
      resolveModeSetting(
        cs({ autoPlayAudioFull: true, autoPlayAudioTranscribe: true }),
        'autoPlayAudio',
        'audio',
      ),
    ).toBeUndefined();
  });

  it('resolves fields with no *Transcribe copy in the schema like full mode', () => {
    expect(resolveModeSetting(doc, 'pauseBaseToBase', 'transcribe')).toBe(5);
    expect(resolveModeSetting(doc, 'pauseBaseToBase', 'full')).toBe(5);
    expect(resolveModeSetting(doc, 'pauseBaseToBase', 'audio')).toBe(4);
  });

  it('returns undefined for a null doc and for fully-unset fields', () => {
    expect(resolveModeSetting(null, 'autoPlayAudio', 'audio')).toBeUndefined();
    expect(
      resolveModeSetting(cs({}), 'autoPlayAudio', 'transcribe'),
    ).toBeUndefined();
  });
});

describe('resolveAudioSettings: per-mode precedence (`*Transcribe ?? *Full ?? unsuffixed`)', () => {
  // Every per-mode field set at every level, all distinct, so each mode's
  // pick is unambiguous. pauseBaseToBase / pauseBaseToTarget /
  // pauseBeforeAutoAdvance have no Transcribe copy (transcribe never plays
  // base audio and never auto-advances); transcribe must resolve them like
  // full mode.
  const allLevels = cs({
    languageRepetitions: { es: 1 },
    languageRepetitionsFull: { es: 2 },
    languageRepetitionsTranscribe: { es: 3 },
    languageRepetitionPauses: { es: 1.5 },
    languageRepetitionPausesFull: { es: 2.5 },
    languageRepetitionPausesTranscribe: { es: 3.5 },
    languagePlaybackSpeeds: { es: 0.8 },
    languagePlaybackSpeedsFull: { es: 1.0 },
    languagePlaybackSpeedsTranscribe: { es: 1.2 },
    pauseTargetToTarget: 1,
    pauseTargetToTargetFull: 2,
    pauseTargetToTargetTranscribe: 3,
    pauseBaseToBase: 4,
    pauseBaseToBaseFull: 5,
    pauseBaseToTarget: 6,
    pauseBaseToTargetFull: 7,
    pauseBeforeAutoAdvance: 8,
    pauseBeforeAutoAdvanceFull: 9,
  });

  it('audio mode reads only the unsuffixed fields', () => {
    const r = resolveAudioSettings(allLevels, undefined, 'audio');
    expect(r.reps).toEqual({ es: 1 });
    expect(r.repPauses).toEqual({ es: 1.5 });
    expect(r.speeds).toEqual({ es: 0.8 });
    expect(r.pauseT2T).toBe(1);
    expect(r.pauseB2B).toBe(4);
    expect(r.pauseB2T).toBe(6);
    expect(r.pauseBeforeAdvance).toBe(8);
    expect(r.defaultTargetReps).toBe(DEFAULT_REPETITIONS_TARGET);
  });

  it('full mode prefers *Full and ignores *Transcribe', () => {
    const r = resolveAudioSettings(allLevels, undefined, 'full');
    expect(r.reps).toEqual({ es: 2 });
    expect(r.repPauses).toEqual({ es: 2.5 });
    expect(r.speeds).toEqual({ es: 1.0 });
    expect(r.pauseT2T).toBe(2);
    expect(r.pauseB2B).toBe(5);
    expect(r.pauseB2T).toBe(7);
    expect(r.pauseBeforeAdvance).toBe(9);
    expect(r.defaultTargetReps).toBe(DEFAULT_REPETITIONS_TARGET_WRITING);
  });

  it('transcribe mode prefers *Transcribe, resolving Transcribe-less fields like full', () => {
    const r = resolveAudioSettings(allLevels, undefined, 'transcribe');
    expect(r.reps).toEqual({ es: 3 });
    expect(r.repPauses).toEqual({ es: 3.5 });
    expect(r.speeds).toEqual({ es: 1.2 });
    expect(r.pauseT2T).toBe(3);
    // No *Transcribe copy exists for these; the chain falls through to *Full.
    expect(r.pauseB2B).toBe(5);
    expect(r.pauseB2T).toBe(7);
    expect(r.pauseBeforeAdvance).toBe(9);
    expect(r.defaultTargetReps).toBe(DEFAULT_REPETITIONS_TARGET_WRITING);
  });

  it('falls through per field: transcribe → full → audio for unmigrated docs', () => {
    const onlyAudio = cs({
      languageRepetitions: { es: 1 },
      pauseTargetToTarget: 1,
    });
    for (const mode of ['audio', 'full', 'transcribe'] as const) {
      const r = resolveAudioSettings(onlyAudio, undefined, mode);
      expect(r.reps).toEqual({ es: 1 });
      expect(r.pauseT2T).toBe(1);
    }
    const audioAndFull = cs({
      languageRepetitions: { es: 1 },
      languageRepetitionsFull: { es: 2 },
      pauseTargetToTarget: 1,
      pauseTargetToTargetFull: 2,
    });
    const t = resolveAudioSettings(audioAndFull, undefined, 'transcribe');
    expect(t.reps).toEqual({ es: 2 });
    expect(t.pauseT2T).toBe(2);
  });

  it('applies the global defaults when no level stores a value', () => {
    for (const mode of ['audio', 'full', 'transcribe'] as const) {
      const r = resolveAudioSettings(null, undefined, mode);
      expect(r.reps).toEqual({});
      expect(r.repPauses).toEqual({});
      expect(r.speeds).toEqual({});
      expect(r.pauseT2T).toBe(DEFAULT_PAUSE_BETWEEN_LANGUAGES);
      expect(r.pauseB2B).toBe(DEFAULT_PAUSE_BETWEEN_LANGUAGES);
      expect(r.pauseB2T).toBe(DEFAULT_PAUSE_BASE_TO_TARGET);
      expect(r.pauseBeforeAdvance).toBe(DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE);
    }
  });

  it('a stored 0 is a value, not a gap: it must not fall through the chain', () => {
    const r = resolveAudioSettings(
      cs({ pauseTargetToTarget: 5, pauseTargetToTargetFull: 0 }),
      undefined,
      'transcribe',
    );
    expect(r.pauseT2T).toBe(0);
  });
});

describe('resolveAudioSettings: target before/after base', () => {
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
    // would pass for any implementation, assert the actual returned shape.)
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

describe('resolveAudioSettings: "Only new" limit mapping', () => {
  it('maps undefined / 0 to Infinity (always), and 1-10 to the number', () => {
    expect(resolveAudioSettings(null).beforeOnlyNewReps).toBe(Infinity);
    expect(
      resolveAudioSettings(cs({ targetBeforeOnlyNewReps: 0 }))
        .beforeOnlyNewReps,
    ).toBe(Infinity);
    expect(
      resolveAudioSettings(cs({ targetBeforeOnlyNewReps: 3 }))
        .beforeOnlyNewReps,
    ).toBe(3);
  });

  it('infers the strategy for legacy docs: positive rep window → onlyNew, 0/unset (old ∞) → continuous', () => {
    expect(resolveAudioSettings(null).listeningStrategy).toBe('continuous');
    expect(
      resolveAudioSettings(cs({ targetBeforeOnlyNewReps: 0 }))
        .listeningStrategy,
    ).toBe('continuous');
    expect(
      resolveAudioSettings(cs({ targetBeforeOnlyNewReps: 3 }))
        .listeningStrategy,
    ).toBe('onlyNew');
  });

  it('a stored strategy always wins over the legacy inference', () => {
    const u = resolveAudioSettings(
      cs({
        targetBeforeListeningStrategy: 'untilGood',
        targetBeforeUntilGoodReps: 3,
        targetBeforeOnlyNewReps: 0, // would infer 'continuous' without the stored value
      }),
    );
    expect(u.listeningStrategy).toBe('untilGood');
    expect(u.beforeUntilGoodReps).toBe(3);
    expect(
      resolveAudioSettings(
        cs({
          targetBeforeListeningStrategy: 'continuous',
          targetBeforeOnlyNewReps: 3,
        }),
      ).listeningStrategy,
    ).toBe('continuous');
    // untilGood reps default to 1 when unset.
    expect(resolveAudioSettings(null).beforeUntilGoodReps).toBe(1);
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
    expect(applyOnlyNewListening(s, { reviewCount: 0 }).playTargetBefore).toBe(
      true,
    );
    expect(applyOnlyNewListening(s, { reviewCount: 2 }).playTargetBefore).toBe(
      true,
    );
  });

  it('graduates the card once count reaches the limit (before off, after unchanged)', () => {
    const s = withLimit(3); // Practice Speaking defaults to on
    const g = applyOnlyNewListening(s, { reviewCount: 3 });
    expect(g.playTargetBefore).toBe(false);
    // Speaking was on (default) and is left as-is, not forced.
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

describe('applyOnlyNewListening: "until rated good" strategy', () => {
  const untilGood = (
    reps: number,
    overrides: Record<string, unknown> = {},
  ) => ({
    ...resolveAudioSettings(
      cs({
        playTargetBeforeBase: true,
        targetBeforeListeningStrategy: 'untilGood',
        targetBeforeUntilGoodReps: reps,
        ...overrides,
      }),
    ),
  });

  it('keeps Practice Listening on until the card has enough good/easy ratings', () => {
    const s = untilGood(2);
    expect(
      applyOnlyNewListening(s, { reviewCount: 99, goodReviewCount: 0 })
        .playTargetBefore,
    ).toBe(true);
    expect(
      applyOnlyNewListening(s, { reviewCount: 99, goodReviewCount: 1 })
        .playTargetBefore,
    ).toBe(true);
    expect(
      applyOnlyNewListening(s, { reviewCount: 99, goodReviewCount: 2 })
        .playTargetBefore,
    ).toBe(false);
  });

  it('treats a missing good count as 0 (pre-field cards stay in listening practice)', () => {
    const s = untilGood(1);
    expect(applyOnlyNewListening(s, { reviewCount: 99 }).playTargetBefore).toBe(
      true,
    );
  });

  it('ignores the review count and the onlyNew limit entirely', () => {
    // onlyNew limit of 1 would have graduated this card long ago; the
    // strategy switch makes the good count the only signal.
    const s = untilGood(1, { targetBeforeOnlyNewReps: 1 });
    expect(
      applyOnlyNewListening(s, { reviewCount: 50, goodReviewCount: 0 })
        .playTargetBefore,
    ).toBe(true);
    expect(
      applyOnlyNewListening(s, { reviewCount: 0, goodReviewCount: 1 })
        .playTargetBefore,
    ).toBe(false);
  });

  it('still requires both Practice groups on', () => {
    const s = untilGood(1, { playTargetAfterBase: false });
    expect(s.playTargetAfter).toBe(false);
    expect(
      applyOnlyNewListening(s, { reviewCount: 0, goodReviewCount: 5 }),
    ).toBe(s);
  });
});

describe("applyOnlyNewListening: 'continuous' strategy", () => {
  it('never graduates a card, no matter the counts', () => {
    const s = {
      ...resolveAudioSettings(
        cs({
          playTargetBeforeBase: true,
          targetBeforeListeningStrategy: 'continuous',
          // A rep window that would have graduated the card long ago under
          // 'onlyNew'. Must be ignored entirely.
          targetBeforeOnlyNewReps: 1,
        }),
      ),
    };
    expect(
      applyOnlyNewListening(s, {
        reviewCount: 99,
        radioReviewCount: 99,
        goodReviewCount: 99,
      }),
    ).toBe(s);
  });
});
