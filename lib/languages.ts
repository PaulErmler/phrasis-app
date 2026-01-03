export const LANGUAGES = {
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
  sv: "Swedish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
} as const;

export type LanguageCode = keyof typeof LANGUAGES;

export function getLanguageName(code: string): string {
  return LANGUAGES[code as LanguageCode] || code.toUpperCase();
}

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).map(([code, name]) => ({
  code,
  name,
}));
