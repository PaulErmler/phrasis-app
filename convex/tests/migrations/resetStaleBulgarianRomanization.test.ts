import { describe, it, expect } from 'vitest';
import { resetStaleBulgarianRomanizationPatch } from '../../migrations';
import { ROMANIZATION_SOURCES } from '../../lib/localRomanization';

const CLEARED = { romanizedText: undefined, romanizationSource: undefined };

describe('resetStaleBulgarianRomanizationPatch (migrateOne logic)', () => {
  it('clears the empty-string sentinel left by the google-v3 hard gate', () => {
    expect(
      resetStaleBulgarianRomanizationPatch({
        language: 'bg',
        romanizedText: '',
        romanizationSource: ROMANIZATION_SOURCES.googleV3,
      }),
    ).toEqual(CLEARED);
  });

  it('leaves never-attempted rows for the scheduler', () => {
    expect(
      resetStaleBulgarianRomanizationPatch({
        language: 'bg',
        romanizedText: undefined,
        romanizationSource: undefined,
      }),
    ).toBeUndefined();
  });

  it('leaves rows already written by the local streamlined mapper', () => {
    expect(
      resetStaleBulgarianRomanizationPatch({
        language: 'bg',
        romanizedText: 'Balgariya',
        romanizationSource: ROMANIZATION_SOURCES.bulgarianStreamlined,
      }),
    ).toBeUndefined();
  });

  it('ignores non-Bulgarian rows', () => {
    expect(
      resetStaleBulgarianRomanizationPatch({
        language: 'ru',
        romanizedText: '',
        romanizationSource: ROMANIZATION_SOURCES.googleV3,
      }),
    ).toBeUndefined();
  });
});
