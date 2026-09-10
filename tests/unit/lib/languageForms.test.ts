import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import {
  concreteLanguageCodes,
  firstPersonFlagMismatches,
  FIRST_PERSON_CONFIG,
  getFirstPersonConfig,
  languageMarksFirstPerson,
} from '@/lib/languageForms';

describe('first-person config', () => {
  it('agrees with the flags in lib/languages.ts', () => {
    expect(firstPersonFlagMismatches(SUPPORTED_LANGUAGES)).toEqual([]);
  });

  it('every config code is a supported language', () => {
    const codes = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
    for (const code of Object.keys(FIRST_PERSON_CONFIG)) {
      expect(codes.has(code), `first person ${code}`).toBe(true);
    }
  });

  it('examples differ between the genders', () => {
    for (const [code, config] of Object.entries(FIRST_PERSON_CONFIG)) {
      expect(config.masculine, code).not.toBe(config.feminine);
      expect(config.intro.length, code).toBeGreaterThan(20);
    }
  });

  it('marks the languages whose wording follows the speaker', () => {
    expect(languageMarksFirstPerson('ru')).toBe(true);
    expect(languageMarksFirstPerson('de')).toBe(true);
    expect(languageMarksFirstPerson('is')).toBe(true);
    expect(languageMarksFirstPerson('sv')).toBe(false);
    expect(languageMarksFirstPerson('bn')).toBe(false);
    expect(languageMarksFirstPerson('es_mixed')).toBe(true);
  });

  it('a dialect reads its sibling config', () => {
    expect(getFirstPersonConfig('vi_south')).toBe(FIRST_PERSON_CONFIG.vi);
    expect(getFirstPersonConfig('es_mixed')).toBe(FIRST_PERSON_CONFIG.es);
  });
});

describe('course helpers', () => {
  it('expands mixed dialects and collapses accent variants', () => {
    expect(concreteLanguageCodes('es_mixed')).toEqual(['es', 'es_latam']);
    expect(concreteLanguageCodes('en_gb')).toEqual(['en']);
    expect(concreteLanguageCodes('de')).toEqual(['de']);
  });
});
