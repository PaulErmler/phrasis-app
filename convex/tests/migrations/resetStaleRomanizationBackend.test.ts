import { describe, expect, it } from 'vitest';
import { resetStaleRomanizationBackendPatch as patch } from '../../migrations';
import {
  ROMANIZATION_SOURCES,
  getRomanizationSource,
} from '../../lib/localRomanization';

const CLEARED = { romanizedText: undefined, romanizationSource: undefined };

/**
 * The backend reset is keyed on the routing itself (Sep 2026: Hebrew to the
 * model, Arabic to Google v3), so it must clear exactly the rows the retired
 * engines wrote and nothing the current routing would write again.
 */
describe('resetStaleRomanizationBackendPatch (migrateOne logic)', () => {
  it('clears rows the retired Hebrew and Arabic engines wrote', () => {
    expect(
      patch({
        language: 'he',
        romanizedText: 'šlwm lkwlm',
        romanizationSource: 'hebrew-transliteration-v1',
      }),
    ).toEqual(CLEARED);
    expect(
      patch({
        targetLanguage: 'ar_eg',
        romanizedText: 'shkra jzyal-',
        romanizationSource: 'arabic-transliterate-v1',
      }),
    ).toEqual(CLEARED);
  });

  it('clears the sentinel those engines left, so the new one gets a try', () => {
    expect(
      patch({
        language: 'he',
        romanizedText: '',
        romanizationSource: 'hebrew-transliteration-v1',
      }),
    ).toEqual(CLEARED);
  });

  it('clears an untagged row only where the old engine is gone', () => {
    // Hebrew predates the source tag by a day, so untagged Hebrew rows are
    // real and can only be the retired engine's output.
    expect(patch({ language: 'he', romanizedText: 'šlwm' })).toEqual(CLEARED);
    expect(patch({ language: 'ar', romanizedText: 'shkra' })).toEqual(CLEARED);
    // Untagged Russian was written by Google v3, which is still the route.
    // Wiping it would refill every pre-tag row one Google call at a time.
    expect(patch({ language: 'ru', romanizedText: 'privet' })).toBeUndefined();
    expect(patch({ targetLanguage: 'ja', romanizedText: '' })).toBeUndefined();
  });

  it('leaves rows the current routing wrote, sentinels included', () => {
    expect(
      patch({
        language: 'he',
        romanizedText: 'shalom lekhulam',
        romanizationSource: getRomanizationSource('he'),
      }),
    ).toBeUndefined();
    expect(
      patch({
        targetLanguage: 'ar',
        romanizedText: '',
        romanizationSource: ROMANIZATION_SOURCES.googleV3,
      }),
    ).toBeUndefined();
    expect(
      patch({
        language: 'ru',
        romanizedText: 'privet',
        romanizationSource: ROMANIZATION_SOURCES.googleV3,
      }),
    ).toBeUndefined();
  });

  it('clears rows tagged with a superseded version of the current engine', () => {
    // The shared tag the first model cut wrote, before the per-language tags.
    expect(
      patch({
        targetLanguage: 'th',
        romanizedText: '',
        romanizationSource: 'gemini-3.8-flash-flex-v1',
      }),
    ).toEqual(CLEARED);
  });

  it('leaves never-attempted rows for the scheduler', () => {
    expect(patch({ language: 'he' })).toBeUndefined();
    expect(
      patch({
        language: 'he',
        romanizationSource: 'hebrew-transliteration-v1',
      }),
    ).toBeUndefined();
  });

  it('ignores languages that are not romanized', () => {
    expect(
      patch({
        language: 'de',
        romanizedText: 'hallo',
        romanizationSource: 'x',
      }),
    ).toBeUndefined();
  });
});
