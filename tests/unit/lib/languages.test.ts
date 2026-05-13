import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  getLanguageByCode,
  getLanguageShortLabel,
  getLanguagesByCodes,
  getVoicesByLanguageCode,
  getRandomVoiceForLanguage,
  getVoiceGenderByApiCode,
  resolveAudioSpeakerGender,
  getVoiceForLanguage,
  getLocaleFromApiCode,
  getLocalesByLanguageCode,
  generateCourseName,
  getLocalizedLanguageName,
  getLocalizedLanguageNameByCode,
  languageNeedsRomanization,
  normalizeLanguageCode,
  ROMANIZATION_LANGUAGES,
} from '@/lib/languages';

describe('getLanguageByCode', () => {
  it('returns the language for a known code', () => {
    expect(getLanguageByCode('en')?.name).toBe('English');
  });

  it('returns undefined for unknown codes', () => {
    expect(getLanguageByCode('xx')).toBeUndefined();
  });
});

describe('SUPPORTED_LANGUAGES ttsProvider', () => {
  // Google is the default. Each non-default routing below is intentional and
  // listed here to guard against accidental provider flips.
  const NON_GOOGLE_PROVIDERS: Record<string, 'elevenlabs' | 'azure'> = {
    sv: 'azure',
  };

  it('languages not listed above are all routed through Google TTS', () => {
    const offenders = SUPPORTED_LANGUAGES.filter(
      (l) => !(l.code in NON_GOOGLE_PROVIDERS) && l.ttsProvider !== 'google',
    ).map((l) => `${l.code}=${l.ttsProvider}`);
    expect(
      offenders,
      `Languages unexpectedly off google: ${offenders.join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('non-google-pinned languages use the expected provider', () => {
    for (const [code, provider] of Object.entries(NON_GOOGLE_PROVIDERS)) {
      expect(getLanguageByCode(code)?.ttsProvider).toBe(provider);
    }
  });
});

describe('getLanguageShortLabel', () => {
  it('uppercases known codes', () => {
    expect(getLanguageShortLabel('en')).toBe('EN');
  });

  it('maps es_latam back to ES', () => {
    expect(getLanguageShortLabel('es_latam')).toBe('ES');
    expect(getLanguageShortLabel('es')).toBe('ES');
  });

  it('uppercases unknown codes as fallback', () => {
    expect(getLanguageShortLabel('zz')).toBe('ZZ');
  });
});

describe('getLanguagesByCodes', () => {
  it('returns Language objects for known codes in order', () => {
    const langs = getLanguagesByCodes(['en', 'es']);
    expect(langs.map((l) => l.code)).toEqual(['en', 'es']);
  });

  it('filters out unknown codes', () => {
    const langs = getLanguagesByCodes(['en', 'nope']);
    expect(langs.map((l) => l.code)).toEqual(['en']);
  });
});

describe('voice helpers', () => {
  it('getVoicesByLanguageCode returns [] for unknown code', () => {
    expect(getVoicesByLanguageCode('zz')).toEqual([]);
  });

  it('getVoicesByLanguageCode returns voices for known code', () => {
    expect(getVoicesByLanguageCode('en').length).toBeGreaterThan(0);
  });

  it('getRandomVoiceForLanguage returns a known apiCode', () => {
    const apiCode = getRandomVoiceForLanguage('en');
    const voices = getVoicesByLanguageCode('en').map((v) => v.apiCode);
    expect(voices).toContain(apiCode);
  });

  it('getRandomVoiceForLanguage throws for unknown code', () => {
    expect(() => getRandomVoiceForLanguage('zz')).toThrow();
  });

  it('getVoiceGenderByApiCode returns gender when found', () => {
    const anyVoice = getVoicesByLanguageCode(SUPPORTED_LANGUAGES[0].code)[0];
    expect(getVoiceGenderByApiCode(anyVoice.apiCode)).toBe(anyVoice.gender);
  });

  it('getVoiceGenderByApiCode returns undefined for unknown apiCode', () => {
    expect(getVoiceGenderByApiCode('made-up')).toBeUndefined();
  });

  it('getVoiceForLanguage respects gender when possible', () => {
    const apiCode = getVoiceForLanguage('en', 'female');
    expect(getVoiceGenderByApiCode(apiCode)).toBe('female');
  });

  it('getVoiceForLanguage throws for unknown code', () => {
    expect(() => getVoiceForLanguage('zz', 'male')).toThrow();
  });
});

describe('resolveAudioSpeakerGender', () => {
  it('returns explicit male/female as-is', () => {
    expect(resolveAudioSpeakerGender('male')).toBe('male');
    expect(resolveAudioSpeakerGender('female')).toBe('female');
  });

  it('returns male or female for neutral/undefined input', () => {
    const r = resolveAudioSpeakerGender();
    expect(['male', 'female']).toContain(r);
    const r2 = resolveAudioSpeakerGender('neutral');
    expect(['male', 'female']).toContain(r2);
  });
});

describe('getLocaleFromApiCode', () => {
  it('extracts locale prefix', () => {
    expect(getLocaleFromApiCode('en-US-Chirp3-HD-Leda')).toBe('en-US');
    expect(getLocaleFromApiCode('cmn-CN-Chirp3-HD-Foo')).toBe('cmn-CN');
  });

  it('returns null for non-Google apiCodes (e.g., ElevenLabs voice IDs)', () => {
    expect(getLocaleFromApiCode('weird')).toBeNull();
    expect(getLocaleFromApiCode('21m00Tcm4TlvDq8ikWAM')).toBeNull();
  });
});

describe('getLocalesByLanguageCode', () => {
  it('returns deduped locales for a known language', () => {
    const locales = getLocalesByLanguageCode('en');
    expect(new Set(locales).size).toBe(locales.length);
    expect(locales.length).toBeGreaterThan(0);
  });

  it('returns [] for unknown codes', () => {
    expect(getLocalesByLanguageCode('zz')).toEqual([]);
  });
});

describe('generateCourseName', () => {
  it('joins base → target names', () => {
    expect(generateCourseName(['en'], ['es'])).toMatch(/English.*→/);
  });

  it('handles multiple languages per side', () => {
    const name = generateCourseName(['en'], ['es', 'fr']);
    expect(name).toMatch(/English →/);
    expect(name).toMatch(/,/);
  });
});

describe('getLocalizedLanguageName', () => {
  it('returns a name for a BCP 47 tag', () => {
    const name = getLocalizedLanguageName('es', 'en');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('overrides zh-CN with script-based name', () => {
    expect(getLocalizedLanguageName('zh-CN', 'en')).toBe(
      'Chinese (Simplified)',
    );
    expect(getLocalizedLanguageName('zh-cn', 'de')).toBe(
      'Chinesisch (Vereinfacht)',
    );
  });
});

describe('getLocalizedLanguageNameByCode', () => {
  it('resolves a name via internal code', () => {
    const name = getLocalizedLanguageNameByCode('es', 'en');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('returns the input code when unknown', () => {
    expect(getLocalizedLanguageNameByCode('zz', 'en')).toBe('zz');
  });
});

describe('romanization helpers', () => {
  it('languageNeedsRomanization returns true for listed scripts', () => {
    expect(languageNeedsRomanization('zh')).toBe(true);
    expect(languageNeedsRomanization('ar')).toBe(true);
  });

  it('languageNeedsRomanization returns false for Latin-script languages', () => {
    expect(languageNeedsRomanization('en')).toBe(false);
    expect(languageNeedsRomanization('de')).toBe(false);
  });

  it('ROMANIZATION_LANGUAGES set contains known entries', () => {
    expect(ROMANIZATION_LANGUAGES.has('hi')).toBe(true);
  });
});

describe('normalizeLanguageCode', () => {
  it('strips _latam suffix', () => {
    expect(normalizeLanguageCode('es_latam')).toBe('es');
  });

  it('keeps non-variant codes unchanged', () => {
    expect(normalizeLanguageCode('en')).toBe('en');
    expect(normalizeLanguageCode('zh')).toBe('zh');
  });
});
