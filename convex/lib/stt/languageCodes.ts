import { SUPPORTED_LANGUAGES } from '../../../lib/languages';

/**
 * Map app-internal language codes to BCP-47 locales Azure Speech-to-Text
 * understands. The Fast Transcription API expects full locales like `sv-SE`,
 * not bare ISO 639-1 codes.
 *
 * Derived from each Language's `azureSttLocale` field (single source of truth
 * in lib/languages.ts). Codes without one fall back to `<code>-<UPPER(code)>`
 * (correct for the many symmetric ISO 639-1 / region pairs Azure supports);
 * truly unknown codes still surface as a 400 from Azure. `cmn` is a legacy
 * non-Language input (Google voice locale prefix for Mandarin) kept as an alias.
 *
 * `es_mixed` returns a single-locale default; for the multi-locale path that
 * passes both Spanish classifiers to Azure's language-ID, call
 * `toAzureSttLocales('es_mixed')` instead.
 */
const AZURE_STT_LOCALE: Record<string, string> = {
  ...Object.fromEntries(
    SUPPORTED_LANGUAGES.filter((l) => l.azureSttLocale).map((l) => [
      l.code,
      l.azureSttLocale as string,
    ]),
  ),
  cmn: 'zh-CN',
};

export function toAzureSttLocale(internalCode: string): string {
  return (
    AZURE_STT_LOCALE[internalCode] ??
    `${internalCode}-${internalCode.toUpperCase()}`
  );
}

/**
 * Array-returning sibling of `toAzureSttLocale` for mixed-dialect codes whose
 * regional variant isn't known at request time. Azure Fast Transcription
 * accepts up to 10 candidate locales and runs language-ID across them. The
 * same mechanism used for the chat-voice auto-detect path.
 *
 * Behavior:
 *  - `regionVariant` provided → returns `[regionVariant]` (no language-ID
 *    needed, the audio's locale is known: e.g. TTS validation roundtrip
 *    after synthesizing with a specific voice).
 *  - `es_mixed` and no variant → returns both Spanish classifiers so Azure
 *    picks whichever the audio matches.
 *  - Any other code → returns `[toAzureSttLocale(code)]`.
 */
export function toAzureSttLocales(
  internalCode: string,
  regionVariant?: string,
): string[] {
  if (regionVariant) return [regionVariant];
  if (internalCode === 'es_mixed') return ['es-ES', 'es-MX'];
  return [toAzureSttLocale(internalCode)];
}

/**
 * Default 8 most-common locales used as the auto-detect base when no course
 * context is known. Trimmed from the historic 10-locale constant so callers
 * can append up to 2 course locales and stay under Azure's 10-candidate cap.
 */
const AUTO_DETECT_BASE: readonly string[] = [
  'en-US', // English
  'zh-CN', // Mandarin
  'hi-IN', // Hindi
  'es-ES', // Spanish
  'ar-SA', // Arabic (MSA)
  'fr-FR', // French
  'bn-IN', // Bengali
  'pt-BR', // Portuguese
] as const;

/**
 * Audio locales Azure's multi-lingual Fast Transcription model can recognize.
 * Requesting that model is what makes code-switched audio ("how do you say
 * *guten Morgen* in Spanish?") transcribable at all: candidate-locale
 * language-ID is documented to pick ONE dominant locale per file and returns
 * 422 `MultipleLanguagesIdentified` when the audio genuinely mixes languages.
 *
 * Source: fast transcription REST docs, multi-lingual transcription tab
 * (api-version 2024-11-15 onwards). Keep in sync when Azure widens the model.
 */
const MULTILINGUAL_MODEL_LOCALES: ReadonlySet<string> = new Set([
  'de-DE',
  'en-AU',
  'en-CA',
  'en-GB',
  'en-IN',
  'en-US',
  'es-ES',
  'es-MX',
  'fr-CA',
  'fr-FR',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'zh-CN',
]);

/** True when Azure's multi-lingual model covers this Azure locale. */
export function isMultilingualModelLocale(locale: string): boolean {
  return MULTILINGUAL_MODEL_LOCALES.has(locale);
}

/**
 * True when every language of the given course is covered by the multi-lingual
 * model, i.e. we can ask Azure to transcribe mixed-language audio continuously
 * instead of forcing it to pick one dominant locale. Empty input is false: with
 * no course context we can't rule out a language the model doesn't cover.
 */
export function supportsMultilingualModel(
  courseLanguages: readonly string[],
): boolean {
  if (courseLanguages.length === 0) return false;
  return courseLanguages.every((code) =>
    toAzureSttLocales(code).every(isMultilingualModelLocale),
  );
}

/**
 * Build the candidate-locale list for auto-detection.
 *
 * Returns an EMPTY array — Azure's documented request for its multi-lingual
 * model — when every course language is covered by that model. That is the
 * common case for chat voice input (the user speaks their base language, the
 * target language, or a mix of the two) and is the only mode that transcribes
 * code-switched audio instead of failing with `MultipleLanguagesIdentified`.
 * The model auto-detects across all 15 of its locales, so this is also a wider
 * net than the base 8 for those languages.
 *
 * Otherwise falls back to candidate-locale language-ID: the 8 globally
 * most-spoken locales, plus each course-language locale (deduped), capped at
 * Azure's 10-locale limit, with mixed-dialect codes (today: `es_mixed` →
 * `es-ES` + `es-MX`) expanded into their variants. Mixed-language audio can
 * still 422 on this path — callers that care handle the retry.
 *
 * Pass the active course's `baseLanguages` ∪ `targetLanguages` as
 * `courseLanguages`. Returns the base 8 when the array is empty.
 */
export function buildAutoDetectLocales(
  courseLanguages: readonly string[] = [],
): string[] {
  if (supportsMultilingualModel(courseLanguages)) return [];

  const result: string[] = [...AUTO_DETECT_BASE];
  const seen = new Set(result);
  const courseLocales: string[] = [];
  for (const code of courseLanguages) {
    for (const locale of toAzureSttLocales(code)) {
      if (!seen.has(locale)) {
        seen.add(locale);
        courseLocales.push(locale);
      }
    }
  }
  result.push(...courseLocales);
  // Azure caps at 10 candidates per request.
  return result.slice(0, 10);
}

/**
 * Default candidate locales for auto-detection when no course context is
 * available. Kept as the 8-locale base so existing callers that import
 * `AUTO_DETECT_LOCALES` continue to work without modification.
 */
export const AUTO_DETECT_LOCALES: readonly string[] = AUTO_DETECT_BASE;
