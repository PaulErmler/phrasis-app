import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  getAudioAssetLanguage,
  getCurrentTtsVersion,
  getLanguageByCode,
  getLanguageShortLabel,
  getLocalizedLanguageNameByCode,
  getSharedTextLanguage,
  getTtsPromptNameForLocale,
  usesSourceTextVerbatim,
} from '@/lib/languages';
import {
  getVoiceForText,
  getVoiceLocale,
  getVoiceLocalesForLanguage,
  getVoicesByLanguageCode,
  pickAccentForText,
} from '@/lib/voices';

const ENGLISH_VARIANTS = ['en_gb', 'en_us', 'en_au'] as const;

describe('English accent variants are pickable and share the en text', () => {
  it('no language is hidden from the pickers any more', () => {
    expect(SUPPORTED_LANGUAGES.filter((l) => l.hiddenFromPicker)).toEqual([]);
  });

  it('en is labelled as the mixed-accent option in pickers, plain English elsewhere', () => {
    expect(getLocalizedLanguageNameByCode('en', 'en')).toBe('English (Mixed)');
    expect(getLocalizedLanguageNameByCode('en', 'de')).toBe(
      'Englisch (Gemischt)',
    );
    // `name` feeds LLM prompts, course names and admin emails.
    expect(getLanguageByCode('en')?.name).toBe('English');
  });

  it.each(ENGLISH_VARIANTS)('%s shares its text with en', (code) => {
    expect(getSharedTextLanguage(code)).toBe('en');
    expect(usesSourceTextVerbatim(code, 'en')).toBe(true);
    // A German custom sentence with an en_gb target is still translated.
    expect(usesSourceTextVerbatim(code, 'de')).toBe(false);
  });

  it('the verbatim rule holds in both directions between accents of one language', () => {
    // A custom sentence typed on an English (UK) course is `en_gb` text; a
    // Mixed or US English base on that course shows it as it is.
    expect(usesSourceTextVerbatim('en', 'en_gb')).toBe(true);
    expect(usesSourceTextVerbatim('en_us', 'en_gb')).toBe(true);
    expect(usesSourceTextVerbatim('en_gb', 'en_gb')).toBe(false);
    expect(usesSourceTextVerbatim('de', 'en_gb')).toBe(false);
  });

  it('non-variant codes never take the verbatim path', () => {
    expect(getSharedTextLanguage('en')).toBeUndefined();
    expect(getSharedTextLanguage('es_latam')).toBeUndefined();
    expect(usesSourceTextVerbatim('en', 'en')).toBe(false);
    expect(usesSourceTextVerbatim('es_mixed', 'es')).toBe(false);
  });

  it('badges every English variant as EN, never EN_GB', () => {
    for (const code of ['en', ...ENGLISH_VARIANTS]) {
      expect(getLanguageShortLabel(code)).toBe('EN');
    }
    expect(getLanguageShortLabel('es_mixed')).toBe('ES_MIXED');
  });

  it('variants carry a translationVersion bump so old LLM rewrites regenerate', () => {
    for (const code of ENGLISH_VARIANTS) {
      expect(getLanguageByCode(code)?.translationVersion).toBe(2);
    }
  });
});

describe('accent names for the Gemini prompt', () => {
  it.each([
    ['en-GB', 'British English'],
    ['en-US', 'American English'],
    ['en-AU', 'Australian English'],
    ['es-ES', 'Castilian Spanish'],
    ['es-US', 'Latin American Spanish'],
  ])('%s → %s', (locale, name) => {
    expect(getTtsPromptNameForLocale(locale)).toBe(name);
  });

  it('is undefined for a locale no language names', () => {
    expect(getTtsPromptNameForLocale('de-DE')).toBeUndefined();
    expect(getTtsPromptNameForLocale('xx-XX')).toBeUndefined();
  });
});

describe('voice locale + per-text accent', () => {
  it('reads the accent from either apiCode encoding', () => {
    expect(getVoiceLocale('Leda@en-GB')).toBe('en-GB');
    expect(getVoiceLocale('en-AU-Chirp3-HD-Leda')).toBe('en-AU');
    expect(getVoiceLocale('Kore')).toBeUndefined();
  });

  it('lists the accents each pool can produce', () => {
    expect(getVoiceLocalesForLanguage('en').sort()).toEqual([
      'en-AU',
      'en-GB',
      'en-US',
    ]);
    expect(getVoiceLocalesForLanguage('en_gb')).toEqual(['en-GB']);
    expect(getVoiceLocalesForLanguage('de')).toEqual([undefined]);
  });

  it('pins a pinned pool, leaves a bare pool alone', () => {
    expect(pickAccentForText('en_gb', 'any')).toBe('en-GB');
    expect(pickAccentForText('en_au', 'any')).toBe('en-AU');
    expect(pickAccentForText('de', 'any')).toBeUndefined();
  });

  it('is deterministic per text and spreads across the mixed pool', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const seed = `text_${i}`;
      const first = pickAccentForText('en', seed);
      expect(pickAccentForText('en', seed)).toBe(first);
      expect(['en-US', 'en-GB', 'en-AU']).toContain(first);
      seen.add(first!);
    }
    expect(seen.size).toBe(3);
  });

  it('getVoiceForText picks inside the text accent and honours a dialect pin', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `text_${i}`;
      const voice = getVoiceForText('en', seed, undefined, 'female');
      expect(getVoiceLocale(voice)).toBe(pickAccentForText('en', seed));
      expect(
        getVoicesByLanguageCode('en').find((v) => v.apiCode === voice)?.gender,
      ).toBe('female');
    }
    expect(getVoiceLocale(getVoiceForText('en_gb', 'x', undefined))).toBe(
      'en-GB',
    );
    expect(getVoiceLocale(getVoiceForText('es_mixed', 'x', 'es-US'))).toBe(
      'es-US',
    );
    expect(
      getVoiceLocale(getVoiceForText('de', 'x', undefined)),
    ).toBeUndefined();
  });
});

describe('one audio cache for every English accent', () => {
  it('keys variant audio under en', () => {
    for (const code of ENGLISH_VARIANTS) {
      expect(getAudioAssetLanguage(code)).toBe('en');
    }
    expect(getAudioAssetLanguage('en')).toBe('en');
    expect(getAudioAssetLanguage('es_mixed')).toBe('es_mixed');
  });

  it('checks variant audio against en’s ttsVersion, not a version of its own', () => {
    for (const code of ENGLISH_VARIANTS) {
      expect(getLanguageByCode(code)?.ttsVersion).toBeUndefined();
      expect(getCurrentTtsVersion(code)).toBe(getCurrentTtsVersion('en'));
    }
  });
});
