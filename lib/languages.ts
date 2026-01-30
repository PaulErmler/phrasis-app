/**
 * Language definitions and utilities for the Phrasis app
 */

/**
 * Voice configuration for text-to-speech
 */
export interface Voice {
  name: string; // Internal identifier
  displayName: string; // Human-readable name, e.g., "English (US) - Female"
  apiCode: string; // e.g. Google TTS voice code
}

export interface Language {
  code: string; // ISO 639-1 language code (for internal use and database storage)
  displayCode: string; // BCP 47 language tag for display (e.g., "es-MX", "zh-CN")
  name: string; // English name (fallback)
  nativeName: string; // Name in the language itself
  flag: string; // Flag emoji
  voices: Voice[]; // Available TTS voices for this language
}

export const SUPPORTED_LANGUAGES: Language[] = [
  {
    code: "en",
    displayCode: "en",
    name: "English",
    nativeName: "English",
    flag: "🇬🇧",
    voices: [],
  },
  {
    code: "es",
    displayCode: "es",
    name: "Spanish",
    nativeName: "Español",
    flag: "🇪🇸",
    voices: [],
  },
  {
    code: "fr",
    displayCode: "fr",
    name: "French",
    nativeName: "Français",
    flag: "🇫🇷",
    voices: [],
  },
  {
    code: "de",
    displayCode: "de",
    name: "German",
    nativeName: "Deutsch",
    flag: "🇩🇪",
    voices: [],
  },
  {
    code: "it",
    displayCode: "it",
    name: "Italian",
    nativeName: "Italiano",
    flag: "🇮🇹",
    voices: [],
  },
  {
    code: "pt",
    displayCode: "pt",
    name: "Portuguese",
    nativeName: "Português",
    flag: "🇧🇷",
    voices: [],
  },
  {
    code: "zh",
    displayCode: "zh-CN",
    name: "Chinese (Simplified)",
    nativeName: "中文（简体）",
    flag: "🇨🇳",
    voices: [],
  },
  {
    code: "ja",
    displayCode: "ja",
    name: "Japanese",
    nativeName: "日本語",
    flag: "🇯🇵",
    voices: [],
  },
  {
    code: "sv",
    displayCode: "sv",
    name: "Swedish",
    nativeName: "Svenska",
    flag: "🇸🇪",
    voices: [],
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
 * Generate a course name from base and target language codes
 */
export function generateCourseName(
  baseLanguageCodes: string[],
  targetLanguageCodes: string[]
): string {
  const baseLanguages = getLanguagesByCodes(baseLanguageCodes);
  const targetLanguages = getLanguagesByCodes(targetLanguageCodes);

  const baseName = baseLanguages.map((l) => l.name).join(", ");
  const targetName = targetLanguages.map((l) => l.name).join(", ");

  return `${baseName} → ${targetName}`;
}

/**
 * Get a localized language name using the Intl.DisplayNames API
 * @param displayCode - BCP 47 language tag (e.g., "es-MX", "zh-CN")
 * @param locale - The locale to display the name in (e.g., "en", "de")
 * @returns The localized language name (e.g., "Spanish (Mexico)" in English, "Spanisch (Mexiko)" in German)
 */
export function getLocalizedLanguageName(displayCode: string, locale: string): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'language' });
    return displayNames.of(displayCode) || displayCode;
  } catch (error) {
    // Fallback to the display code if DisplayNames fails
    console.warn(`Failed to get localized name for language "${displayCode}" in locale "${locale}":`, error);
    return displayCode;
  }
}

/**
 * Get a localized language name by internal language code
 * @param code - Internal language code (e.g., "es", "zh")
 * @param locale - The locale to display the name in (e.g., "en", "de")
 * @returns The localized language name or the language's English name as fallback
 */
export function getLocalizedLanguageNameByCode(code: string, locale: string): string {
  const language = getLanguageByCode(code);
  if (!language) {
    return code;
  }
  return getLocalizedLanguageName(language.displayCode, locale);
}
