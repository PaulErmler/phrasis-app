import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import {
  FIRST_PERSON_CONFIG,
  POLITENESS_CONFIG,
  POLITENESS_LEVELS,
  concreteLanguageCodes,
  courseAsksPoliteness,
  courseFirstPersonExample,
  coursePolitenessRows,
  distinctPolitenessForms,
  languageMarksFirstPerson,
  levelsFromTickedRows,
  politenessFlagMismatches,
  selectedPolitenessForms,
} from '@/lib/languageForms';

describe('language forms config', () => {
  it('agrees with the flags in lib/languages.ts', () => {
    expect(politenessFlagMismatches(SUPPORTED_LANGUAGES)).toEqual([]);
  });

  it('every config code is a supported language', () => {
    const codes = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
    for (const code of Object.keys(POLITENESS_CONFIG)) {
      expect(codes.has(code), `politeness ${code}`).toBe(true);
    }
    for (const code of Object.keys(FIRST_PERSON_CONFIG)) {
      expect(codes.has(code), `first person ${code}`).toBe(true);
    }
  });

  it('every politeness form has copy, an example and a prompt', () => {
    for (const [code, config] of Object.entries(POLITENESS_CONFIG)) {
      expect(config.intro.length, code).toBeGreaterThan(20);
      expect(config.exampleEn.length, code).toBeGreaterThan(3);
      expect(config.sources.length, code).toBeGreaterThan(0);
      for (const level of POLITENESS_LEVELS) {
        const form = config.forms[level];
        expect(form.id, `${code} ${level}`).toMatch(/^[a-z-]+$/);
        expect(form.label.length, `${code} ${level}`).toBeGreaterThan(3);
        expect(form.description.length, `${code} ${level}`).toBeGreaterThan(3);
        expect(form.example.length, `${code} ${level}`).toBeGreaterThan(0);
        expect(form.prompt.length, `${code} ${level}`).toBeGreaterThan(10);
      }
      // A language never renders a higher level as a LOWER form.
      const ids = POLITENESS_LEVELS.map((level) => config.forms[level].id);
      const distinct = [...new Set(ids)];
      expect(ids.filter((id) => id === distinct[0]).length).toBe(
        ids.lastIndexOf(distinct[0]) + 1,
      );
    }
  });

  it('only Japanese and Korean have three distinct forms', () => {
    const three = Object.keys(POLITENESS_CONFIG).filter(
      (code) => distinctPolitenessForms(code).length === 3,
    );
    expect(three.sort()).toEqual(['ja', 'ko']);
  });

  it('predicate languages carry a default level for canonical generation', () => {
    for (const [code, config] of Object.entries(POLITENESS_CONFIG)) {
      if (config.marking === 'predicate') {
        expect(config.defaultLevel, code).toBe('polite');
      }
    }
  });

  it('German is familiar-split and French distance-split', () => {
    expect(distinctPolitenessForms('de').map((d) => d.levels)).toEqual([
      ['casual', 'polite'],
      ['formal'],
    ]);
    expect(distinctPolitenessForms('fr').map((d) => d.levels)).toEqual([
      ['casual'],
      ['polite', 'formal'],
    ]);
  });

  it('a level set resolves to distinct forms per language', () => {
    expect(
      selectedPolitenessForms('de', ['casual', 'polite']).map((f) => f.id),
    ).toEqual(['t']);
    expect(
      selectedPolitenessForms('ja', ['casual', 'polite']).map((f) => f.id),
    ).toEqual(['plain', 'desu-masu']);
    expect(selectedPolitenessForms('sv', ['casual'])).toEqual([]);
  });

  it('first-person examples differ between the genders', () => {
    for (const [code, config] of Object.entries(FIRST_PERSON_CONFIG)) {
      expect(config.masculine, code).not.toBe(config.feminine);
      expect(config.intro.length, code).toBeGreaterThan(20);
    }
    expect(languageMarksFirstPerson('ru')).toBe(true);
    expect(languageMarksFirstPerson('de')).toBe(false);
    expect(languageMarksFirstPerson('bn')).toBe(false);
    expect(languageMarksFirstPerson('es_mixed')).toBe(true);
  });
});

describe('course helpers', () => {
  it('expands mixed dialects and collapses accent variants', () => {
    expect(concreteLanguageCodes('es_mixed')).toEqual(['es', 'es_latam']);
    expect(concreteLanguageCodes('en_gb')).toEqual(['en']);
    expect(concreteLanguageCodes('de')).toEqual(['de']);
  });

  it('asks politeness only when a target marks it', () => {
    expect(courseAsksPoliteness(['de'])).toBe(true);
    expect(courseAsksPoliteness(['en', 'sv'])).toBe(false);
    expect(courseAsksPoliteness(['es_mixed'])).toBe(true);
    expect(courseAsksPoliteness(['fi'])).toBe(false);
  });

  it('a single two-form language shows two rows named by its forms', () => {
    const rows = coursePolitenessRows(['de', 'en']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'formal']);
    expect(rows[0].label).toBe('du-form · everyday');
    expect(rows[1].label).toBe('Sie-form · formal');
  });

  it('Japanese + German shows three rows with per-language forms', () => {
    const rows = coursePolitenessRows(['ja', 'de', 'en']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
    expect(rows[1].label).toBe('Polite');
    expect(rows[1].perLanguage.map((p) => `${p.code}:${p.form.id}`)).toEqual([
      'ja:desu-masu',
      'de:t',
    ]);
  });

  it('German + French shows three rows from two two-form languages', () => {
    const rows = coursePolitenessRows(['de', 'fr']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
    expect(rows[1].perLanguage.map((p) => p.form.id)).toEqual(['t', 'v']);
  });

  it('a mixed dialect course shows the union of its sub-variants', () => {
    const rows = coursePolitenessRows(['es_mixed']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
  });

  it('hidden levels inherit the visible level below them', () => {
    const rows = coursePolitenessRows(['de']);
    expect(levelsFromTickedRows(rows, ['casual'])).toEqual([
      'casual',
      'polite',
    ]);
    expect(levelsFromTickedRows(rows, ['formal'])).toEqual(['formal']);
    expect(levelsFromTickedRows(rows, ['casual', 'formal'])).toEqual([
      'casual',
      'polite',
      'formal',
    ]);
    const jaRows = coursePolitenessRows(['ja']);
    expect(levelsFromTickedRows(jaRows, ['polite'])).toEqual(['polite']);
  });

  it('picks the first marked target for the first-person example', () => {
    expect(courseFirstPersonExample(['de', 'ru'], ['en'])?.code).toBe('ru');
    expect(courseFirstPersonExample(['de'], ['ru'])?.code).toBe('ru');
    expect(courseFirstPersonExample(['de'], ['en'])).toBeUndefined();
  });
});
