import { describe, it, expect } from 'vitest';
import {
  autoMapColumns,
  cellMatchesLanguage,
  detectHasHeader,
} from '@/components/app/import-texts/importHeuristics';

describe('cellMatchesLanguage', () => {
  it('matches the English name', () => {
    expect(cellMatchesLanguage('German', 'de', 'en')).toBe(true);
  });
  it('matches the native name', () => {
    expect(cellMatchesLanguage('Deutsch', 'de', 'en')).toBe(true);
  });
  it('matches the ISO code directly', () => {
    expect(cellMatchesLanguage('de', 'de', 'en')).toBe(true);
  });
  it('is case- and accent-insensitive', () => {
    expect(cellMatchesLanguage('español', 'es', 'en')).toBe(true);
    expect(cellMatchesLanguage('ESPANOL', 'es', 'en')).toBe(true);
  });
  it('does not match unrelated text', () => {
    expect(cellMatchesLanguage('Hola', 'de', 'en')).toBe(false);
    expect(cellMatchesLanguage('Notes', 'de', 'en')).toBe(false);
  });
  it('returns false for empty cells', () => {
    expect(cellMatchesLanguage('', 'de', 'en')).toBe(false);
  });
});

describe('detectHasHeader', () => {
  it('detects a header when any cell matches a language name', () => {
    expect(detectHasHeader(['German', 'Spanish'], 'en')).toBe(true);
  });
  it('detects a header when cells are short/simple words', () => {
    expect(detectHasHeader(['Name', 'Category'], 'en')).toBe(true);
  });
  it('rejects a sentence row as a header', () => {
    expect(
      detectHasHeader(
        ['Guten Morgen, wie geht es dir heute?', 'Buenos días'],
        'en',
      ),
    ).toBe(false);
  });
  it('returns false for empty row', () => {
    expect(detectHasHeader([], 'en')).toBe(false);
    expect(detectHasHeader(undefined, 'en')).toBe(false);
  });
});

describe('autoMapColumns', () => {
  it('maps course languages to matching header cells', () => {
    const mapping = autoMapColumns(['German', 'Spanish'], ['de', 'es'], 'en');
    expect(mapping).toEqual({ de: 0, es: 1 });
  });

  it('picks only matching cells and leaves others unmapped', () => {
    const mapping = autoMapColumns(
      ['ID', 'Topic', 'German', 'Spanish', 'Notes'],
      ['de', 'es'],
      'en',
    );
    expect(mapping).toEqual({ de: 2, es: 3 });
  });

  it('returns empty mapping when no header match', () => {
    const mapping = autoMapColumns(['Foo', 'Bar'], ['de', 'es'], 'en');
    expect(mapping).toEqual({});
  });
});
