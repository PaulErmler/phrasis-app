import { SUPPORTED_LANGUAGES } from '../../../lib/languages';

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
 * Egyptian which has `ar-EG`; `sw_tz` → `sw-KE`; `es_mixed` → `es-ES`;
 * `es_latam` → `es-US`, Gemini's American-Spanish locale, since it has no
 * `es-419` macro locale).
 */
// Derived from each Language's `geminiBcp47` field (single source of truth in
// lib/languages.ts). Codes without one (Cantonese `yue`/`yue_traditional`) are
// absent and pass through unchanged so Gemini relies on text auto-detection.
const GEMINI_BCP47: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.filter((l) => l.geminiBcp47).map((l) => [
    l.code,
    l.geminiBcp47 as string,
  ]),
);

export function toGeminiBcp47(internalCode: string): string {
  return GEMINI_BCP47[internalCode] ?? internalCode;
}
