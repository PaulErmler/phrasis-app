/**
 * Languages Microsoft lists for MAI-Transcribe-2 (bare ISO-639-1 / -3
 * codes, the only form the model accepts as a hint). Source: the
 * "Language support" table at
 * https://learn.microsoft.com/azure/ai-services/speech-service/mai-transcribe
 * as of 2026-09-04. Used by `convex/tests/lib/stt/languages.test.ts` to
 * catch a supported app language silently falling outside the model.
 */
export const MAI_TRANSCRIBE_2_LANGUAGES: ReadonlySet<string> = new Set([
  'af',
  'ar',
  'as',
  'az',
  'bg',
  'bn',
  'bs',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fa',
  'fi',
  'fil',
  'fr',
  'gl',
  'gu',
  'he',
  'hi',
  'hu',
  'hy',
  'id',
  'is',
  'it',
  'ja',
  'kk',
  'kn',
  'ko',
  'lt',
  'lv',
  'mk',
  'ml',
  'mr',
  'ms',
  'nb',
  'ne',
  'nl',
  'or',
  'pa',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'sw',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'vi',
  'yue',
  'zh',
]);

/**
 * App languages the model is not documented for but transcribes correctly.
 * Croatian and Serbian both came back with the right text, the right
 * detected language and word timings in the 2026-09-04 live test (Bosnian
 * is on the list, which presumably covers them). Kept explicit so the
 * exhaustiveness test forces a decision when a new language lands here.
 */
export const STT_UNLISTED_BUT_WORKING: ReadonlySet<string> = new Set([
  'hr',
  'sr',
]);

/**
 * Map an app-internal language code to the bare code MAI-Transcribe-2
 * accepts. Regional and script variants collapse onto their base language
 * (`en_gb` → `en`, `zh_traditional` → `zh`, `ar_eg` → `ar`); the model has
 * no way to express them and auto-detects the accent from the audio. `cmn`
 * is a legacy non-Language input (Google voice locale prefix for Mandarin)
 * kept as an alias.
 */
export function toSttLanguage(internalCode: string): string {
  if (internalCode === 'cmn') return 'zh';
  return internalCode.split('_')[0];
}
