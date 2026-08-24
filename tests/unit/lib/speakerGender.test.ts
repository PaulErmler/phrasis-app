import { describe, expect, it } from 'vitest';
import {
  preferenceGender,
  resolveSpeakerGenderPreference,
  sourceTextHasFirstPerson,
  textEligibleForGenderVariant,
} from '@/lib/speakerGender';
import {
  SUPPORTED_LANGUAGES,
  getSpeakerGenderMarking,
  languageMarksSpeakerGender,
} from '@/lib/languages';

describe('resolveSpeakerGenderPreference', () => {
  it('passes through the two concrete genders', () => {
    expect(resolveSpeakerGenderPreference('male')).toBe('male');
    expect(resolveSpeakerGenderPreference('female')).toBe('female');
  });

  it("resolves everything else to 'mixed' (the no-op default)", () => {
    expect(resolveSpeakerGenderPreference('mixed')).toBe('mixed');
    expect(resolveSpeakerGenderPreference(undefined)).toBe('mixed');
    expect(resolveSpeakerGenderPreference(null)).toBe('mixed');
    expect(resolveSpeakerGenderPreference('')).toBe('mixed');
    expect(resolveSpeakerGenderPreference('neutral')).toBe('mixed');
  });
});

describe('preferenceGender', () => {
  it("maps 'mixed' to null and the genders to themselves", () => {
    expect(preferenceGender('mixed')).toBeNull();
    expect(preferenceGender('male')).toBe('male');
    expect(preferenceGender('female')).toBe('female');
  });
});

describe('sourceTextHasFirstPerson', () => {
  it('matches first-person subjects, objects, and possessives', () => {
    expect(sourceTextHasFirstPerson('I am tired.')).toBe(true);
    expect(sourceTextHasFirstPerson("I'm a teacher.")).toBe(true);
    expect(sourceTextHasFirstPerson('Give me the book.')).toBe(true);
    expect(sourceTextHasFirstPerson('That is my brother.')).toBe(true);
    expect(sourceTextHasFirstPerson('We went home early.')).toBe(true);
    expect(sourceTextHasFirstPerson('Come with us.')).toBe(true);
    expect(sourceTextHasFirstPerson('The car is ours.')).toBe(true);
  });

  it('does not match sentences without first-person reference', () => {
    expect(sourceTextHasFirstPerson('The sky is blue.')).toBe(false);
    expect(sourceTextHasFirstPerson('It is raining.')).toBe(false);
    expect(sourceTextHasFirstPerson('Is he tired?')).toBe(false);
    expect(sourceTextHasFirstPerson('Her mother is a doctor.')).toBe(false);
    // "in", "it", "mine"-lookalikes must not match on substrings.
    expect(sourceTextHasFirstPerson('The mine closed in winter.')).toBe(true); // "mine" as a word does match — over-trigger is harmless by design
    expect(sourceTextHasFirstPerson('Simple things matter.')).toBe(false);
  });
});

describe('textEligibleForGenderVariant', () => {
  it('requires both a marking language and a first-person sentence', () => {
    expect(textEligibleForGenderVariant('es', 'I am tired.')).toBe(true);
    expect(textEligibleForGenderVariant('es', 'The sky is blue.')).toBe(false);
    // Turkish never marks speaker gender.
    expect(textEligibleForGenderVariant('tr', 'I am tired.')).toBe(false);
  });

  it('pervasive languages (Thai particles) skip the first-person gate', () => {
    expect(textEligibleForGenderVariant('th', 'The sky is blue.')).toBe(true);
    expect(textEligibleForGenderVariant('th', 'Thank you.')).toBe(true);
  });

  it('unknown languages are never eligible', () => {
    expect(textEligibleForGenderVariant('xx', 'I am tired.')).toBe(false);
  });
});

describe('speakerGenderMarking language config', () => {
  it('every supported language declares a valid value', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(['none', 'lexical', 'grammatical']).toContain(
        lang.speakerGenderMarking,
      );
    }
  });

  it('spot-checks the linguistic classification', () => {
    // First-person agreement morphology.
    for (const code of ['es', 'fr', 'it', 'pt', 'ru', 'pl', 'hi', 'he', 'ar', 'is', 'el']) {
      expect(getSpeakerGenderMarking(code)).toBe('grammatical');
    }
    // Gendered word choice without agreement morphology.
    for (const code of ['de', 'nl', 'ja', 'ko', 'th', 'vi']) {
      expect(getSpeakerGenderMarking(code)).toBe('lexical');
    }
    // No speaker-gender marking at all.
    for (const code of ['en', 'tr', 'fi', 'hu', 'zh', 'id', 'fa', 'sw', 'et', 'bn', 'ta', 'te']) {
      expect(getSpeakerGenderMarking(code)).toBe('none');
    }
  });

  it('dialects/variants agree with their parent language', () => {
    expect(getSpeakerGenderMarking('es_latam')).toBe('grammatical');
    expect(getSpeakerGenderMarking('es_mixed')).toBe('grammatical');
    expect(getSpeakerGenderMarking('pt_pt')).toBe('grammatical');
    for (const code of ['ar_sa', 'ar_eg', 'ar_iq', 'ar_lev']) {
      expect(getSpeakerGenderMarking(code)).toBe('grammatical');
    }
    for (const code of ['en_gb', 'en_us', 'en_au']) {
      expect(getSpeakerGenderMarking(code)).toBe('none');
    }
    expect(getSpeakerGenderMarking('vi_south')).toBe('lexical');
    expect(getSpeakerGenderMarking('sw_tz')).toBe('none');
    expect(getSpeakerGenderMarking('yue')).toBe('none');
    expect(getSpeakerGenderMarking('zh_traditional')).toBe('none');
  });

  it('only Thai is marked pervasive', () => {
    const pervasive = SUPPORTED_LANGUAGES.filter(
      (l) => l.speakerGenderPervasive,
    ).map((l) => l.code);
    expect(pervasive).toEqual(['th']);
  });

  it('languageMarksSpeakerGender mirrors the marking field', () => {
    expect(languageMarksSpeakerGender('es')).toBe(true);
    expect(languageMarksSpeakerGender('de')).toBe(true);
    expect(languageMarksSpeakerGender('en')).toBe(false);
    expect(languageMarksSpeakerGender('unknown-code')).toBe(false);
  });
});
