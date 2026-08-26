import { describe, it, expect } from 'vitest';
import {
  resetStaleBulgarianRomanizationPatch,
  resetStaleTeluguRomanizationPatch,
} from '../../migrations';
import { ROMANIZATION_SOURCES } from '../../lib/localRomanization';

const CLEARED = { romanizedText: undefined, romanizationSource: undefined };

/**
 * The two language-swap reset migrations share one factory
 * (staleRomanizationResets in convex/migrations.ts), so the migrateOne
 * logic is tested once per (language, current source) row. Telugu exists
 * because Google v3 400s on `te`; Bulgarian because `bg` was catalogued as
 * google-v3 but never on Google's list.
 */
describe.each([
  {
    name: 'Telugu',
    patch: resetStaleTeluguRomanizationPatch,
    language: 'te',
    otherLanguage: 'ta',
    currentSource: ROMANIZATION_SOURCES.sanscriptIso15919,
    localOutput: 'namaskāraṁ',
    staleOutput: 'namaskaram',
  },
  {
    name: 'Bulgarian',
    patch: resetStaleBulgarianRomanizationPatch,
    language: 'bg',
    otherLanguage: 'ru',
    currentSource: ROMANIZATION_SOURCES.bulgarianStreamlined,
    localOutput: 'zdravey',
    staleOutput: 'zdravei',
  },
])(
  '$name reset patch (migrateOne logic)',
  ({ patch, language, otherLanguage, currentSource, localOutput, staleOutput }) => {
    it('clears the empty-string sentinel left by google-v3', () => {
      expect(
        patch({
          language,
          romanizedText: '',
          romanizationSource: ROMANIZATION_SOURCES.googleV3,
        }),
      ).toEqual(CLEARED);
    });

    it('clears untagged rows and any leftover google-v3 output', () => {
      expect(
        patch({
          language,
          romanizedText: staleOutput,
          romanizationSource: undefined,
        }),
      ).toEqual(CLEARED);
      expect(
        patch({
          language,
          romanizedText: staleOutput,
          romanizationSource: ROMANIZATION_SOURCES.googleV3,
        }),
      ).toEqual(CLEARED);
    });

    it('leaves never-attempted rows for the scheduler', () => {
      expect(
        patch({
          language,
          romanizedText: undefined,
          romanizationSource: undefined,
        }),
      ).toBeUndefined();
    });

    it('clears rows tagged with a superseded version of the local source', () => {
      // The exact production scenario of a source-tag bump (e.g.
      // bulgarian-streamlined-v2 → v3): the old tag no longer matches the
      // current source, so the row re-romanizes lazily.
      expect(
        patch({
          language,
          romanizedText: staleOutput,
          romanizationSource: `${currentSource}-superseded`,
        }),
      ).toEqual(CLEARED);
    });

    it('leaves rows already written by the local mapper', () => {
      expect(
        patch({
          language,
          romanizedText: localOutput,
          romanizationSource: currentSource,
        }),
      ).toBeUndefined();
    });

    it('ignores other languages', () => {
      expect(
        patch({
          language: otherLanguage,
          romanizedText: '',
          romanizationSource: ROMANIZATION_SOURCES.googleV3,
        }),
      ).toBeUndefined();
    });
  },
);
