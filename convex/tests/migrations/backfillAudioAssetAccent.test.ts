import { describe, it, expect } from 'vitest';
import { audioAssetAccentPatch } from '../../migrations';

describe('audioAssetAccentPatch (backfill migrateOne logic)', () => {
  it('stamps a pre-fix mixed-English clip with the default (drifted) accent, not the voice tag', () => {
    // The mixed pool's prompt only said "English", so an "@en-GB" clip came
    // out American; filing it as British would serve it to UK courses.
    expect(
      audioAssetAccentPatch({
        language: 'en',
        voiceName: 'Leda@en-GB',
        regionVariant: undefined,
      }),
    ).toEqual({ regionVariant: 'en-US' });
    expect(
      audioAssetAccentPatch({
        language: 'en',
        voiceName: 'Achird@en-US',
        regionVariant: undefined,
      }),
    ).toEqual({ regionVariant: 'en-US' });
  });

  it('stamps a single-locale pool from the voice tag (the prompt named that accent)', () => {
    expect(
      audioAssetAccentPatch({
        language: 'en_gb',
        voiceName: 'Leda@en-GB',
        regionVariant: undefined,
      }),
    ).toEqual({ regionVariant: 'en-GB' });
  });

  it('leaves a row that already carries a pin alone (es_mixed)', () => {
    expect(
      audioAssetAccentPatch({
        language: 'es_mixed',
        voiceName: 'Leda@es-US',
        regionVariant: 'es-US',
      }),
    ).toBeUndefined();
  });

  it('skips bare voices, whose accent is the language itself', () => {
    expect(
      audioAssetAccentPatch({
        language: 'de',
        voiceName: 'Kore',
        regionVariant: undefined,
      }),
    ).toBeUndefined();
  });

  it('skips a dormant Chirp3 clip on a language whose active pool is bare', () => {
    // Stamping "de-DE" would hide the clip from every `de` lookup, which
    // tries the accent-less key only.
    expect(
      audioAssetAccentPatch({
        language: 'de',
        voiceName: 'de-DE-Chirp3-HD-Leda',
        regionVariant: undefined,
      }),
    ).toBeUndefined();
  });

  it('is idempotent: a stamped row is skipped on re-run', () => {
    expect(
      audioAssetAccentPatch({
        language: 'en',
        voiceName: 'Leda@en-GB',
        regionVariant: 'en-US',
      }),
    ).toBeUndefined();
  });
});
