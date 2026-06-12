import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type {
  ResolvedAudioSettings,
  LanguageCue,
} from '@/lib/audio/mergeAudio';
import type { CardAudioRecording } from '@/components/app/learning/types';

/**
 * Unit coverage for `mergeCardAudio`'s scheduling — the heart of the
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
  getDecodeContext: () => ({ decodeAudioData: async () => h.fakeBuffer(1.0) }),
  computePeakFromBuffer: () => 0.7,
  computeGain: () => 1,
}));

vi.mock('@/lib/audio/timeStretch', () => ({
  // rate === 1 returns the original; otherwise duration becomes 1 / rate.
  timeStretchBuffer: async (buffer: { duration: number; sampleRate: number }, rate: number) =>
    rate === 1 ? buffer : h.fakeBuffer(buffer.duration / rate, buffer.sampleRate),
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
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
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
): ResolvedAudioSettings => ({
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
});

const cue = (
  language: string,
  startSec: number,
  speed: number,
  reveals: boolean,
): LanguageCue => ({ language, startSec, speed, reveals });

// --- tests -----------------------------------------------------------------

describe('mergeCardAudio — sequencing', () => {
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

  it('base reps all zero: the two target groups are separated by pauseT2T', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es']),
      ['en'],
      ['es'],
      settings({
        playTargetBefore: true,
        playTargetAfter: true,
        reps: { en: 0, es: 1 }, // base en filtered out (reps 0); after es kept
        beforeReps: { es: 1 },
        pauseT2T: 3,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, false), // before play (es also plays after → no reveal)
      cue('es', 4, 1, true), // 1.0s before + 3s pauseT2T (no base between)
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

  it('returns null when every group filters out (no playable entries)', async () => {
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

  it('mixed split: es plays before-only, fr after-only (per-language group filtering)', async () => {
    const r = await mergeCardAudio(
      recs(['en', 'es', 'fr']),
      ['en'],
      ['es', 'fr'],
      settings({
        playTargetBefore: true,
        playTargetAfter: true,
        reps: { en: 1, es: 0, fr: 1 }, // after group: fr only (es filtered out)
        beforeReps: { es: 1, fr: 0 }, // before group: es only (fr filtered out)
        pauseT2B: 4,
        pauseB2T: 5,
      }),
    );
    expect(r!.languageCues).toEqual([
      cue('es', 0, 1, true), // before-only es reveals (never replayed after base)
      cue('en', 5, 1, true), // 1.0s es + 4s pauseT2B
      cue('fr', 11, 1, true), // 5 + 1.0s en + 5s pauseB2T
    ]);
    expect(r!.durationSec).toBe(12);
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
