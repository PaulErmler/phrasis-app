/**
 * Shared translation helpers — used by features/decks.ts and
 * features/llmTranslationQueue.ts; `toGoogleTranslateCode` is also exercised
 * by tests/integration/google-translate-fallback.test.ts and
 * convex/tests/features/translationCodes.test.ts.
 * No Convex function exports; just plain async helpers.
 *
 * Uses Google Cloud Translation API v2 (API key) for translations,
 * v3 (service account OAuth2) for romanization of ru/hi/ja,
 * chinese-to-pinyin for Chinese romanization,
 * hangul-romanization for Korean (Revised Romanization),
 * and greek-utils for Greek phonetic Latin.
 */

import { romanizeLocal } from '../lib/localRomanization';
import { getServiceAccountAccessToken } from '../lib/googleServiceAccount';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';

/**
 * Map internal language codes to Google Translate / romanization API codes.
 * Derived from each Language's `googleTranslateCode` field (single source of
 * truth in lib/languages.ts); codes without one pass through unchanged. Most
 * ISO 639-1 codes work unmapped against both the v2 translate and v3
 * romanizeText endpoints — only regional variants and internal dialect codes
 * set an override (e.g. Spanish/English variants collapse to the bare lang,
 * Arabic dialects collapse to `ar`, Chinese Traditional / European Portuguese
 * keep their locale-tagged form which v2 accepts).
 */
const GOOGLE_TRANSLATE_CODE_MAP: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.filter((l) => l.googleTranslateCode).map((l) => [
    l.code,
    l.googleTranslateCode as string,
  ]),
);

export function toGoogleTranslateCode(code: string): string {
  return GOOGLE_TRANSLATE_CODE_MAP[code] ?? code;
}

/** Google Translation API v2 response type */
interface GoogleTranslateResponse {
  data: {
    translations: Array<{
      translatedText: string;
    }>;
  };
}

/** Google Translation API v3 romanization response type */
interface GoogleRomanizeResponse {
  romanizations: Array<{
    romanizedText: string;
  }>;
}

/**
 * Cloud Translation v3 needs an OAuth2 access token rather than an API key.
 * The JWT-bearer exchange lives in lib/googleServiceAccount.ts, shared with FCM
 * push delivery — same flow, different project and scope.
 */
async function getGoogleAccessToken(): Promise<{ token: string; projectId: string }> {
  return getServiceAccountAccessToken({
    raw: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    envName: 'GOOGLE_SERVICE_ACCOUNT_KEY',
    scope: 'https://www.googleapis.com/auth/cloud-translation',
  });
}

/**
 * Call the Google Cloud Translation v2 REST API.
 * Returns the translated text. Throws on any error.
 */
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) throw new Error('Translation service not configured');

  const googleSource = toGoogleTranslateCode(sourceLang);
  const googleTarget = toGoogleTranslateCode(targetLang);
  const startedAt = Date.now();

  console.log('[translation] Google Translate v2 request', {
    sourceLang,
    targetLang,
    googleSource,
    googleTarget,
    textCharCount: text.length,
    api: 'language/translate/v2',
  });

  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: googleSource,
        target: googleTarget,
        format: 'text',
      }),
    },
  );

  const elapsedMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[translation] Google Translate v2 error', {
      status: response.status,
      elapsedMs,
      sourceLang,
      targetLang,
      bodyPreview: errorText.slice(0, 500),
    });
    throw new Error(`Google API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as GoogleTranslateResponse;
  const translation = data.data?.translations?.[0]?.translatedText;
  if (!translation) throw new Error('No translation returned from Google API');

  console.log('[translation] Google Translate v2 ok', {
    sourceLang,
    targetLang,
    elapsedMs,
    resultCharCount: translation.length,
  });

  return translation;
}

/**
 * Source-language codes that Google Cloud Translation v3 romanizeText
 * supports. The endpoint 400s with "Source language is unsupported" for
 * source languages outside this set.
 *
 * Keep this list in sync with
 * https://docs.cloud.google.com/translate/docs/advanced/romanize-text
 * Map our internal codes via GOOGLE_TRANSLATE_CODE_MAP first, then check
 * membership.
 */
const GOOGLE_V3_ROMANIZE_SUPPORTED = new Set([
  'am', 'ar', 'be', 'bn', 'gu', 'hi', 'ja',
  'kn', 'my', 'ru', 'sr', 'ta', 'te', 'uk',
]);

/** Max attempts when calling Google v3 romanizeText. The endpoint
 * occasionally returns `200 {"romanizations":[{}]}` for short inputs
 * (observed on Arabic before it moved to the local path); a quick retry
 * sometimes lands on a working backend instance. Callers that don't want a
 * hard failure already `try/catch` and leave `romanizedText` empty, so on
 * full exhaustion we just throw and let the caller skip persisting. */
const ROMANIZE_MAX_ATTEMPTS = 3;

/** One call to Google v3 romanizeText. Returns the romanized string or
 * throws — wrapped by `romanizeText` in a retry loop. */
async function romanizeViaGoogleV3Once(
  text: string,
  sourceLanguage: string,
  googleLang: string,
  attempt: number,
): Promise<string> {
  const { token, projectId } = await getGoogleAccessToken();
  const url = `https://translation.googleapis.com/v3/projects/${projectId}/locations/global:romanizeText`;
  const startedAt = Date.now();

  console.log('[translation] Google romanizeText v3 request', {
    sourceLanguage,
    googleLang,
    textCharCount: text.length,
    attempt,
    maxAttempts: ROMANIZE_MAX_ATTEMPTS,
    api: 'v3/.../romanizeText',
    projectId,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      source_language_code: googleLang,
      contents: [text],
    }),
  });

  const elapsedMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[translation] Google romanizeText v3 error', {
      status: response.status,
      elapsedMs,
      sourceLanguage,
      googleLang,
      attempt,
      bodyPreview: errorText.slice(0, 500),
    });
    throw new Error(
      `Google romanize API error: ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as GoogleRomanizeResponse;
  const romanized = data.romanizations?.[0]?.romanizedText;
  if (!romanized) {
    // Diagnostic dump for the empty-result case (200 OK, empty/missing
    // romanizedText) — a Google-side flake that retries can sometimes
    // paper over.
    console.error('[translation] Google romanizeText v3 empty result', {
      sourceLanguage,
      googleLang,
      elapsedMs,
      attempt,
      textCharCount: text.length,
      textPreview: text.slice(0, 80),
      romanizationsLength: Array.isArray(data.romanizations)
        ? data.romanizations.length
        : 'not-an-array',
      firstEntryKeys:
        data.romanizations && data.romanizations[0]
          ? Object.keys(data.romanizations[0])
          : null,
      bodyPreview: JSON.stringify(data).slice(0, 2000),
    });
    throw new Error('No romanization returned from Google API');
  }

  console.log('[translation] Google romanizeText v3 ok', {
    sourceLanguage,
    elapsedMs,
    attempt,
    resultCharCount: romanized.length,
  });

  return romanized;
}

/**
 * Romanize non-Latin script text.
 *
 *   - Chinese / Cantonese: local chinese-to-pinyin + cantonese-romanisation
 *   - Greek: greek-utils phonetic Latin
 *   - Korean: hangul-romanization (Revised Romanization)
 *   - Hebrew: hebrew-transliteration (SBL Academic)
 *   - Arabic (incl. ar_sa / ar_eg / ar_iq / ar_lev): arabic-transliterate (IJMES)
 *   - everything else in `ROMANIZATION_LANGUAGES`: Google Cloud Translation
 *     v3 romanizeText, retried up to `ROMANIZE_MAX_ATTEMPTS` times.
 *
 * Throws when a language reaches this path with no working romanizer or
 * when all Google attempts fail. Every caller already wraps this in a
 * `try/catch` that leaves `romanizedText` empty on failure, so a hard
 * throw here means the row lands without romanization rather than the
 * whole translation pipeline failing.
 */
export async function romanizeText(
  text: string,
  sourceLanguage: string,
): Promise<string> {
  const local = romanizeLocal(text, sourceLanguage);
  if (local !== null) return local;

  // Hard gate: bail out cleanly before issuing a guaranteed-400 request.
  // The mapped (Google-facing) code is what determines support, since
  // dialect codes like ar_eg collapse to `ar` via GOOGLE_TRANSLATE_CODE_MAP.
  const googleLang = toGoogleTranslateCode(sourceLanguage);
  if (!GOOGLE_V3_ROMANIZE_SUPPORTED.has(googleLang)) {
    throw new Error(
      `Romanization not configured for language "${sourceLanguage}" (Google v3 doesn't support "${googleLang}" and no local romanizer is registered). Update ROMANIZATION_LANGUAGES in lib/languages.ts or wire a local romanizer.`,
    );
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ROMANIZE_MAX_ATTEMPTS; attempt++) {
    try {
      return await romanizeViaGoogleV3Once(
        text,
        sourceLanguage,
        googleLang,
        attempt,
      );
    } catch (err) {
      lastError = err;
      if (attempt < ROMANIZE_MAX_ATTEMPTS) {
        console.warn('[translation] romanizeText retrying', {
          sourceLanguage,
          googleLang,
          attempt,
          maxAttempts: ROMANIZE_MAX_ATTEMPTS,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}
