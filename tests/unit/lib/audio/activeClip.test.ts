import { describe, it, expect } from 'vitest';
import {
  resolveActiveClip,
  resolveActiveCuePosition,
  mergedTimeForCuePosition,
} from '@/lib/audio/activeClip';
import type { LanguageCue } from '@/lib/audio/mergeAudio';

describe('resolveActiveClip', () => {
  it('returns null for an empty cue array', () => {
    expect(resolveActiveClip([], 0)).toBeNull();
    expect(resolveActiveClip([], 5)).toBeNull();
  });

  it('returns null when currentTime is before the first cue', () => {
    const cues: LanguageCue[] = [{ language: 'en', startSec: 0.5 }];
    expect(resolveActiveClip(cues, 0)).toBeNull();
    expect(resolveActiveClip(cues, 0.49)).toBeNull();
  });

  it('selects a cue when currentTime exactly hits its boundary (localTime=0)', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 1.5 },
    ];
    expect(resolveActiveClip(cues, 1.5)).toEqual({
      language: 'es',
      localTime: 0,
    });
  });

  it('returns the active cue and the offset within it for a mid-clip time', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
      { language: 'de', startSec: 4 },
    ];
    expect(resolveActiveClip(cues, 1.2)).toEqual({
      language: 'en',
      localTime: 1.2,
    });
    expect(resolveActiveClip(cues, 3.5)).toEqual({
      language: 'es',
      localTime: 1.5,
    });
    expect(resolveActiveClip(cues, 4.0)).toEqual({
      language: 'de',
      localTime: 0,
    });
  });

  it('resets localTime at each repetition of the same language', () => {
    // Same language repeated — each rep is its own cue, so localTime resets
    // naturally without callers needing to track repetition count.
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'en', startSec: 2.5 },
    ];
    expect(resolveActiveClip(cues, 1.0)).toEqual({
      language: 'en',
      localTime: 1.0,
    });
    expect(resolveActiveClip(cues, 3.0)).toEqual({
      language: 'en',
      localTime: 0.5,
    });
  });

  it('keeps returning the last cue when currentTime runs past it', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
    ];
    expect(resolveActiveClip(cues, 100)).toEqual({
      language: 'es',
      localTime: 98,
    });
  });

  it('prefers the per-cue speed over the language map (same lang, two speeds)', () => {
    // resolveActiveClip is the function the live word-highlight render path uses
    // (LearningCardContent / FullReviewCardContent). The same language plays
    // before base at 0.7× and after base at 1.2×; each occurrence must rescale
    // localTime by its own cue speed, not one language-keyed value.
    const cues: LanguageCue[] = [
      { language: 'es', startSec: 0, speed: 0.7 }, // before-base
      { language: 'en', startSec: 5, speed: 1 },
      { language: 'es', startSec: 8, speed: 1.2 }, // after-base
    ];
    expect(resolveActiveClip(cues, 1.0)).toEqual({
      language: 'es',
      localTime: 0.7,
    });
    expect(resolveActiveClip(cues, 9.0)).toEqual({
      language: 'es',
      localTime: 1.2,
    });
    // cue.speed must win over a conflicting speedByLanguage fallback, which for
    // a dual-group language holds only the after-group's 1.2× (the before-group
    // value was overwritten in scheduleGroup). This is the load-bearing case.
    expect(resolveActiveClip(cues, 1.0, { es: 1.2 })).toEqual({
      language: 'es',
      localTime: 0.7,
    });
  });
});

describe('resolveActiveCuePosition', () => {
  it('returns null for an empty cue array', () => {
    expect(resolveActiveCuePosition([], 0)).toBeNull();
    expect(resolveActiveCuePosition([], 5)).toBeNull();
  });

  it('returns null before the first cue', () => {
    const cues: LanguageCue[] = [{ language: 'en', startSec: 0.5 }];
    expect(resolveActiveCuePosition(cues, 0)).toBeNull();
  });

  it('reports rep 0 for the first occurrence of a language', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
    ];
    expect(resolveActiveCuePosition(cues, 1.2)).toEqual({
      language: 'en',
      repIndex: 0,
      localTimeOriginal: 1.2,
    });
  });

  it('reports the correct rep index for repeated languages', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
      { language: 'en', startSec: 4 }, // rep 1 of en
      { language: 'es', startSec: 6 }, // rep 1 of es
    ];
    expect(resolveActiveCuePosition(cues, 4.5)).toEqual({
      language: 'en',
      repIndex: 1,
      localTimeOriginal: 0.5,
    });
    expect(resolveActiveCuePosition(cues, 6.75)).toEqual({
      language: 'es',
      repIndex: 1,
      localTimeOriginal: 0.75,
    });
  });

  it('rescales localTime to the original frame using speedByLanguage', () => {
    // en baked at 0.8× → original offset = mergedOffset * 0.8
    const cues: LanguageCue[] = [{ language: 'en', startSec: 0 }];
    expect(
      resolveActiveCuePosition(cues, 1.0, { en: 0.8 }),
    ).toEqual({
      language: 'en',
      repIndex: 0,
      localTimeOriginal: 0.8,
    });
  });

  it('prefers the per-cue speed over the language map (same lang, two speeds)', () => {
    // The same language plays before base at 0.7× and after base at 1.2×.
    // Each occurrence must rescale by its own cue speed, not a single
    // language-keyed value.
    const cues: LanguageCue[] = [
      { language: 'es', startSec: 0, speed: 0.7 }, // before-base
      { language: 'en', startSec: 5, speed: 1 },
      { language: 'es', startSec: 8, speed: 1.2 }, // after-base
    ];
    expect(resolveActiveCuePosition(cues, 1.0)).toEqual({
      language: 'es',
      repIndex: 0,
      localTimeOriginal: 0.7,
    });
    expect(resolveActiveCuePosition(cues, 9.0)).toEqual({
      language: 'es',
      repIndex: 1,
      localTimeOriginal: 1.2,
    });
  });
});

describe('mergedTimeForCuePosition', () => {
  it('maps a captured position to the same time on an identical cue list', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
    ];
    const speeds = { en: 1, es: 1 };
    const pos = resolveActiveCuePosition(cues, 2.5, speeds)!;
    expect(mergedTimeForCuePosition(cues, speeds, pos)).toBeCloseTo(2.5, 10);
  });

  it('maps across a speed-only change: localTimeOriginal is invariant', () => {
    // Old merge: en at 1×, 2s long. Es starts at 2s, 1× → localTimeOriginal 0.5.
    const oldCues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
    ];
    const pos = resolveActiveCuePosition(oldCues, 2.5, { en: 1, es: 1 })!;

    // New merge: en now at 0.5× (takes 4s) so es starts at 4s. Es baked at 0.5×
    // too → 0.5s original offset = 1.0s merged offset. Expected merged time = 5.
    const newCues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 4 },
    ];
    expect(
      mergedTimeForCuePosition(newCues, { en: 0.5, es: 0.5 }, pos),
    ).toBeCloseTo(5, 10);
  });

  it('targets the matching rep of a repeated language', () => {
    const oldCues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'en', startSec: 3 }, // rep 1 @ 1×
    ];
    const pos = resolveActiveCuePosition(oldCues, 3.6, { en: 1 })!;
    expect(pos.repIndex).toBe(1);

    const newCues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'en', startSec: 4 }, // rep 1 @ 0.5×
    ];
    // localTimeOriginal = 0.6 → at 0.5× that's 1.2s merged offset from rep-1 start.
    expect(
      mergedTimeForCuePosition(newCues, { en: 0.5 }, pos),
    ).toBeCloseTo(5.2, 10);
  });

  it('returns null when the language is absent in the new cue list', () => {
    const pos = {
      language: 'de',
      repIndex: 0,
      localTimeOriginal: 1,
    };
    const newCues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
    ];
    expect(
      mergedTimeForCuePosition(newCues, { en: 1, es: 1 }, pos),
    ).toBeNull();
  });

  it('returns null when the requested repIndex is absent', () => {
    const pos = {
      language: 'en',
      repIndex: 1, // only one rep now
      localTimeOriginal: 0.5,
    };
    const newCues: LanguageCue[] = [{ language: 'en', startSec: 0 }];
    expect(mergedTimeForCuePosition(newCues, { en: 1 }, pos)).toBeNull();
  });

  it('round-trips through resolve+map when cues and speeds are unchanged', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 2 },
      { language: 'en', startSec: 5 },
    ];
    const speeds = { en: 0.8, es: 1.2 };
    for (const t of [0.1, 1.9, 2.0, 2.5, 4.99, 5.0, 7.25]) {
      const pos = resolveActiveCuePosition(cues, t, speeds)!;
      expect(mergedTimeForCuePosition(cues, speeds, pos)).toBeCloseTo(t, 10);
    }
  });
});

describe('silent cues (zero-repetition placeholders)', () => {
  it('resolveActiveClip never returns a silent cue', () => {
    // The damaging case: a group ending in a silent slot. Without the skip the
    // word highlight would jump to a language that played nothing.
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'es', startSec: 5, silent: true },
    ];
    expect(resolveActiveClip(cues, 6)).toEqual({ language: 'en', localTime: 6 });
  });

  it('prefers the real cue when a silent cue shares its startSec', () => {
    const cues: LanguageCue[] = [
      { language: 'es', startSec: 2, silent: true },
      { language: 'en', startSec: 2 },
    ];
    expect(resolveActiveClip(cues, 2.5)).toEqual({ language: 'en', localTime: 0.5 });
  });

  it('returns null when only silent cues precede currentTime', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0, silent: true },
      { language: 'es', startSec: 9 },
    ];
    expect(resolveActiveClip(cues, 3)).toBeNull();
  });

  it('resolveActiveCuePosition counts audible repetitions only', () => {
    const cues: LanguageCue[] = [
      { language: 'es', startSec: 0, silent: true },
      { language: 'en', startSec: 2 },
      { language: 'es', startSec: 5 },
    ];
    expect(resolveActiveCuePosition(cues, 5.5)).toEqual({
      language: 'es',
      repIndex: 0, // the silent slot is not a repetition
      localTimeOriginal: 0.5,
    });
  });

  it('mergedTimeForCuePosition skips a silent cue of the same language', () => {
    const pos = { language: 'es', repIndex: 0, localTimeOriginal: 0.5 };
    const newCues: LanguageCue[] = [
      { language: 'es', startSec: 0, silent: true },
      { language: 'es', startSec: 4 },
    ];
    expect(mergedTimeForCuePosition(newCues, { es: 1 }, pos)).toBe(4.5);
  });

  it('round-trips through resolve+map with silent cues interleaved', () => {
    const cues: LanguageCue[] = [
      { language: 'en', startSec: 0 },
      { language: 'fr', startSec: 2, silent: true },
      { language: 'es', startSec: 2 },
      { language: 'en', startSec: 5 },
    ];
    const speeds = { en: 0.8, es: 1.2, fr: 1 };
    for (const t of [0.1, 2.0, 3.5, 5.0, 7.25]) {
      const pos = resolveActiveCuePosition(cues, t, speeds)!;
      expect(mergedTimeForCuePosition(cues, speeds, pos)).toBeCloseTo(t, 10);
    }
  });
});
