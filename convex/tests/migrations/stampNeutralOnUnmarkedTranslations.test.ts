import { describe, it, expect } from 'vitest';
import { stampNeutralOnUnmarkedTranslationsPatch } from '../../migrations';

describe('stampNeutralOnUnmarkedTranslationsPatch (backfill migrateOne logic)', () => {
  it('stamps neutral on an unstamped unmarked-language row', () => {
    expect(
      stampNeutralOnUnmarkedTranslationsPatch({
        targetLanguage: 'de',
        speakerGender: undefined,
      }),
    ).toEqual({ speakerGender: 'neutral' });
  });

  it('normalizes a meaningless gender stamp on an unmarked language', () => {
    // The old metadata loop blanket-stamped the text's gender onto every
    // row, English included. Whatever it held, the row is 'neutral' now.
    expect(
      stampNeutralOnUnmarkedTranslationsPatch({
        targetLanguage: 'en',
        speakerGender: 'female',
      }),
    ).toEqual({ speakerGender: 'neutral' });
  });

  it('skips already-neutral rows (idempotent)', () => {
    expect(
      stampNeutralOnUnmarkedTranslationsPatch({
        targetLanguage: 'zh',
        speakerGender: 'neutral',
      }),
    ).toBeUndefined();
  });

  it('never touches marked-language rows, stamped or legacy', () => {
    // undefined on a marked language = canonical carrier; healed lazily,
    // never by a blanket pass.
    expect(
      stampNeutralOnUnmarkedTranslationsPatch({
        targetLanguage: 'es',
        speakerGender: undefined,
      }),
    ).toBeUndefined();
    expect(
      stampNeutralOnUnmarkedTranslationsPatch({
        targetLanguage: 'ru',
        speakerGender: 'male',
      }),
    ).toBeUndefined();
    // Stylistic tier counts as marked too.
    expect(
      stampNeutralOnUnmarkedTranslationsPatch({
        targetLanguage: 'th',
        speakerGender: undefined,
      }),
    ).toBeUndefined();
  });
});
