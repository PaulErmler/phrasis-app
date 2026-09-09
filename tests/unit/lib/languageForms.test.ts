import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import de from '../../../messages/de.json';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import {
  FIRST_PERSON_CONFIG,
  POLITENESS_CONFIG,
  POLITENESS_LEVELS,
  concreteLanguageCodes,
  courseAsksPoliteness,
  coursePolitenessRows,
  distinctPolitenessForms,
  formCopyCode,
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
        expect(form.name.length, `${code} ${level}`).toBeGreaterThan(0);
        expect(form.promptLabel, `${code} ${level}`).toContain(form.name);
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

  it('the English learner copy in messages/en.json equals the config, and German has every key', () => {
    type Copy = {
      politeness: Record<
        string,
        { intro: string; forms: Record<string, { description: string }> }
      >;
    };
    const enCopy = (en as { LanguageForms: Copy }).LanguageForms;
    const deCopy = (de as { LanguageForms: Copy }).LanguageForms;
    for (const [code, config] of Object.entries(POLITENESS_CONFIG)) {
      if (code === 'vi_south') continue;
      expect(enCopy.politeness[code]?.intro, code).toBe(config.intro);
      for (const form of Object.values(config.forms)) {
        expect(
          enCopy.politeness[code].forms[form.id]?.description,
          `${code} ${form.id}`,
        ).toBe(form.description);
        expect(
          deCopy.politeness[code]?.forms[form.id]?.description,
          `de ${code} ${form.id}`,
        ).toBeTruthy();
      }
      expect(deCopy.politeness[code]?.intro, `de ${code}`).toBeTruthy();
    }
  });

  it('a dialect that shares its sibling config reads the sibling copy', () => {
    expect(formCopyCode('vi_south')).toBe('vi');
    expect(formCopyCode('vi')).toBe('vi');
    expect(formCopyCode('de')).toBe('de');
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

  it('Spanish is familiar-split, German and French distance-split', () => {
    expect(distinctPolitenessForms('es').map((d) => d.levels)).toEqual([
      ['casual', 'polite'],
      ['formal'],
    ]);
    expect(distinctPolitenessForms('de').map((d) => d.levels)).toEqual([
      ['casual'],
      ['polite', 'formal'],
    ]);
    expect(distinctPolitenessForms('fr').map((d) => d.levels)).toEqual([
      ['casual'],
      ['polite', 'formal'],
    ]);
  });

  it('a level set resolves to distinct forms per language', () => {
    expect(
      selectedPolitenessForms('es', ['casual', 'polite']).map((f) => f.id),
    ).toEqual(['t']);
    expect(
      selectedPolitenessForms('de', ['casual', 'polite']).map((f) => f.id),
    ).toEqual(['t', 'v']);
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
    expect(languageMarksFirstPerson('de')).toBe(true);
    expect(languageMarksFirstPerson('is')).toBe(true);
    expect(languageMarksFirstPerson('sv')).toBe(false);
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

  it('a single two-form language shows two rows carrying its forms', () => {
    const rows = coursePolitenessRows(['de', 'en']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite']);
    expect(rows.map((r) => r.perLanguage[0].form.name)).toEqual(['du', 'Sie']);
    expect(rows.map((r) => r.perLanguage[0].form.promptLabel)).toEqual([
      'Casual · du',
      'Polite · Sie',
    ]);
    const es = coursePolitenessRows(['es']);
    expect(es.map((r) => r.level)).toEqual(['casual', 'formal']);
  });

  it('Japanese + German shows three rows with per-language forms', () => {
    const rows = coursePolitenessRows(['ja', 'de', 'en']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
    expect(rows[1].perLanguage.map((p) => `${p.code}:${p.form.id}`)).toEqual([
      'ja:desu-masu',
      'de:v',
    ]);
  });

  it('Spanish + French shows three rows from two two-form languages', () => {
    const rows = coursePolitenessRows(['es', 'fr']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
    expect(rows[1].perLanguage.map((p) => p.form.id)).toEqual(['t', 'v']);
  });

  it('a mixed dialect course shows the union of its sub-variants', () => {
    const rows = coursePolitenessRows(['es_mixed']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
  });

  it('hidden levels inherit the visible level below them', () => {
    const rows = coursePolitenessRows(['es']);
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
});
