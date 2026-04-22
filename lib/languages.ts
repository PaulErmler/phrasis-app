/**
 * Language metadata for the Flexling app.
 *
 * This file owns:
 *   - The Language and TtsProvider types
 *   - SUPPORTED_LANGUAGES (pure metadata — no voices)
 *   - Language-metadata helpers (name lookup, short labels, romanization, …)
 *
 * Voice data and voice-selection helpers live in `lib/voices.ts`. They're
 * re-exported at the bottom of this file so existing imports of things like
 * `getVoiceForLanguage` from `lib/languages` keep working.
 */

/** Identifier for which TTS backend a language currently uses. */
export type TtsProvider = 'google' | 'elevenlabs';

export interface Language {
  code: string; // Internal language code (e.g. "en", "es_latam", "zh")
  displayCode: string; // BCP 47 tag for display (e.g. "es-MX", "zh-CN")
  name: string; // English name (fallback)
  nativeName: string; // Name in the language itself
  flag: string; // Flag emoji
  /** Which provider's voices the app uses for this language right now. */
  ttsProvider: TtsProvider;
  /** Whether the script requires Latin transliteration for learners. */
  needsRomanization: boolean;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  {
    code: 'en',
    displayCode: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇬🇧',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'es',
    displayCode: 'es-ES',
    name: 'Spanish (Spain)',
    nativeName: 'Español (España)',
    flag: '🇪🇸',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'es_latam',
    displayCode: 'es-419',
    name: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
    flag: '🌎',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'fr',
    displayCode: 'fr',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'de',
    displayCode: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'it',
    displayCode: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'pt',
    displayCode: 'pt',
    name: 'Portuguese (Brazil)',
    nativeName: 'Português',
    flag: '🇧🇷',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'ru',
    displayCode: 'ru',
    name: 'Russian',
    nativeName: 'Русский',
    flag: '🇷🇺',
    ttsProvider: 'google',
    needsRomanization: true,
  },
  {
    code: 'hi',
    displayCode: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳',
    ttsProvider: 'google',
    needsRomanization: true,
  },
  {
    code: 'zh',
    displayCode: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '中文（简体）',
    flag: '🇨🇳',
    ttsProvider: 'google',
    needsRomanization: true,
  },
  {
    code: 'ja',
    displayCode: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    ttsProvider: 'google',
    needsRomanization: true,
  },
  {
    code: 'ko',
    displayCode: 'ko',
    name: 'Korean',
    nativeName: '한국어',
    flag: '🇰🇷',
    ttsProvider: 'google',
    needsRomanization: true,
  },
  {
    code: 'vi',
    displayCode: 'vi',
    name: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    flag: '🇻🇳',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'sv',
    displayCode: 'sv',
    name: 'Swedish',
    nativeName: 'Svenska',
    flag: '🇸🇪',
    ttsProvider: 'elevenlabs',
    needsRomanization: false,
  },
  {
    code: 'fi',
    displayCode: 'fi',
    name: 'Finnish',
    nativeName: 'Suomi',
    flag: '🇫🇮',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'nl',
    displayCode: 'nl',
    name: 'Dutch',
    nativeName: 'Nederlands',
    flag: '🇳🇱',
    ttsProvider: 'google',
    needsRomanization: false,
  },
  {
    code: 'el',
    displayCode: 'el',
    name: 'Greek',
    nativeName: 'Ελληνικά',
    flag: '🇬🇷',
    ttsProvider: 'google',
    needsRomanization: true,
  },
  {
    code: 'ar',
    displayCode: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    flag: '🇸🇦',
    ttsProvider: 'google',
    needsRomanization: true,
  },
  // Cantonese (Yue Chinese) — disabled until verified Cantonese-capable
  // voices are added to lib/voices.ts. Google Cloud TTS uses "yue-HK".
  // {
  //   code: 'yue',
  //   displayCode: 'yue-HK',
  //   name: 'Cantonese',
  //   nativeName: '廣東話',
  //   flag: '🇭🇰',
  //   ttsProvider: 'elevenlabs',
  //   needsRomanization: true,
  // },
];

// ---------------------------------------------------------------------------
// Language-metadata helpers
// ---------------------------------------------------------------------------

/** Get a language by its internal code (e.g. "es", "es_latam", "zh"). */
export function getLanguageByCode(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

/**
 * Which TTS provider is active for the given language.
 * Defaults to 'google' when the language is not found so callers get a safe
 * fallback instead of throwing.
 */
export function getTtsProviderForLanguage(code: string): TtsProvider {
  return getLanguageByCode(code)?.ttsProvider ?? 'google';
}

/**
 * Short tag for badges, chat previews, audio button labels, etc.
 * Both Spanish variants map to "ES" so internal codes like es_latam never
 * appear in the UI.
 */
export function getLanguageShortLabel(code: string | null | undefined): string {
  if (!code) return '';
  const normalized = code.toLowerCase();
  if (normalized === 'es' || normalized === 'es_latam') return 'ES';
  const language = getLanguageByCode(code);
  return language ? language.code.toUpperCase() : code.toUpperCase();
}

/** Resolve an array of codes to Language objects, dropping unknowns. */
export function getLanguagesByCodes(codes: string[]): Language[] {
  return codes
    .map((code) => getLanguageByCode(code))
    .filter((lang): lang is Language => lang !== undefined);
}

/** Human-readable course label like "English → Spanish, Japanese". */
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

// Override Intl for zh-CN: engines label it "Chinese (China)" / regional
// variants; we use script-based naming here.
const ZH_CN_DISPLAY_NAMES: Record<string, string> = {
  en: 'Chinese (Simplified)',
  de: 'Chinesisch (Vereinfacht)',
};

function localizedZhCnName(locale: string): string {
  const lang = locale.split('-')[0]?.toLowerCase() ?? 'en';
  return ZH_CN_DISPLAY_NAMES[lang] ?? ZH_CN_DISPLAY_NAMES.en;
}

/**
 * Localised language name via Intl.DisplayNames.
 * @param displayCode BCP 47 language tag (e.g. "es-MX", "zh-CN")
 * @param locale      Locale to display the name in (e.g. "en", "de")
 */
export function getLocalizedLanguageName(
  displayCode: string,
  locale: string,
): string {
  if (displayCode.toLowerCase() === 'zh-cn') return localizedZhCnName(locale);
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'language' });
    return displayNames.of(displayCode) || displayCode;
  } catch (error) {
    console.warn(
      `Failed to get localized name for language "${displayCode}" in locale "${locale}":`,
      error,
    );
    return displayCode;
  }
}

/** Same as `getLocalizedLanguageName` but takes our internal code. */
export function getLocalizedLanguageNameByCode(
  code: string,
  locale: string,
): string {
  const language = getLanguageByCode(code);
  if (!language) return code;
  return getLocalizedLanguageName(language.displayCode, locale);
}

/**
 * Languages whose script requires romanization (Latin transliteration).
 * Usable in both frontend and Convex backend.
 */
export const ROMANIZATION_LANGUAGES = new Set([
  'ru', 'hi', 'ja', 'ko', 'zh', 'el', 'ar',
]);

export function languageNeedsRomanization(code: string): boolean {
  return ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Normalize a language code by stripping regional variant suffixes (e.g.
 * `"es_latam"` → `"es"`). Single source of truth for variant collapsing
 * across stats, search, and UI.
 */
export function normalizeLanguageCode(code: string): string {
  return code.replace(/_latam$/, '');
}

// ---------------------------------------------------------------------------
// Voice helpers — re-exported from lib/voices.ts for backward compat.
// New code should import these directly from `lib/voices`.
// ---------------------------------------------------------------------------

export type { Voice } from './voices';
export {
  VOICE_POOLS,
  getVoicesByLanguageCode,
  getAllVoicesByLanguageCode,
  getRandomVoiceForLanguage,
  getVoiceForLanguage,
  getVoiceGenderByApiCode,
  getProviderByApiCode,
  getLocaleFromApiCode,
  getLocalesByLanguageCode,
  resolveAudioSpeakerGender,
} from './voices';
