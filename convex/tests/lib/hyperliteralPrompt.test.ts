import { describe, expect, it } from 'vitest';
import {
  buildHyperliteralSystemPrompt,
  getGlossConvention,
  hyperliteralLine,
  pairsCoverSentence,
  parseHyperliteral,
} from '../../lib/hyperliteralPrompt';
import { SUPPORTED_LANGUAGES } from '../../../lib/languages';

/**
 * The prompt is what `pnpm eval:hyperliteral` grades, so these guard the two
 * things the eval cannot see: that every language in the convention table is
 * a real one, and that the gloss language is genuinely a parameter rather
 * than English hard-coded in a dozen places.
 */

const CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

describe('convention table', () => {
  it('only names supported language codes', () => {
    for (const code of ['ja', 'ko', 'zh', 'tr', 'fi', 'hu', 'ru', 'de', 'ar']) {
      expect(getGlossConvention(code), code).not.toBeNull();
    }
    // A typo'd key would silently never apply, so the table is checked
    // against the catalog rather than against itself.
    const tabled = SUPPORTED_LANGUAGES.filter(
      (l) => getGlossConvention(l.code) !== null,
    );
    expect(tabled.length).toBeGreaterThan(10);
    for (const l of tabled) expect(CODES.has(l.code)).toBe(true);
  });

  it('leaves a language with no special guidance to the shared rules', () => {
    expect(getGlossConvention('sv')).toBeNull();
    expect(buildHyperliteralSystemPrompt('sv', 'en')).toContain(
      'SENTENCE LANGUAGE',
    );
  });
});

describe('buildHyperliteralSystemPrompt', () => {
  it('names both languages, so the gloss language is a parameter', () => {
    const en = buildHyperliteralSystemPrompt('ru', 'en');
    expect(en).toContain('Russian');
    expect(en).toContain('English');
    const de = buildHyperliteralSystemPrompt('ru', 'de');
    expect(de).toContain('German');
    expect(de).not.toContain('GLOSS LANGUAGE: English');
  });

  it('changes with the gloss language, so the eval cache cannot serve the wrong one', () => {
    expect(buildHyperliteralSystemPrompt('ru', 'en')).not.toBe(
      buildHyperliteralSystemPrompt('ru', 'de'),
    );
  });

  it('forbids Leipzig abbreviations, which is what makes it a learner gloss', () => {
    expect(buildHyperliteralSystemPrompt('ja', 'en')).toContain(
      'Do not use Leipzig glossing abbreviations',
    );
  });

  it('carries the language rules when the table has them', () => {
    const tr = buildHyperliteralSystemPrompt('tr', 'en');
    expect(tr).toContain('TURKISH RULES');
    expect(tr).toContain('in-house');
  });
});

describe('parseHyperliteral', () => {
  it('reads the requested pairs', () => {
    expect(parseHyperliteral('{"pairs":[["Я","I"],["не","not"]]}')).toEqual([
      { source: 'Я', gloss: 'I' },
      { source: 'не', gloss: 'not' },
    ]);
  });

  it('reads them through a markdown fence', () => {
    expect(
      parseHyperliteral('```json\n{"pairs":[["Мне","to-me"]]}\n```'),
    ).toEqual([{ source: 'Мне', gloss: 'to-me' }]);
  });

  it('returns null for anything else, so the caller writes the sentinel', () => {
    expect(parseHyperliteral('I not know.')).toBeNull();
    expect(parseHyperliteral('{"gloss": "I not know."}')).toBeNull();
    expect(parseHyperliteral('{"hyperliteral": ""}')).toBeNull();
    expect(parseHyperliteral('{"hyperliteral": 7}')).toBeNull();
    expect(parseHyperliteral('')).toBeNull();
  });
});
