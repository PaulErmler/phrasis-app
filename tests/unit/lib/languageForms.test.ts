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
  formAxisApplies,
  formCopyCode,
  languageMarksFirstPerson,
  politenessFormById,
  primaryPolitenessForm,
  recommendedPolitenessLevels,
  unmarkedIsAcceptable,
  levelsFromTickedRows,
  onboardingAsksPoliteness,
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

  it('recommends every level except the honorific third form of Japanese and Korean', () => {
    expect(recommendedPolitenessLevels(coursePolitenessRows(['ja', 'en']))).toEqual(
      ['casual', 'polite'],
    );
    expect(recommendedPolitenessLevels(coursePolitenessRows(['ko', 'en']))).toEqual(
      ['casual', 'polite'],
    );
    // Two-form languages: both rows, the hidden level inheriting (Sie).
    expect(recommendedPolitenessLevels(coursePolitenessRows(['de', 'en']))).toEqual(
      ['casual', 'polite', 'formal'],
    );
    // Spanish recommends nothing, so it wants every level and a mixed
    // course keeps the formal row (keigo) Japanese alone would drop.
    expect(recommendedPolitenessLevels(coursePolitenessRows(['ja', 'es']))).toEqual(
      ['casual', 'polite', 'formal'],
    );
    expect(recommendedPolitenessLevels(coursePolitenessRows(['sv', 'en']))).toEqual(
      [],
    );
  });

  it('every non-address language carries a default level for its primary rendering', () => {
    for (const [code, config] of Object.entries(POLITENESS_CONFIG)) {
      if (config.marking !== 'address') {
        expect(config.defaultLevel, code).toBe('polite');
      } else {
        expect(config.defaultLevel, code).toBeUndefined();
      }
    }
  });

  it('the primary form follows the register, the default, and the addressee gate', () => {
    expect(primaryPolitenessForm('ja', {})?.id).toBe('desu-masu');
    expect(primaryPolitenessForm('ja', { register: 'informal' })?.id).toBe(
      'plain',
    );
    expect(primaryPolitenessForm('ja', { register: 'formal' })?.id).toBe(
      'desu-masu',
    );
    expect(primaryPolitenessForm('vi', {})?.id).toBe('respectful');
    expect(primaryPolitenessForm('de', { addressesSomeone: false })).toBeNull();
    expect(
      primaryPolitenessForm('de', { addressesSomeone: true, register: 'formal' })
        ?.id,
    ).toBe('v');
    expect(
      primaryPolitenessForm('es', { addressesSomeone: true, register: 'formal' })
        ?.id,
    ).toBe('v');
    expect(
      primaryPolitenessForm('es', { addressesSomeone: true, register: 'neutral' })
        ?.id,
    ).toBe('t');
    expect(primaryPolitenessForm('sv', { addressesSomeone: true })).toBeNull();
    expect(politenessFormById('ja', 'keigo')?.id).toBe('keigo');
    expect(politenessFormById('ja', 'nope')).toBeUndefined();
  });

  it('the form axis applies to every sentence except an address language without a you', () => {
    expect(formAxisApplies('de', { addressesSomeone: false })).toBe(false);
    expect(formAxisApplies('de', { addresseeNumber: 'not_applicable' })).toBe(
      false,
    );
    expect(formAxisApplies('de', { addressesSomeone: true })).toBe(true);
    expect(formAxisApplies('th', { addressesSomeone: false })).toBe(true);
    expect(formAxisApplies('sv', { addressesSomeone: true })).toBe(false);
    expect(unmarkedIsAcceptable('vi')).toBe(true);
    expect(unmarkedIsAcceptable('ja')).toBe(false);
    expect(unmarkedIsAcceptable('de')).toBe(false);
  });

  it('Dutch is familiar-split, German and French distance-split', () => {
    expect(distinctPolitenessForms('nl').map((d) => d.levels)).toEqual([
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

  // Two dialects of one language must split at the same level, or es_mixed
  // draws a middle row where Spain says tú and Latin America usted.
  it('both Spanish dialects split at the same level', () => {
    expect(distinctPolitenessForms('es').map((d) => d.levels)).toEqual([
      ['casual'],
      ['polite', 'formal'],
    ]);
    expect(distinctPolitenessForms('es_latam').map((d) => d.levels)).toEqual(
      distinctPolitenessForms('es').map((d) => d.levels),
    );
  });

  it('a level set resolves to distinct forms per language', () => {
    expect(
      selectedPolitenessForms('nl', ['casual', 'polite']).map((f) => f.id),
    ).toEqual(['t']);
    expect(
      selectedPolitenessForms('es', ['casual', 'polite']).map((f) => f.id),
    ).toEqual(['t', 'v']);
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

  it('the wizard asks politeness only for Japanese and Korean targets', () => {
    expect(onboardingAsksPoliteness(['ja'])).toBe(true);
    expect(onboardingAsksPoliteness(['ko'])).toBe(true);
    expect(onboardingAsksPoliteness(['en', 'ja'])).toBe(true);
    // Marked, but not asked at sign-up: these start on every level.
    expect(onboardingAsksPoliteness(['de'])).toBe(false);
    expect(onboardingAsksPoliteness(['es_mixed'])).toBe(false);
    expect(onboardingAsksPoliteness(['vi'])).toBe(false);
    expect(onboardingAsksPoliteness(['en', 'sv'])).toBe(false);
    expect(onboardingAsksPoliteness([])).toBe(false);
  });

  it('a single two-form language shows two rows carrying its forms', () => {
    const rows = coursePolitenessRows(['de', 'en']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite']);
    expect(rows.map((r) => r.perLanguage[0].form.name)).toEqual(['du', 'Sie']);
    expect(rows.map((r) => r.perLanguage[0].form.promptLabel)).toEqual([
      'Casual · du',
      'Polite · Sie',
    ]);
    const nl = coursePolitenessRows(['nl']);
    expect(nl.map((r) => r.level)).toEqual(['casual', 'formal']);
    const es = coursePolitenessRows(['es']);
    expect(es.map((r) => r.level)).toEqual(['casual', 'polite']);
  });

  it('Japanese + German shows three rows with per-language forms', () => {
    const rows = coursePolitenessRows(['ja', 'de', 'en']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
    expect(rows[1].perLanguage.map((p) => `${p.code}:${p.form.id}`)).toEqual([
      'ja:desu-masu',
      'de:v',
    ]);
  });

  it('Dutch + French shows three rows from two two-form languages', () => {
    const rows = coursePolitenessRows(['nl', 'fr']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite', 'formal']);
    expect(rows[1].perLanguage.map((p) => p.form.id)).toEqual(['t', 'v']);
  });

  it('two-form languages splitting alike share their two rows', () => {
    const rows = coursePolitenessRows(['es_mixed', 'fr']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite']);
    expect(rows[1].perLanguage.map((p) => `${p.code}:${p.form.name}`)).toEqual([
      'es:usted',
      'es_latam:usted',
      'fr:vous',
    ]);
  });

  it('a mixed dialect course shows the union of its sub-variants', () => {
    const rows = coursePolitenessRows(['es_mixed']);
    expect(rows.map((r) => r.level)).toEqual(['casual', 'polite']);
    expect(rows[0].perLanguage.map((p) => p.code)).toEqual(['es', 'es_latam']);
  });

  it('hidden levels inherit the visible level below them', () => {
    const rows = coursePolitenessRows(['nl']);
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
    // A distance split hides the top level instead: it follows polite.
    const esRows = coursePolitenessRows(['es']);
    expect(levelsFromTickedRows(esRows, ['polite'])).toEqual([
      'polite',
      'formal',
    ]);
    expect(levelsFromTickedRows(esRows, ['casual'])).toEqual(['casual']);
    const jaRows = coursePolitenessRows(['ja']);
    expect(levelsFromTickedRows(jaRows, ['polite'])).toEqual(['polite']);
  });
});
