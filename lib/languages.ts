/**
 * Language definitions and utilities for the Flexling app
 */

/**
 * Voice configuration for text-to-speech
 * The apiCode contains all info needed: locale-Chirp3-HD-VoiceName
 */
export interface Voice {
  name: string; // Voice name (e.g., "Leda")
  displayName: string; // Human-readable name, e.g., "Leda (Female) - US"
  apiCode: string; // Full Google TTS voice code, e.g., "en-US-Chirp3-HD-Leda"
  gender: 'female' | 'male';
}

export interface Language {
  code: string; // ISO 639-1 language code (for internal use and database storage)
  displayCode: string; // BCP 47 language tag for display (e.g., "es-MX", "zh-CN")
  name: string; // English name (fallback)
  nativeName: string; // Name in the language itself
  flag: string; // Flag emoji
  voices: Voice[]; // Available TTS voices for this language
  needsRomanization: boolean; // Whether the script requires Latin transliteration
}

/**
 * Helper to create Chirp3 HD voice entries
 */
function createChirp3Voice(
  name: string,
  gender: 'female' | 'male',
  locale: string,
  accentLabel: string,
): Voice {
  return {
    name,
    displayName: `${name} (${gender === 'female' ? 'Female' : 'Male'}) - ${accentLabel}`,
    apiCode: `${locale}-Chirp3-HD-${name}`,
    gender,
  };
}

export const SUPPORTED_LANGUAGES: Language[] = [
  {
    code: 'en',
    displayCode: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇬🇧',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'en-US', 'US'),
      createChirp3Voice('Kore', 'female', 'en-US', 'US'),
      createChirp3Voice('Charon', 'male', 'en-US', 'US'),
      createChirp3Voice('Puck', 'male', 'en-US', 'US'),
      createChirp3Voice('Aoede', 'female', 'en-GB', 'UK'),
      createChirp3Voice('Kore', 'female', 'en-GB', 'UK'),
      createChirp3Voice('Orus', 'male', 'en-GB', 'UK'),
      createChirp3Voice('Puck', 'male', 'en-GB', 'UK'),
      createChirp3Voice('Achernar', 'female', 'en-AU', 'AU'),
      createChirp3Voice('Kore', 'female', 'en-AU', 'AU'),
      createChirp3Voice('Achird', 'male', 'en-AU', 'AU'),
      createChirp3Voice('Puck', 'male', 'en-AU', 'AU'),
    ],
  },
  {
    code: 'es',
    displayCode: 'es-ES',
    name: 'Spanish (Spain)',
    nativeName: 'Español (España)',
    flag: '🇪🇸',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'es-ES', 'Spain'),
      createChirp3Voice('Kore', 'female', 'es-ES', 'Spain'),
      createChirp3Voice('Aoede', 'female', 'es-ES', 'Spain'),
      createChirp3Voice('Zephyr', 'female', 'es-ES', 'Spain'),
      createChirp3Voice('Charon', 'male', 'es-ES', 'Spain'),
      createChirp3Voice('Puck', 'male', 'es-ES', 'Spain'),
      createChirp3Voice('Fenrir', 'male', 'es-ES', 'Spain'),
      createChirp3Voice('Orus', 'male', 'es-ES', 'Spain'),
    ],
  },
  {
    code: 'es_latam',
    displayCode: 'es-419',
    name: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
    flag: '🌎',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'es-US', 'Latin America'),
      createChirp3Voice('Kore', 'female', 'es-US', 'Latin America'),
      createChirp3Voice('Aoede', 'female', 'es-US', 'Latin America'),
      createChirp3Voice('Zephyr', 'female', 'es-US', 'Latin America'),
      createChirp3Voice('Charon', 'male', 'es-US', 'Latin America'),
      createChirp3Voice('Puck', 'male', 'es-US', 'Latin America'),
      createChirp3Voice('Fenrir', 'male', 'es-US', 'Latin America'),
      createChirp3Voice('Orus', 'male', 'es-US', 'Latin America'),
    ],
  },
  {
    code: 'fr',
    displayCode: 'fr',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'fr-FR', 'France'),
      createChirp3Voice('Kore', 'female', 'fr-FR', 'France'),
      createChirp3Voice('Charon', 'male', 'fr-FR', 'France'),
      createChirp3Voice('Puck', 'male', 'fr-FR', 'France'),
      createChirp3Voice('Aoede', 'female', 'fr-CA', 'Canada'),
      createChirp3Voice('Kore', 'female', 'fr-CA', 'Canada'),
      createChirp3Voice('Orus', 'male', 'fr-CA', 'Canada'),
      createChirp3Voice('Puck', 'male', 'fr-CA', 'Canada'),
    ],
  },
  {
    code: 'de',
    displayCode: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'de-DE', 'Germany'),
      createChirp3Voice('Kore', 'female', 'de-DE', 'Germany'),
      createChirp3Voice('Aoede', 'female', 'de-DE', 'Germany'),
      createChirp3Voice('Zephyr', 'female', 'de-DE', 'Germany'),
      createChirp3Voice('Charon', 'male', 'de-DE', 'Germany'),
      createChirp3Voice('Puck', 'male', 'de-DE', 'Germany'),
      createChirp3Voice('Fenrir', 'male', 'de-DE', 'Germany'),
      createChirp3Voice('Orus', 'male', 'de-DE', 'Germany'),
    ],
  },
  {
    code: 'it',
    displayCode: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'it-IT', 'Italy'),
      createChirp3Voice('Kore', 'female', 'it-IT', 'Italy'),
      createChirp3Voice('Aoede', 'female', 'it-IT', 'Italy'),
      createChirp3Voice('Zephyr', 'female', 'it-IT', 'Italy'),
      createChirp3Voice('Charon', 'male', 'it-IT', 'Italy'),
      createChirp3Voice('Puck', 'male', 'it-IT', 'Italy'),
      createChirp3Voice('Fenrir', 'male', 'it-IT', 'Italy'),
      createChirp3Voice('Orus', 'male', 'it-IT', 'Italy'),
    ],
  },
  {
    code: 'pt',
    displayCode: 'pt',
    name: 'Portuguese (Brazil)',
    nativeName: 'Português',
    flag: '🇧🇷',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'pt-BR', 'Brazil'),
      createChirp3Voice('Kore', 'female', 'pt-BR', 'Brazil'),
      createChirp3Voice('Aoede', 'female', 'pt-BR', 'Brazil'),
      createChirp3Voice('Zephyr', 'female', 'pt-BR', 'Brazil'),
      createChirp3Voice('Charon', 'male', 'pt-BR', 'Brazil'),
      createChirp3Voice('Puck', 'male', 'pt-BR', 'Brazil'),
      createChirp3Voice('Fenrir', 'male', 'pt-BR', 'Brazil'),
      createChirp3Voice('Orus', 'male', 'pt-BR', 'Brazil'),
    ],
  },
  {
    code: 'ru',
    displayCode: 'ru',
    name: 'Russian',
    nativeName: 'Русский',
    flag: '🇷🇺',
    needsRomanization: true,
    voices: [
      createChirp3Voice('Leda', 'female', 'ru-RU', 'Russia'),
      createChirp3Voice('Kore', 'female', 'ru-RU', 'Russia'),
      createChirp3Voice('Aoede', 'female', 'ru-RU', 'Russia'),
      createChirp3Voice('Zephyr', 'female', 'ru-RU', 'Russia'),
      createChirp3Voice('Charon', 'male', 'ru-RU', 'Russia'),
      createChirp3Voice('Puck', 'male', 'ru-RU', 'Russia'),
      createChirp3Voice('Fenrir', 'male', 'ru-RU', 'Russia'),
      createChirp3Voice('Orus', 'male', 'ru-RU', 'Russia'),
    ],
  },
  {
    code: 'hi',
    displayCode: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳',
    needsRomanization: true,
    voices: [
      createChirp3Voice('Leda', 'female', 'hi-IN', 'India'),
      createChirp3Voice('Kore', 'female', 'hi-IN', 'India'),
      createChirp3Voice('Aoede', 'female', 'hi-IN', 'India'),
      createChirp3Voice('Zephyr', 'female', 'hi-IN', 'India'),
      createChirp3Voice('Charon', 'male', 'hi-IN', 'India'),
      createChirp3Voice('Puck', 'male', 'hi-IN', 'India'),
      createChirp3Voice('Fenrir', 'male', 'hi-IN', 'India'),
      createChirp3Voice('Orus', 'male', 'hi-IN', 'India'),
    ],
  },
  {
    code: 'zh',
    displayCode: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '中文（简体）',
    flag: '🇨🇳',
    needsRomanization: true,
    voices: [
      createChirp3Voice('Leda', 'female', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Kore', 'female', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Aoede', 'female', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Zephyr', 'female', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Charon', 'male', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Puck', 'male', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Fenrir', 'male', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Orus', 'male', 'cmn-CN', 'Mandarin'),
    ],
  },
  {
    code: 'ja',
    displayCode: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    needsRomanization: true,
    voices: [
      createChirp3Voice('Leda', 'female', 'ja-JP', 'Japan'),
      createChirp3Voice('Kore', 'female', 'ja-JP', 'Japan'),
      createChirp3Voice('Aoede', 'female', 'ja-JP', 'Japan'),
      createChirp3Voice('Zephyr', 'female', 'ja-JP', 'Japan'),
      createChirp3Voice('Charon', 'male', 'ja-JP', 'Japan'),
      createChirp3Voice('Puck', 'male', 'ja-JP', 'Japan'),
      createChirp3Voice('Fenrir', 'male', 'ja-JP', 'Japan'),
      createChirp3Voice('Orus', 'male', 'ja-JP', 'Japan'),
    ],
  },
  {
    code: 'ko',
    displayCode: 'ko',
    name: 'Korean',
    nativeName: '한국어',
    flag: '🇰🇷',
    needsRomanization: true,
    voices: [
      createChirp3Voice('Leda', 'female', 'ko-KR', 'Korea'),
      createChirp3Voice('Kore', 'female', 'ko-KR', 'Korea'),
      createChirp3Voice('Aoede', 'female', 'ko-KR', 'Korea'),
      createChirp3Voice('Zephyr', 'female', 'ko-KR', 'Korea'),
      createChirp3Voice('Charon', 'male', 'ko-KR', 'Korea'),
      createChirp3Voice('Puck', 'male', 'ko-KR', 'Korea'),
      createChirp3Voice('Fenrir', 'male', 'ko-KR', 'Korea'),
      createChirp3Voice('Orus', 'male', 'ko-KR', 'Korea'),
    ],
  },
  {
    code: 'vi',
    displayCode: 'vi',
    name: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    flag: '🇻🇳',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'vi-VN', 'Vietnam'),
      createChirp3Voice('Kore', 'female', 'vi-VN', 'Vietnam'),
      createChirp3Voice('Aoede', 'female', 'vi-VN', 'Vietnam'),
      createChirp3Voice('Zephyr', 'female', 'vi-VN', 'Vietnam'),
      createChirp3Voice('Charon', 'male', 'vi-VN', 'Vietnam'),
      createChirp3Voice('Puck', 'male', 'vi-VN', 'Vietnam'),
      createChirp3Voice('Fenrir', 'male', 'vi-VN', 'Vietnam'),
      createChirp3Voice('Orus', 'male', 'vi-VN', 'Vietnam'),
    ],
  },
  {
    code: 'sv',
    displayCode: 'sv',
    name: 'Swedish',
    nativeName: 'Svenska',
    flag: '🇸🇪',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'sv-SE', 'Sweden'),
      createChirp3Voice('Kore', 'female', 'sv-SE', 'Sweden'),
      createChirp3Voice('Aoede', 'female', 'sv-SE', 'Sweden'),
      createChirp3Voice('Zephyr', 'female', 'sv-SE', 'Sweden'),
      createChirp3Voice('Charon', 'male', 'sv-SE', 'Sweden'),
      createChirp3Voice('Puck', 'male', 'sv-SE', 'Sweden'),
      createChirp3Voice('Fenrir', 'male', 'sv-SE', 'Sweden'),
      createChirp3Voice('Orus', 'male', 'sv-SE', 'Sweden'),
    ],
  },
  {
    code: 'fi',
    displayCode: 'fi',
    name: 'Finnish',
    nativeName: 'Suomi',
    flag: '🇫🇮',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'fi-FI', 'Finland'),
      createChirp3Voice('Kore', 'female', 'fi-FI', 'Finland'),
      createChirp3Voice('Aoede', 'female', 'fi-FI', 'Finland'),
      createChirp3Voice('Zephyr', 'female', 'fi-FI', 'Finland'),
      createChirp3Voice('Charon', 'male', 'fi-FI', 'Finland'),
      createChirp3Voice('Puck', 'male', 'fi-FI', 'Finland'),
      createChirp3Voice('Fenrir', 'male', 'fi-FI', 'Finland'),
      createChirp3Voice('Orus', 'male', 'fi-FI', 'Finland'),
    ],
  },
  {
    code: 'nl',
    displayCode: 'nl',
    name: 'Dutch',
    nativeName: 'Nederlands',
    flag: '🇳🇱',
    needsRomanization: false,
    voices: [
      createChirp3Voice('Leda', 'female', 'nl-NL', 'Netherlands'),
      createChirp3Voice('Kore', 'female', 'nl-NL', 'Netherlands'),
      createChirp3Voice('Aoede', 'female', 'nl-NL', 'Netherlands'),
      createChirp3Voice('Zephyr', 'female', 'nl-NL', 'Netherlands'),
      createChirp3Voice('Charon', 'male', 'nl-NL', 'Netherlands'),
      createChirp3Voice('Puck', 'male', 'nl-NL', 'Netherlands'),
      createChirp3Voice('Fenrir', 'male', 'nl-NL', 'Netherlands'),
      createChirp3Voice('Orus', 'male', 'nl-NL', 'Netherlands'),
    ],
  },
  {
    code: 'el',
    displayCode: 'el',
    name: 'Greek',
    nativeName: 'Ελληνικά',
    flag: '🇬🇷',
    needsRomanization: true,
    voices: [
      createChirp3Voice('Leda', 'female', 'el-GR', 'Greece'),
      createChirp3Voice('Kore', 'female', 'el-GR', 'Greece'),
      createChirp3Voice('Aoede', 'female', 'el-GR', 'Greece'),
      createChirp3Voice('Zephyr', 'female', 'el-GR', 'Greece'),
      createChirp3Voice('Charon', 'male', 'el-GR', 'Greece'),
      createChirp3Voice('Puck', 'male', 'el-GR', 'Greece'),
      createChirp3Voice('Fenrir', 'male', 'el-GR', 'Greece'),
      createChirp3Voice('Orus', 'male', 'el-GR', 'Greece'),
    ],
  },
  {
    code: 'ar',
    displayCode: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    flag: '🇸🇦',
    needsRomanization: true,
    voices: [
      createChirp3Voice('Leda', 'female', 'ar-XA', 'MSA'),
      createChirp3Voice('Kore', 'female', 'ar-XA', 'MSA'),
      createChirp3Voice('Aoede', 'female', 'ar-XA', 'MSA'),
      createChirp3Voice('Zephyr', 'female', 'ar-XA', 'MSA'),
      createChirp3Voice('Charon', 'male', 'ar-XA', 'MSA'),
      createChirp3Voice('Puck', 'male', 'ar-XA', 'MSA'),
      createChirp3Voice('Fenrir', 'male', 'ar-XA', 'MSA'),
      createChirp3Voice('Orus', 'male', 'ar-XA', 'MSA'),
    ],
  },
];

/**
 * Get a language by its ISO 639-1 code
 */
export function getLanguageByCode(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

/**
 * Short tag for badges, chat previews, and audio button labels.
 * Both Spanish variants map to "ES" so internal codes like es_latam never appear in the UI.
 */
export function getLanguageShortLabel(code: string): string {
  const normalized = code.toLowerCase();
  if (normalized === 'es' || normalized === 'es_latam') {
    return 'ES';
  }
  const language = getLanguageByCode(code);
  if (language) {
    return language.code.toUpperCase();
  }
  return code.toUpperCase();
}

/**
 * Get multiple languages by their codes
 */
export function getLanguagesByCodes(codes: string[]): Language[] {
  return codes
    .map((code) => getLanguageByCode(code))
    .filter((lang): lang is Language => lang !== undefined);
}

/**
 * Get all voices for a specific language by its code
 */
export function getVoicesByLanguageCode(code: string): Voice[] {
  const language = getLanguageByCode(code);
  return language?.voices ?? [];
}

/**
 * Get a random voice for a language
 * Returns the full apiCode (e.g., "en-US-Chirp3-HD-Leda")
 * @throws Error if language code is not supported
 */
export function getRandomVoiceForLanguage(code: string): string {
  const voices = getVoicesByLanguageCode(code);
  if (voices.length === 0) {
    throw new Error(
      `No voices available for language code: "${code}". Add it to SUPPORTED_LANGUAGES.`,
    );
  }
  const randomIndex = Math.floor(Math.random() * voices.length);
  return voices[randomIndex].apiCode;
}

/**
 * Look up the gender of a voice by its full apiCode.
 * Returns undefined if the voice is not found.
 */
export function getVoiceGenderByApiCode(apiCode: string): 'male' | 'female' | undefined {
  for (const lang of SUPPORTED_LANGUAGES) {
    const voice = lang.voices.find((v) => v.apiCode === apiCode);
    if (voice) return voice.gender;
  }
  return undefined;
}

/**
 * Get a voice for a language, optionally matching a speaker gender.
 * Falls back to random selection when gender is "neutral", undefined, or no matching voice exists.
 */
export function getVoiceForLanguage(
  code: string,
  speakerGender?: string,
): string {
  const voices = getVoicesByLanguageCode(code);
  if (voices.length === 0) {
    throw new Error(
      `No voices available for language code: "${code}". Add it to SUPPORTED_LANGUAGES.`,
    );
  }

  if (speakerGender === 'male' || speakerGender === 'female') {
    const matching = voices.filter((v) => v.gender === speakerGender);
    if (matching.length > 0) {
      return matching[Math.floor(Math.random() * matching.length)].apiCode;
    }
  }

  const randomIndex = Math.floor(Math.random() * voices.length);
  return voices[randomIndex].apiCode;
}

/**
 * Extract locale from voice apiCode (e.g., "en-US-Chirp3-HD-Leda" -> "en-US")
 */
export function getLocaleFromApiCode(apiCode: string): string {
  // Format: locale-Chirp3-HD-VoiceName
  // locale can be like "en-US", "cmn-CN", etc.
  const parts = apiCode.split('-Chirp3-HD-');
  return parts[0] || apiCode;
}

/**
 * Get all unique locales for a language by extracting from apiCodes
 */
export function getLocalesByLanguageCode(code: string): string[] {
  const voices = getVoicesByLanguageCode(code);
  const locales = voices.map((v) => getLocaleFromApiCode(v.apiCode));
  return [...new Set(locales)];
}

/**
 * Generate a course name from base and target language codes
 */
export function generateCourseName(
  baseLanguageCodes: string[],
  targetLanguageCodes: string[],
): string {
  const baseLanguages = getLanguagesByCodes(baseLanguageCodes);
  const targetLanguages = getLanguagesByCodes(targetLanguageCodes);

  const baseName = baseLanguages.map((l) => l.name).join(', ');
  const targetName = targetLanguages.map((l) => l.name).join(', ');

  return `${baseName} → ${targetName}`;
}

/** Override Intl for zh-CN: engines label it "Chinese (China)" / regional variants; we use script-based naming. */
const ZH_CN_DISPLAY_NAMES: Record<string, string> = {
  en: 'Chinese (Simplified)',
  de: 'Chinesisch (Vereinfacht)',
};

function localizedZhCnName(locale: string): string {
  const lang = locale.split('-')[0]?.toLowerCase() ?? 'en';
  return ZH_CN_DISPLAY_NAMES[lang] ?? ZH_CN_DISPLAY_NAMES.en;
}

/**
 * Get a localized language name using the Intl.DisplayNames API
 * @param displayCode - BCP 47 language tag (e.g., "es-MX", "zh-CN")
 * @param locale - The locale to display the name in (e.g., "en", "de")
 * @returns The localized language name (e.g., "Spanish (Mexico)" in English, "Spanisch (Mexiko)" in German)
 */
export function getLocalizedLanguageName(
  displayCode: string,
  locale: string,
): string {
  if (displayCode.toLowerCase() === 'zh-cn') {
    return localizedZhCnName(locale);
  }
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'language' });
    return displayNames.of(displayCode) || displayCode;
  } catch (error) {
    // Fallback to the display code if DisplayNames fails
    console.warn(
      `Failed to get localized name for language "${displayCode}" in locale "${locale}":`,
      error,
    );
    return displayCode;
  }
}

/**
 * Get a localized language name by internal language code
 * @param code - Internal language code (e.g., "es", "zh")
 * @param locale - The locale to display the name in (e.g., "en", "de")
 * @returns The localized language name or the language's English name as fallback
 */
export function getLocalizedLanguageNameByCode(
  code: string,
  locale: string,
): string {
  const language = getLanguageByCode(code);
  if (!language) {
    return code;
  }
  return getLocalizedLanguageName(language.displayCode, locale);
}

/**
 * Languages whose script requires romanization (Latin transliteration).
 * Usable in both frontend and Convex backend.
 */
export const ROMANIZATION_LANGUAGES = new Set(['ru', 'hi', 'ja', 'ko', 'zh', 'el', 'ar']);

export function languageNeedsRomanization(code: string): boolean {
  return ROMANIZATION_LANGUAGES.has(code);
}
