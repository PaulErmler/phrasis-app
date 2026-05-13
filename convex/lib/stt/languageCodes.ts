/**
 * Map app-internal language codes to BCP-47 locales Azure Speech-to-Text
 * understands. The Fast Transcription API expects full locales like `sv-SE`,
 * not bare ISO 639-1 codes — so this is a richer mapping than the ElevenLabs
 * equivalent in ../tts/languageCodes.ts.
 *
 * Unmapped codes fall back to `<code>-<UPPER(code)>` (e.g. `pl` → `pl-PL`),
 * which is correct for the many symmetric ISO 639-1 / region pairs Azure
 * supports. Truly unknown codes still surface as a 400 from Azure.
 */
export function toAzureSttLocale(internalCode: string): string {
  const map: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    es_latam: 'es-MX',
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-BR',
    ru: 'ru-RU',
    hi: 'hi-IN',
    zh: 'zh-CN',
    cmn: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    vi: 'vi-VN',
    sv: 'sv-SE',
    fi: 'fi-FI',
    nl: 'nl-NL',
    el: 'el-GR',
    ar: 'ar-SA',
  };
  const mapped = map[internalCode];
  if (mapped) return mapped;
  return `${internalCode}-${internalCode.toUpperCase()}`;
}

/**
 * Candidate locales for auto-detection when the caller doesn't know the
 * source language. The only auto-detect caller today is chat voice input;
 * every other STT path passes an explicit language. Azure Fast Transcription
 * caps at 10 candidates per request, so this is the 10 globally most-spoken
 * languages Azure supports.
 */
export const AUTO_DETECT_LOCALES: readonly string[] = [
  'en-US', // English
  'zh-CN', // Mandarin
  'hi-IN', // Hindi
  'es-ES', // Spanish
  'ar-SA', // Arabic (MSA)
  'fr-FR', // French
  'bn-IN', // Bengali
  'pt-BR', // Portuguese
  'ru-RU', // Russian
  'de-DE', // German
];
