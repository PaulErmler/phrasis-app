import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vitest';
import type {
  ResolvedAudioSettings,
  LanguageCue,
} from '@/lib/audio/mergeAudio';
import type { CardAudioRecording } from '@/components/app/learning/types';

/**
 * Unit coverage for `mergeCardAudio`'s scheduling. The heart of the
 * "Practice Listening / Speaking" feature (target-before / target-after base).
 *
 * The Web-Audio surface is mocked so the real scheduling code runs unchanged
 * and we can assert the produced `languageCues` (order, `startSec`, per-cue
 * `speed`, `reveals`), `durationSec`, and `speedByLanguage`:
 *   - every decoded clip is a fixed 1.0s buffer,
 *   - `timeStretchBuffer(buf, rate)` returns a `1.0 / rate`-second buffer, so
 *     the cursor math directly reflects each clip's effective speed,
 *   - gain/peak/encode/render are inert stubs (irrelevant to scheduling).
 */

const h = vi.hoisted(() => {
  const fakeBuffer = (duration: number, sampleRate = 48000) => ({
    duration,
    sampleRate,
    numberOfChannels: 1,
    length: Math.max(1, Math.ceil(duration * sampleRate)),
    getChannelData: () => new Float32Array(1),
  });
  return { fakeBuffer };
});

vi.mock('@/lib/audio/peakCache', () => ({
  // Decoded source clips are all 1.0s; gain/peak are inert.
  // `sampleRate` is read only when nothing was decoded (a fully silent merge).
  getDecodeContext: () => ({
    decodeAudioData: async () => h.fakeBuffer(1.0),
    sampleRate: 48000,
  }),
  computePeakFromBuffer: () => 0.7,
  computeGain: () => 1,
}));

vi.mock('@/lib/audio/timeStretch', () => ({
  // rate === 1 returns the original; otherwise duration becomes 1 / rate.
  timeStretchBuffer: async (
    buffer: { duration: number; sampleRate: number },
    rate: number,
  ) =>
    rate === 1
      ? buffer
      : h.fakeBuffer(buffer.duration / rate, buffer.sampleRate),
}));

vi.mock('audiobuffer-to-wav', () => ({ default: () => new ArrayBuffer(8) }));

// Imported AFTER the mocks are registered (vi.mock is hoisted, so this is fine).
import { mergeCardAudio } from '@/lib/audio/mergeAudio';

beforeAll(() => {
  // jsdom has no working URL.createObjectURL.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
    'blob:mock';
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
  class MockOfflineAudioContext {
    destination = {};
    createBufferSource() {
      return { buffer: null, connect() {}, start() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    async startRendering() {
      return h.fakeBuffer(1.0);
    }
  }
  vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- helpers ---------------------------------------------------------------

const recs = (langs: string[]): CardAudioRecording[] =>
  langs.map((language) => ({
    language,
    voiceName: null,
    url: `u-${language}`,
    wordTimings: null,
    ttsQuality: null,
  }));

const settings = (
  overrides: Partial<ResolvedAudioSettings> = {},
): ResolvedAudioSettings =>
  ({
    reps: {},
    repPauses: {},
    speeds: {},
    pauseB2B: 3,
    pauseB2T: 5,
    pauseT2T: 3,
    autoAdvance: false,
    pauseBeforeAdvance: 2,
    playTargetBefore: false,
    playTargetAfter: true,
    beforeReps: {},
    beforeRepPauses: {},
    beforeSpeeds: {},
    pauseT2B: 5,
    beforeOnlyNewReps: Infinity,
    ...overrides,
    // `defaultTargetReps` is intentionally absent unless overridden: these
    // fixtures predate the field and pin the resolved-undefined fallback path.
  }) as ResolvedAudioSettings;

const cue = (
  language: string,
  startSec: number,
  speed: number,
  reveals: boolean,
): LanguageCue => ({ language, startSec, speed, reveals });

/**
 * Placeholder cue for a language whose repetitions are 0: it marks where the
 * clip would have started so auto-reveal still fires, but schedules no audio
 * and consumes no time.
 */
const silentCue = (
  language: string,
  startSec: number,
  speed: number,
  reveals: boolean,
): LanguageCue => ({ language, startSec, speed, reveals, silent: true });

// --- tests -----------------------------------------------------------------

describe('mergeCardAudio: sequencing', () => {
  it('after-only (default): base → after-target, all revealing', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({ reps: { en: 1, es: 1 } }),
    );
    expect(r).not.toBeNull();
    expect(r!.languageCues).toEqual([
      cue('en', 0, 1, true),
      cue('es', 6, 1, true), // 1.0s base + 5s pauseB2T
    ]);
    expect(r!.durationSec).toBe(7);
    expect(r!.speedByLanguage).toEqual({ en: 1, es: 1 });
  });

  it('before-only: before-target → base, pauseTargetToBase between them', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: false,
        reps: { en: 1 },
        beforeReps: { es: 1 },
        pauseT2B: 5,
      }),
    );
    // No after-base play, so the before-base cue DOES reveal.
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, true),
      cue('en', 6, 1, true), // 1.0s before-target + 5s pauseT2B
    ]);
    expect(r!.durationSec).toBe(7);
  });

  it('before + after for the SAME language: independent speeds, only after reveals', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: true,
        reps: { en: 1, es: 1 }, // after-target es reuses settings.reps
        beforeReps: { es: 1 },
        speeds: { es: 2 }, // after es plays fast → 0.5s clip
        beforeSpeeds: { es: 0.5 }, // before es plays slow → 2.0s clip
        pauseT2B: 4,
        pauseB2T: 5,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 0.5, false), // before-base play does NOT reveal (also plays after)
      cue('en', 6, 1, true), // 2.0s before clip + 4s pauseT2B
      cue('es', 12, 2, true), // 1.0s base + 5s pauseB2T; after play reveals
    ]);
    // 12.0 + 0.5s (after clip at 2×) = 12.5
    expect(r!.durationSec).toBe(12.5);
    // The language map keeps only the last write (after-group speed); per-cue
    // speed is what consumers actually read for the dual-group language.
    expect(r!.speedByLanguage).toEqual({ en: 1, es: 2 });
  });

  it('base reps all zero: the silent base group keeps its surrounding pauses', async () => {
    // The base language is still in the composition. It just plays 0 times.
    // The pauses the user sees around it (pauseT2B, pauseB2T) must still
    // elapse as silence instead of the groups snapping together.
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: true,
        reps: { en: 0, es: 1 }, // base en silent (reps 0); after es kept
        beforeReps: { es: 1 },
        pauseT2B: 4,
        pauseB2T: 5,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, false), // before play (es also plays after → no reveal)
      silentCue('en', 5, 1, true), // base would have started here → un-blurs the base text
      cue('es', 10, 1, true), // 1.0s before + 4s pauseT2B + silent base + 5s pauseB2T
    ]);
    expect(r!.durationSec).toBe(11);
  });

  it('base reps zero, after-only: pauseB2T still plays as leading silence', async () => {
    // Regression: zeroing base reps used to drop pauseB2T entirely, so the
    // target blasted out instantly even though settings still showed a pause.
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        reps: { en: 0, es: 1 },
        pauseB2T: 5,
      }),
    );
    expect(r!.languageCues).toEqual([
      silentCue('en', 0, 1, true), // base would have started here → un-blurs the base text
      cue('es', 5, 1, true), // 5s leading silence (pauseB2T), then the target
    ]);
    expect(r!.durationSec).toBe(6);
  });

  it('base reps zero, before-only: pauseT2B still elapses as trailing silence', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: false,
        reps: { en: 0 },
        beforeReps: { es: 1 },
        pauseT2B: 5,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, true),
      // The base slot lands on the very last instant of the timeline. The
      // player's `ended` sweep is what guarantees this reveal actually fires.
      silentCue('en', 6, 1, true),
    ]);
    expect(r!.durationSec).toBe(6); // 1.0s before clip + 5s pauseT2B silence
  });

  it('no base in the composition (e.g. transcribe): no phantom pauses added', async () => {
    // orderedBase empty means base is deliberately excluded. Target groups
    // are separated by pauseT2T and no base-adjacent silence appears.
    const r = await mergeCardAudio(
      recs(['es']),
      [],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: true,
        reps: { es: 1 },
        beforeReps: { es: 1 },
        pauseT2T: 3,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, false),
      cue('es', 4, 1, true), // 1.0s before + 3s pauseT2T (no base in composition)
    ]);
    expect(r!.durationSec).toBe(5);
  });

  it('multi-rep base uses repPauses between repetitions', async () => {
    const r = await mergeCardAudio(
      recs(['en']),
      ['en'],
      [],
      settings({
        playTargetAfter: false,
        reps: { en: 3 },
        repPauses: { en: 2 },
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('en', 0, 1, true),
      cue('en', 3, 1, true), // 1.0s clip + 2s repPause
      cue('en', 6, 1, true),
    ]);
    expect(r!.durationSec).toBe(7);
  });

  it('before-group multi-rep uses beforeRepPauses (not repPauses)', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: false,
        reps: { en: 1 },
        repPauses: { en: 9 }, // must NOT be used for the before-target group
        beforeReps: { es: 2 },
        beforeRepPauses: { es: 1.5 },
        pauseT2B: 5,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, true),
      cue('es', 2.5, 1, true), // 1.0s clip + 1.5s beforeRepPause
      cue('en', 8.5, 1, true), // 2.5 + 1.0 (2nd before clip) + 5s pauseT2B
    ]);
    expect(r!.durationSec).toBe(9.5);
  });

  it('appends pauseBeforeAdvance to the duration (not the cues) when autoAdvance', async () => {
    const r = await mergeCardAudio(
      recs(['en']),
      ['en'],
      [],
      settings({
        playTargetAfter: false,
        reps: { en: 1 },
        autoAdvance: true,
        pauseBeforeAdvance: 2,
      }),
    );
    expect(r!.languageCues).toEqual([cue('en', 0, 1, true)]);
    expect(r!.durationSec).toBe(3); // 1.0s clip + 2s pauseBeforeAdvance
  });

  it('returns null when nothing is audible and no pause fills the timeline', async () => {
    // The one genuinely empty case: a silent base slot, both target groups off
    // and no pauses around it. There is no timeline to reveal along, so there
    // is nothing worth rendering.
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: false,
        playTargetAfter: false,
        reps: { en: 0 },
      }),
    );
    expect(r).toBeNull();
  });

  it('mixed split: es plays before-only, fr after-only (silent slots keep their place)', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es', 'fr']),
      ['en'],
      ['es', 'fr'],
      settings({
        playTargetBefore: true,
        playTargetAfter: true,
        reps: { en: 1, es: 0, fr: 1 }, // after group: fr audible, es silent
        beforeReps: { es: 1, fr: 0 }, // before group: es audible, fr silent
        pauseT2B: 4,
        pauseB2T: 5,
      }),
    );
    // Each zeroed language keeps its slot, and its share of the surrounding
    // pauses, so its reveal fires where the clip would have been, not at a
    // neighbour's edge.
    expect(r!.languageCues).toEqual([
      // es also plays after base (silently), so the after-base slot owns its
      // reveal. The learner still gets the guess-then-see flow.
      cue('es', 0, 1, false),
      silentCue('fr', 4, 1, false), // fr is replayed after base → no reveal here
      cue('en', 8, 1, true), // 1.0s es + 3s pauseT2T + silent fr + 4s pauseT2B
      silentCue('es', 14, 1, true), // 8 + 1.0s en + 5s pauseB2T → un-blurs es
      cue('fr', 17, 1, true), // + 3s pauseT2T
    ]);
    expect(r!.durationSec).toBe(18);
    // es and fr are each audible in exactly one group, so both still land a
    // speed. The silent slots deliberately write none.
    expect(r!.speedByLanguage).toEqual({ es: 1, en: 1, fr: 1 });
  });

  it('plays base only when both target groups are disabled', async () => {
    // The base group is independent of the Practice Listening / Speaking
    // toggles, so with both target groups off only the base language plays.
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: false,
        playTargetAfter: false,
        reps: { en: 1 },
      }),
    );
    expect(r!.languageCues).toEqual([cue('en', 0, 1, true)]);
    expect(r!.durationSec).toBe(1);
  });
});

describe('mergeCardAudio: zero repetitions still reveal', () => {
  it('un-blurs a zero-rep target where its audio would have played', async () => {
    // The reported bug: repetitions 0 + "auto un-blur when the audio plays"
    // used to drop the language from the merge entirely, so its text stayed
    // blurred for the whole card.
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({ reps: { en: 1, es: 0 }, pauseB2T: 5 }),
    );
    expect(r).not.toBeNull();
    expect(r!.languageCues).toEqual([
      cue('en', 0, 1, true),
      silentCue('es', 6, 1, true), // 1.0s base + 5s pauseB2T — where es would have started
    ]);
    expect(r!.durationSec).toBe(6);
    // Nothing was stretched for es, so it writes no speed.
    expect(r!.speedByLanguage).toEqual({ en: 1 });
  });

  it('keeps the reveal at the after-base slot when Practice Listening is on', async () => {
    // es is heard before base and zeroed after it. The reveal still belongs to
    // the after-base slot, so the learner gets the full guessing window.
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: true,
        reps: { en: 1, es: 0 },
        beforeReps: { es: 1 },
        pauseT2B: 4,
        pauseB2T: 5,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, false), // audible, but deliberately does not reveal
      cue('en', 5, 1, true),
      silentCue('es', 11, 1, true), // the reveal
    ]);
    expect(r!.durationSec).toBe(11);
  });

  it('never fetches or stretches a silent language', async () => {
    await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({ reps: { en: 1, es: 0 } }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('u-en');
  });

  it('renders the pauses as silence when nothing at all is audible', async () => {
    // Every language muted, but the configured pauses still describe a real
    // timeline, so it plays as silence and each line un-blurs on schedule.
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({ reps: { en: 0, es: 0 }, pauseB2T: 5 }),
    );
    expect(r).not.toBeNull();
    expect(r!.languageCues).toEqual([
      silentCue('en', 0, 1, true),
      silentCue('es', 5, 1, true),
    ]);
    expect(r!.durationSec).toBe(5);
    expect(r!.speedByLanguage).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reveals a zero-rep language that has no recording at all', async () => {
    // Zeroed repetitions are the user's choice regardless of whether audio was
    // ever generated for that language.
    const r = await mergeCardAudio(
      recs(['en']),
      ['en'],
      ['es'],
      settings({ reps: { en: 1, es: 0 }, pauseB2T: 5 }),
    );
    expect(r!.languageCues).toEqual([
      cue('en', 0, 1, true),
      silentCue('es', 6, 1, true),
    ]);
  });
});
