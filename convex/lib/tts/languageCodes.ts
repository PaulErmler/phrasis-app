/**
 * Map our internal language codes to ISO 639-1 codes that ElevenLabs APIs
 * accept. App-internal codes like `es_latam` and `cmn` aren't valid ISO 639-1
 * and must be folded to their base form. Used by both the Scribe STT path
 * (features/tts.ts) and the ElevenLabs TTS provider (lib/tts/elevenlabs.ts).
 */
export function toElevenLabsLanguageCode(internalCode: string): string {
  const map: Record<string, string> = {
    es_latam: 'es',
    cmn: 'zh',
  };
  return map[internalCode] ?? internalCode;
}

/**
 * Map our internal language codes to the BCP-47 locale Gemini 3.1 Flash TTS
 * expects in `provider.options.google.language_code` (sent through OpenRouter).
 * Gemini auto-detects language from the text, but an explicit locale steers
 * accent/pronunciation. Used by lib/tts/gemini.ts.
 *
 * Covers every `SUPPORTED_LANGUAGES` code that Gemini TTS supports, per
 * https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#available_languages.
 * Codes Gemini does not support (Cantonese `yue`/`yue_traditional`) are omitted
 * and fall through unchanged — Gemini then relies on text auto-detection.
 * Regional variants for which Gemini has no dedicated locale collapse onto the
 * nearest documented one (Arabic dialects → `ar-001` World Arabic, except
 * Egyptian which has `ar-EG`; `sw_tz` → `sw-KE`; `es_mixed` → `es-ES`).
 */
export function toGeminiBcp47(internalCode: string): string {
  const map: Record<string, string> = {
    // English
    en: 'en-US',
    en_us: 'en-US',
    en_gb: 'en-GB',
    en_au: 'en-AU',
    // Spanish
    es: 'es-ES',
    es_latam: 'es-419',
    es_mixed: 'es-ES',
    // European
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-BR',
    ro: 'ro-RO',
    ru: 'ru-RU',
    pl: 'pl-PL',
    sk: 'sk-SK',
    cs: 'cs-CZ',
    nl: 'nl-NL',
    sv: 'sv-SE',
    da: 'da-DK',
    fi: 'fi-FI',
    el: 'el-GR',
    hu: 'hu-HU',
    he: 'he-IL',
    tr: 'tr-TR',
    // Asian
    hi: 'hi-IN',
    bn: 'bn-BD',
    zh: 'cmn-CN',
    zh_traditional: 'cmn-TW',
    ja: 'ja-JP',
    ko: 'ko-KR',
    vi: 'vi-VN',
    th: 'th-TH',
    id: 'id-ID',
    // Arabic — Gemini ships only World (ar-001) + Egyptian (ar-EG); other
    // dialects route to World Arabic.
    ar: 'ar-001',
    ar_sa: 'ar-001',
    ar_eg: 'ar-EG',
    ar_iq: 'ar-001',
    ar_lev: 'ar-001',
    // Swahili — Gemini ships only Kenyan (sw-KE).
    sw: 'sw-KE',
    sw_tz: 'sw-KE',
  };
  return map[internalCode] ?? internalCode;
}
