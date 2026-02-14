/**
 * Language definitions and utilities for the Phrasis app
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
    voices: [
      // US English
      createChirp3Voice('Leda', 'female', 'en-US', 'US'),
      createChirp3Voice('Charon', 'male', 'en-US', 'US'),
      // UK English
      createChirp3Voice('Aoede', 'female', 'en-GB', 'UK'),
      createChirp3Voice('Orus', 'male', 'en-GB', 'UK'),
      // Australian English
      createChirp3Voice('Achernar', 'female', 'en-AU', 'AU'),
      createChirp3Voice('Achird', 'male', 'en-AU', 'AU'),
    ],
  },
  {
    code: 'es',
    displayCode: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    flag: '🇪🇸',
    voices: [
      // Spain Spanish
      createChirp3Voice('Leda', 'female', 'es-ES', 'Spain'),
      createChirp3Voice('Charon', 'male', 'es-ES', 'Spain'),
      // US Spanish
      createChirp3Voice('Aoede', 'female', 'es-US', 'US'),
      createChirp3Voice('Orus', 'male', 'es-US', 'US'),
    ],
  },
  {
    code: 'fr',
    displayCode: 'fr',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    voices: [
      // France French
      createChirp3Voice('Leda', 'female', 'fr-FR', 'France'),
      createChirp3Voice('Charon', 'male', 'fr-FR', 'France'),
      // Canadian French
      createChirp3Voice('Aoede', 'female', 'fr-CA', 'Canada'),
      createChirp3Voice('Orus', 'male', 'fr-CA', 'Canada'),
    ],
  },
  {
    code: 'de',
    displayCode: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    voices: [
      createChirp3Voice('Leda', 'female', 'de-DE', 'Germany'),
      createChirp3Voice('Charon', 'male', 'de-DE', 'Germany'),
    ],
  },
  {
    code: 'it',
    displayCode: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    voices: [
      createChirp3Voice('Leda', 'female', 'it-IT', 'Italy'),
      createChirp3Voice('Charon', 'male', 'it-IT', 'Italy'),
    ],
  },
  {
    code: 'pt',
    displayCode: 'pt',
    name: 'Portuguese',
    nativeName: 'Português',
    flag: '🇵🇹',
    voices: [
      createChirp3Voice('Leda', 'female', 'pt-PT', 'Portugal'),
      createChirp3Voice('Charon', 'male', 'pt-PT', 'Portugal'),
    ],
  },
  {
    code: 'zh',
    displayCode: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '中文（简体）',
    flag: '🇨🇳',
    voices: [
      createChirp3Voice('Leda', 'female', 'cmn-CN', 'Mandarin'),
      createChirp3Voice('Charon', 'male', 'cmn-CN', 'Mandarin'),
    ],
  },
  {
    code: 'ja',
    displayCode: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    voices: [
      createChirp3Voice('Leda', 'female', 'ja-JP', 'Japan'),
      createChirp3Voice('Charon', 'male', 'ja-JP', 'Japan'),
    ],
  },
  {
    code: 'sv',
    displayCode: 'sv',
    name: 'Swedish',
    nativeName: 'Svenska',
    flag: '🇸🇪',
    voices: [
      createChirp3Voice('Leda', 'female', 'sv-SE', 'Sweden'),
      createChirp3Voice('Charon', 'male', 'sv-SE', 'Sweden'),
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
