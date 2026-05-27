/**
 * Shared translation helpers — used by features/decks.ts and testing/translation.ts.
 * No Convex function exports; just plain async helpers.
 *
 * Uses Google Cloud Translation API v2 (API key) for translations,
 * v3 (service account OAuth2) for romanization of ru/hi/ja,
 * chinese-to-pinyin for Chinese romanization,
 * hangul-romanization for Korean (Revised Romanization),
 * and greek-utils for Greek phonetic Latin.
 */

import { romanizeLocal } from '../lib/localRomanization';
import { SignJWT, importPKCS8 } from 'jose';

/**
 * Map internal language codes to Google Translate / romanization API codes.
 * Codes not listed here are passed through as-is. Most ISO 639-1 codes work
 * unmapped against both the v2 translate and v3 romanizeText endpoints —
 * only regional variants and our internal dialect codes need an override.
 *
 * For Arabic dialects we deliberately collapse to plain `ar` (MSA) because
 * Google has no per-dialect romanization model — the user requested this
 * fallback explicitly. Cantonese variants collapse to `yue`; Chinese
 * Traditional uses local pinyin (see localRomanization.ts) so its entry here
 * only matters when translating away from `zh_traditional`.
 */
const GOOGLE_TRANSLATE_CODE_MAP: Record<string, string> = {
  // Spanish variants collapse to plain `es`. Google Translate v2 does NOT
  // accept locale tags like `es-ES` / `es-US` (verified against /v2/languages)
  // — only `zh-CN`, `zh-TW`, `pt-PT`, `fr-CA` and a few script-tagged codes
  // are locale-aware. Regional flavor only matters for LLM/voice paths; v2
  // is the legacy fallback and degrading to base Spanish is acceptable when
  // it fires.
  es: 'es',
  es_latam: 'es',
  es_mixed: 'es',
  // English variants collapse to plain `en` for the same reason (v2 rejects
  // `en-GB` / `en-US` / `en-AU`). English is source-only in normal flows, so
  // this only matters if a non-English course translates *into* an English
  // variant via the fallback.
  en_gb: 'en',
  en_us: 'en',
  en_au: 'en',
  // Chinese Traditional: Google accepts `zh-TW` (one of the few locale-tagged
  // codes the v2 catalog actually exposes).
  zh_traditional: 'zh-TW',
  // Cantonese: Google romanization v3 supports `yue`.
  yue: 'yue',
  yue_traditional: 'yue',
  // Norwegian Bokmål: v2 lists `no` (generic Norwegian), not `nb`.
  nb: 'no',
  // Arabic dialects → plain `ar` for romanization (Google has no per-dialect
  // model). The same code is fine for translate v2 — the LLM/Azure handle
  // dialect-specific output via voice + prompt, not translate API.
  ar_sa: 'ar',
  ar_eg: 'ar',
  ar_iq: 'ar',
  ar_lev: 'ar',
  // Swahili: Google's translate codes are `sw`; pass the bare code for both
  // regional variants (the regional difference matters for voices, not text).
  sw: 'sw',
  sw_tz: 'sw',
};

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

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id: string;
}

function getServiceAccountCredentials(): ServiceAccountCredentials {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');
  const json = raw.trimStart().startsWith('{') ? raw : atob(raw);
  return JSON.parse(json);
}

let cachedToken: { token: string; projectId: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<{ token: string; projectId: string }> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return { token: cachedToken.token, projectId: cachedToken.projectId };
  }

  const creds = getServiceAccountCredentials();
  const privateKey = await importPKCS8(creds.private_key, 'RS256');
  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/cloud-translation',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(creds.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Service account token exchange failed: ${response.status} - ${text}`);
  }
  const data = (await response.json()) as { access_token: string };

  cachedToken = {
    token: data.access_token,
    projectId: creds.project_id,
    expiresAt: Date.now() + 4 * 60 * 1000,
  };

  return { token: data.access_token, projectId: creds.project_id };
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
 * actually supports (as of May 2026). The endpoint 400s with
 * "Source language is unsupported" for anything outside this set —
 * we used to discover that the hard way (he, th, yue all crashed in prod).
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
    // romanizedText). Kept after the Arabic root-cause investigation
    // because the bug appears to be a Google-side flake that retries can
    // sometimes paper over.
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
