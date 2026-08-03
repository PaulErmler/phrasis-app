import { describe, it, expect } from 'vitest';
import {
  ESSENTIAL_GREETING_SENTENCES,
  ESSENTIAL_GREETING_TRANSLATIONS,
} from '../../migrations/data/essentialGreetingTranslations';
import { SUPPORTED_LANGUAGES } from '../../../lib/languages';

const SENTENCE_KEYS = ['hello', 'howAreYou', 'helloHowAreYou'] as const;

describe('essentialGreetingTranslations curated data', () => {
  it('covers every supported language except the source (en)', () => {
    const expected = SUPPORTED_LANGUAGES.filter((l) => l.code !== 'en').map(
      (l) => l.code,
    );
    const covered = Object.keys(ESSENTIAL_GREETING_TRANSLATIONS);
    expect(covered.sort()).toEqual([...expected].sort());
  });

  it('keeps the two greeting sentences distinct within every language (the original bug)', () => {
    for (const [code, entry] of Object.entries(
      ESSENTIAL_GREETING_TRANSLATIONS,
    )) {
      expect(
        entry.hello.text,
        `${code}: hello and howAreYou must differ`,
      ).not.toEqual(entry.howAreYou.text);
    }
  });

  it('builds the combined sentence from both parts', () => {
    for (const [code, entry] of Object.entries(
      ESSENTIAL_GREETING_TRANSLATIONS,
    )) {
      // The join is per-language (punctuation/spacing differ), but the
      // combined sentence must start with the greeting's first characters
      // and end with the question's last characters.
      expect(
        entry.helloHowAreYou.text.startsWith(entry.hello.text.slice(0, 2)),
        `${code}: combined sentence should start like hello`,
      ).toBe(true);
      expect(
        entry.helloHowAreYou.text.endsWith(entry.howAreYou.text.slice(-2)),
        `${code}: combined sentence should end like howAreYou`,
      ).toBe(true);
    }
  });

  it('has no leading/trailing whitespace in any value', () => {
    for (const [code, entry] of Object.entries(
      ESSENTIAL_GREETING_TRANSLATIONS,
    )) {
      for (const key of SENTENCE_KEYS) {
        expect(entry[key].text, `${code}.${key}.text`).toEqual(
          entry[key].text.trim(),
        );
      }
    }
  });

  it('only es_mixed declares a regionVariant', () => {
    for (const [code, entry] of Object.entries(
      ESSENTIAL_GREETING_TRANSLATIONS,
    )) {
      if (code === 'es_mixed') {
        expect(entry.regionVariant).toBe('es-ES');
      } else {
        expect(entry.regionVariant, code).toBeUndefined();
      }
    }
  });

  it('replaces the intended three OGTE rows', () => {
    expect(ESSENTIAL_GREETING_SENTENCES.map((s) => s.externalId)).toEqual([
      '538123',
      '373330',
      '30316',
    ]);
    expect(ESSENTIAL_GREETING_SENTENCES.map((s) => s.text)).toEqual([
      'Hello.',
      'How are you?',
      'Hello. How are you?',
    ]);
  });
});
