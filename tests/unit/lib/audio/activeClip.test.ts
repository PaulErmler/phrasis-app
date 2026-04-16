import { describe, it, expect } from 'vitest';
import { resolveActiveClip } from '@/lib/audio/activeClip';
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
});
