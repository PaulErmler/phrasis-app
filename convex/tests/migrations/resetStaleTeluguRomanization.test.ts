import { describe, it, expect } from 'vitest';
import { resetStaleTeluguRomanizationPatch } from '../../migrations';
import { ROMANIZATION_SOURCES } from '../../lib/localRomanization';

const CLEARED = { romanizedText: undefined, romanizationSource: undefined };

describe('resetStaleTeluguRomanizationPatch (migrateOne logic)', () => {
  it('clears the empty-string sentinel left by Google v3 400s', () => {
    expect(
      resetStaleTeluguRomanizationPatch({
        language: 'te',
        romanizedText: '',
        romanizationSource: ROMANIZATION_SOURCES.googleV3,
      }),
    ).toEqual(CLEARED);
  });

  it('clears untagged Telugu rows and any leftover google-v3 output', () => {
    expect(
      resetStaleTeluguRomanizationPatch({
        language: 'te',
        romanizedText: 'namaskaram',
        romanizationSource: undefined,
      }),
    ).toEqual(CLEARED);
    expect(
      resetStaleTeluguRomanizationPatch({
        language: 'te',
        romanizedText: 'namaskaram',
        romanizationSource: ROMANIZATION_SOURCES.googleV3,
      }),
    ).toEqual(CLEARED);
  });

  it('leaves never-attempted rows for the scheduler', () => {
    expect(
      resetStaleTeluguRomanizationPatch({
        language: 'te',
        romanizedText: undefined,
        romanizationSource: undefined,
      }),
    ).toBeUndefined();
  });

  it('leaves rows already written by the local ISO 15919 mapper', () => {
    expect(
      resetStaleTeluguRomanizationPatch({
        language: 'te',
        romanizedText: 'namaskāraṁ',
        romanizationSource: ROMANIZATION_SOURCES.sanscriptIso15919,
      }),
    ).toBeUndefined();
  });

  it('ignores non-Telugu rows', () => {
    expect(
      resetStaleTeluguRomanizationPatch({
        language: 'ta',
        romanizedText: '',
        romanizationSource: ROMANIZATION_SOURCES.googleV3,
      }),
    ).toBeUndefined();
  });
});
