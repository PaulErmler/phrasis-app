import { describe, it, expect } from 'vitest';
import { stripTrailingUnderscoresPatch } from '../../migrations';
import { USER_PROVIDED_TRANSLATION_SOURCE } from '../../../lib/translationProvenance';

describe('stripTrailingUnderscoresPatch (backfill migrateOne logic)', () => {
  it('patches both translatedText and romanizedText when they carry trailing underscores', () => {
    expect(
      stripTrailingUnderscoresPatch({
        targetLanguage: 'ar_lev',
        translatedText: 'أوه، أنا متأسفة._',
        romanizedText: 'awh, ana mtasft_',
      }),
    ).toEqual({
      translatedText: 'أوه، أنا متأسفة.',
      romanizedText: 'awh, ana mtasft',
    });
  });

  it('patches only the field that changed', () => {
    expect(
      stripTrailingUnderscoresPatch({
        targetLanguage: 'es',
        translatedText: 'Hola._',
        romanizedText: 'Hola.',
      }),
    ).toEqual({ translatedText: 'Hola.' });
  });

  it('returns undefined (skip) for clean rows — idempotent', () => {
    expect(
      stripTrailingUnderscoresPatch({
        targetLanguage: 'es',
        translatedText: 'Hola.',
        romanizedText: 'Hola.',
      }),
    ).toBeUndefined();
  });

  it('skips user-provided rows — the step is machine-output-only', () => {
    expect(
      stripTrailingUnderscoresPatch({
        targetLanguage: 'es',
        translatedText: 'Hola._',
        translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
      }),
    ).toBeUndefined();
  });

  it('leaves the empty-string romanization sentinel alone', () => {
    expect(
      stripTrailingUnderscoresPatch({
        targetLanguage: 'ar',
        translatedText: 'مرحبا',
        romanizedText: '',
      }),
    ).toBeUndefined();
  });
});
