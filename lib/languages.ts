/**
 * Language definitions and utilities for the Phrasis app
 */

export interface Language {
    code: string; // ISO 639-1 language code (for internal use and database storage)
    displayCode: string; // BCP 47 language tag for display (e.g., "es-MX", "zh-CN")
    name: string; // English name (fallback)
    nativeName: string; // Name in the language itself
    flag: string; // Flag emoji
    learnerCount?: string; // e.g. "24.2M"
  }
  
  export const SUPPORTED_LANGUAGES: Language[] = [
    {
      code: "en",
      displayCode: "en",
      name: "English",
      nativeName: "English",
      flag: "🇬🇧",
      learnerCount: "1.5B",
    },
    {
      code: "es",
      displayCode: "es",
      name: "Spanish",
      nativeName: "Español",
      flag: "🇪🇸",
      learnerCount: "24.2M",
    },
    {
      code: "fr",
      displayCode: "fr",
      name: "French",
      nativeName: "Français",
      flag: "🇫🇷",
      learnerCount: "15.4M",
    },
    {
      code: "de",
      displayCode: "de",
      name: "German",
      nativeName: "Deutsch",
      flag: "🇩🇪",
      learnerCount: "9.2M",
    },
    {
      code: "it",
      displayCode: "it",
      name: "Italian",
      nativeName: "Italiano",
      flag: "🇮🇹",
      learnerCount: "5.1M",
    },
    {
      code: "pt",
      displayCode: "pt",
      name: "Portuguese",
      nativeName: "Português",
      flag: "🇧🇷",
      learnerCount: "3.8M",
    },
    {
      code: "zh",
      displayCode: "zh-CN",
      name: "Chinese (Simplified)",
      nativeName: "中文（简体）",
      flag: "🇨🇳",
      learnerCount: "12.5M",
    },
    {
      code: "ja",
      displayCode: "ja",
      name: "Japanese",
      nativeName: "日本語",
      flag: "🇯🇵",
      learnerCount: "8.4M",
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
