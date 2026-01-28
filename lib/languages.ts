/**
 * Language definitions and utilities for the Phrasis app
 */

export interface Language {
    code: string; // ISO 639-1 language code
    name: string; // English name
    nativeName: string; // Name in the language itself
    flag: string; // Flag emoji
    learnerCount?: string; // e.g. "24.2M"
  }
  
  export const SUPPORTED_LANGUAGES: Language[] = [
    {
      code: "en",
      name: "English",
      nativeName: "English",
      flag: "🇬🇧",
      learnerCount: "1.5B",
    },
    {
      code: "es",
      name: "Spanish",
      nativeName: "Español",
      flag: "🇪🇸",
      learnerCount: "24.2M",
    },
    {
      code: "fr",
      name: "French",
      nativeName: "Français",
      flag: "🇫🇷",
      learnerCount: "15.4M",
    },
    {
      code: "de",
      name: "German",
      nativeName: "Deutsch",
      flag: "🇩🇪",
      learnerCount: "9.2M",
    },
    {
      code: "it",
      name: "Italian",
      nativeName: "Italiano",
      flag: "🇮🇹",
      learnerCount: "5.1M",
    },
    {
      code: "pt",
      name: "Portuguese",
      nativeName: "Português",
      flag: "🇵🇹",
      learnerCount: "3.8M",
    },
    {
      code: "zh",
      name: "Chinese",
      nativeName: "中文",
      flag: "🇨🇳",
      learnerCount: "12.5M",
    },
    {
      code: "ja",
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
