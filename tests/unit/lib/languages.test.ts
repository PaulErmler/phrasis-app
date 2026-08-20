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
  resolveMixedVariant,
  isMixedLanguage,
  DEFAULT_CONTENT_VERSION,
  getCurrentTranslationVersion,
  getCurrentTtsVersion,
  isContentVersionStale,
  isTtsVersionStale,
  isTranslationVersionStale,
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
  // Derived from SUPPORTED_LANGUAGES (not hardcoded) so the test can never
  // silently drift from lib/languages.ts when a language flips provider.
  const NON_GOOGLE_PROVIDERS: Record<string, 'azure' | 'gemini'> =
    Object.fromEntries(
      SUPPORTED_LANGUAGES.filter((l) => l.ttsProvider !== 'google').map(
        (l) => [l.code, l.ttsProvider as 'azure' | 'gemini'],
      ),
    );

  it('every non-google language is reachable via getLanguageByCode', () => {
    for (const [code, provider] of Object.entries(NON_GOOGLE_PROVIDERS)) {
      expect(getLanguageByCode(code)?.ttsProvider).toBe(provider);
    }
  });

  it('at least one non-google entry exists (sanity check the derivation)', () => {
    expect(Object.keys(NON_GOOGLE_PROVIDERS).length).toBeGreaterThan(0);
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

  it('returns null for non-Google apiCodes (e.g., raw provider voice IDs)', () => {
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

  // Characterizes the display-name overrides (en + de) for every code that has
  // them, so the "single source of truth" refactor (overrides on the Language
  // record) provably preserves the localized picker labels.
  const EXPECTED_NAMES: Record<string, { en: string; de: string }> = {
    en_gb: { en: 'English (UK)', de: 'Englisch (UK)' },
    en_us: { en: 'English (US)', de: 'Englisch (USA)' },
    en_au: { en: 'English (Australia)', de: 'Englisch (Australien)' },
    es: { en: 'Spanish (Spain)', de: 'Spanisch (Spanien)' },
    es_latam: { en: 'Spanish (Latin America)', de: 'Spanisch (Lateinamerika)' },
    es_mixed: { en: 'Spanish (Mixed)', de: 'Spanisch (Gemischt)' },
    pt: { en: 'Portuguese (Brazil)', de: 'Portugiesisch (Brasilien)' },
    pt_pt: { en: 'Portuguese (Portugal)', de: 'Portugiesisch (Portugal)' },
    zh: { en: 'Chinese (Simplified)', de: 'Chinesisch (Vereinfacht)' },
    zh_traditional: { en: 'Chinese (Traditional)', de: 'Chinesisch (Traditionell)' },
    yue: { en: 'Cantonese (Simplified)', de: 'Kantonesisch (Vereinfacht)' },
    yue_traditional: { en: 'Cantonese (Traditional)', de: 'Kantonesisch (Traditionell)' },
    ar: { en: 'Arabic (Modern Standard)', de: 'Arabisch (Hocharabisch)' },
    ar_sa: { en: 'Arabic (Saudi)', de: 'Arabisch (Saudisch)' },
    ar_eg: { en: 'Arabic (Egyptian)', de: 'Arabisch (Ägyptisch)' },
    ar_iq: { en: 'Arabic (Iraqi)', de: 'Arabisch (Irakisch)' },
    ar_lev: { en: 'Arabic (Levantine)', de: 'Arabisch (Levantinisch)' },
    sw: { en: 'Swahili (Kenya)', de: 'Swahili (Kenia)' },
    sw_tz: { en: 'Swahili (Tanzania)', de: 'Swahili (Tansania)' },
    vi: { en: 'Vietnamese (Northern)', de: 'Vietnamesisch (Nord)' },
    vi_south: { en: 'Vietnamese (Southern)', de: 'Vietnamesisch (Süd)' },
  };

  it('resolves the documented en + de override for every overridden code', () => {
    for (const [code, names] of Object.entries(EXPECTED_NAMES)) {
      expect(getLocalizedLanguageNameByCode(code, 'en'), `${code}/en`).toBe(
        names.en,
      );
      expect(getLocalizedLanguageNameByCode(code, 'de'), `${code}/de`).toBe(
        names.de,
      );
    }
  });

  it('EXPECTED_NAMES covers every code that carries displayNameOverrides', () => {
    // Without this, the table above is a silent allowlist: a new language
    // with overrides (or a typo in one) sails through unasserted. Vi and
    // vi_south were both missing when this guard was added.
    const overridden = SUPPORTED_LANGUAGES.filter(
      (l) => l.displayNameOverrides,
    ).map((l) => l.code);
    expect(overridden.sort()).toEqual(Object.keys(EXPECTED_NAMES).sort());
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

describe('resolveMixedVariant', () => {
  it('returns null for non-mixed codes', () => {
    expect(resolveMixedVariant('es', 'any-seed')).toBeNull();
    expect(resolveMixedVariant('en', 'any-seed')).toBeNull();
  });

  it('is deterministic for the same (code, seed) pair', () => {
    expect(isMixedLanguage('es_mixed')).toBe(true);
    const a = resolveMixedVariant('es_mixed', 'text-abc-123');
    const b = resolveMixedVariant('es_mixed', 'text-abc-123');
    const c = resolveMixedVariant('es_mixed', 'text-abc-123');
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('returns a {subCode, regionVariant} pair pointing at a real Spanish variant', () => {
    const result = resolveMixedVariant('es_mixed', 'seed-1');
    expect(result).not.toBeNull();
    // es_mixed splits across Spain (es / es-ES) and LatAm (es_latam / es-US).
    expect(['es', 'es_latam']).toContain(result!.subCode);
    expect(['es-ES', 'es-US']).toContain(result!.regionVariant);
  });

  it('distributes across both variants given different seeds', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const r = resolveMixedVariant('es_mixed', `seed-${i}`);
      if (r) seen.add(r.subCode);
    }
    // With 50 distinct seeds and ~50/50 hash distribution, hitting only one
    // variant has probability ~2^-50; if this test ever flakes the hash is
    // catastrophically biased.
    expect(seen).toEqual(new Set(['es', 'es_latam']));
  });
});

describe('Persian (fa) language record', () => {
  const fa = getLanguageByCode('fa');

  it('is registered in SUPPORTED_LANGUAGES', () => {
    expect(fa).toBeDefined();
    expect(fa?.name).toBe('Persian');
  });

  it('routes TTS through Gemini (fa-IR) with Azure STT', () => {
    expect(fa?.ttsProvider).toBe('gemini');
    expect(fa?.geminiBcp47).toBe('fa-IR');
    expect(fa?.azureSttLocale).toBe('fa-IR');
    expect(fa?.supportsStt).toBe(true);
  });

  it('romanizes locally and disables karaoke (Perso-Arabic script)', () => {
    expect(fa?.needsRomanization).toBe(true);
    expect(fa?.romanizationBackend).toBe('local');
    expect(languageNeedsRomanization('fa')).toBe(true);
    expect(fa?.supportsKaraoke).toBe(false);
  });
});

describe('content versioning', () => {
  describe('isContentVersionStale (the "undefined === current" rule)', () => {
    it('treats undefined as current, NOT stale (prevents a regen storm)', () => {
      expect(isContentVersionStale(undefined, 1)).toBe(false);
      expect(isContentVersionStale(undefined, 99)).toBe(false);
    });
    it('is stale only when a concrete stamp is strictly below current', () => {
      expect(isContentVersionStale(1, 2)).toBe(true);
      expect(isContentVersionStale(0, 1)).toBe(true);
    });
    it('is not stale when the stamp equals or exceeds current', () => {
      expect(isContentVersionStale(2, 2)).toBe(false);
      expect(isContentVersionStale(3, 2)).toBe(false);
    });
  });

  describe('getCurrent*Version defaults', () => {
    it('defaults to DEFAULT_CONTENT_VERSION for a language without an explicit version', () => {
      // `en` has no translationVersion/ttsVersion override (English is
      // source-only, so it never got the 3.5 Flash translationVersion bump).
      expect(getCurrentTranslationVersion('en')).toBe(DEFAULT_CONTENT_VERSION);
      expect(getCurrentTtsVersion('en')).toBe(DEFAULT_CONTENT_VERSION);
    });
    it('returns bumped translationVersion for de (Gemini 3.5 Flash Nitro rollout)', () => {
      expect(getCurrentTranslationVersion('de')).toBe(2);
    });
    it('returns bumped translationVersion for fr (Gemini 3.5 Flash Nitro rollout)', () => {
      expect(getCurrentTranslationVersion('fr')).toBe(2);
    });
    it('defaults to 1 for an unknown code', () => {
      expect(getCurrentTtsVersion('xx')).toBe(1);
      expect(getCurrentTranslationVersion('xx')).toBe(1);
    });
  });

  describe('prompt-fix languages have their ttsVersion bumped so audio regenerates lazily', () => {
    // pt_pt / en_gb / en_au changed only the Gemini prompt (provider stays
    // gemini), so the provider-mismatch regen wouldn't fire. The ttsVersion
    // bump is what forces regeneration. Guard that the bump is present.
    it.each(['pt_pt', 'en_gb', 'en_au'])(
      'language %s has ttsVersion > DEFAULT so old (v1/undefined-stamped) audio is stale',
      (code) => {
        const current = getCurrentTtsVersion(code);
        expect(current).toBeGreaterThan(DEFAULT_CONTENT_VERSION);
        // A row stamped at the previous baseline (1) is now stale → regenerates.
        expect(isTtsVersionStale(code, 1)).toBe(true);
        // An un-backfilled (undefined) row is NOT force-regenerated by the rule
        // alone, but pt_pt etc. are already-Gemini, so their existing rows were
        // stamped v1 by the backfill; this asserts the guard, not the storm.
        expect(isTtsVersionStale(code, undefined)).toBe(false);
      },
    );
  });

  describe('Arabic dialects route through Gemini with a dialect-specific prompt', () => {
    const EXPECTED_PROMPTS: Record<string, string> = {
      ar: 'Modern Standard Arabic',
      ar_sa: 'Saudi Arabic',
      ar_eg: 'Egyptian Arabic',
      ar_iq: 'Iraqi Arabic',
      ar_lev: 'Levantine Arabic',
    };
    it.each(Object.entries(EXPECTED_PROMPTS))(
      '%s is on gemini with ttsPromptName "%s"',
      (code, prompt) => {
        const lang = getLanguageByCode(code);
        expect(lang?.ttsProvider).toBe('gemini');
        expect(lang?.ttsPromptName).toBe(prompt);
      },
    );
    it('global-Arabic dialects use ar-001 and Egyptian uses ar-EG', () => {
      expect(getLanguageByCode('ar')?.geminiBcp47).toBe('ar-001');
      expect(getLanguageByCode('ar_sa')?.geminiBcp47).toBe('ar-001');
      expect(getLanguageByCode('ar_iq')?.geminiBcp47).toBe('ar-001');
      expect(getLanguageByCode('ar_lev')?.geminiBcp47).toBe('ar-001');
      expect(getLanguageByCode('ar_eg')?.geminiBcp47).toBe('ar-EG');
    });
  });

  describe('European Portuguese TTS prompt fix', () => {
    it('pt_pt is gemini with a European Portuguese prompt and pt-PT locale', () => {
      const pt = getLanguageByCode('pt_pt');
      expect(pt?.ttsProvider).toBe('gemini');
      expect(pt?.ttsPromptName).toBe('European Portuguese');
      expect(pt?.geminiBcp47).toBe('pt-PT');
    });
    it('translation is region-correct via regionLabel Portugal', () => {
      expect(getLanguageByCode('pt_pt')?.regionLabel).toBe('Portugal');
    });
  });

  it('isTranslationVersionStale mirrors the config version per language', () => {
    // de bumped to v2. A v1 stamp is stale; undefined is still not stale.
    expect(getCurrentTranslationVersion('de')).toBe(2);
    expect(isTranslationVersionStale('de', 2)).toBe(false);
    expect(isTranslationVersionStale('de', 1)).toBe(true);
    expect(isTranslationVersionStale('de', undefined)).toBe(false);
    // fr bumped to v2, same semantics as de.
    expect(getCurrentTranslationVersion('fr')).toBe(2);
    expect(isTranslationVersionStale('fr', 2)).toBe(false);
    expect(isTranslationVersionStale('fr', 1)).toBe(true);
    expect(isTranslationVersionStale('fr', undefined)).toBe(false);
  });
});
