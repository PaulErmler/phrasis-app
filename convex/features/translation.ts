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

import { convert as romanizeHangul } from 'hangul-romanization';
// @ts-expect-error no type declarations for chinese-to-pinyin
import pinyin from 'chinese-to-pinyin';
// @ts-expect-error no type declarations for greek-utils
import greekUtils from 'greek-utils';
import { SignJWT, importPKCS8 } from 'jose';

/**
 * Map internal language codes to Google Translate / romanization API codes.
 * Codes not listed here are passed through as-is.
 */
const GOOGLE_TRANSLATE_CODE_MAP: Record<string, string> = {
  es: 'es-ES',
  es_latam: 'es-US',
};

function toGoogleTranslateCode(code: string): string {
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
 * Romanize non-Latin script text.
 * Chinese uses the local chinese-to-pinyin library;
 * Greek uses greek-utils phonetic Latin;
 * Korean uses hangul-romanization (Revised Romanization);
 * other languages use the Google Cloud Translation v3 romanizeText endpoint.
 */
export async function romanizeText(
  text: string,
  sourceLanguage: string,
): Promise<string> {
  if (sourceLanguage === 'zh') {
    return pinyin(text) as string;
  }

  if (sourceLanguage === 'el') {
    return greekUtils.toPhoneticLatin(text);
  }

  if (sourceLanguage === 'ko') {
    return romanizeHangul(text);
  }

  const { token, projectId } = await getGoogleAccessToken();
  const url = `https://translation.googleapis.com/v3/projects/${projectId}/locations/global:romanizeText`;
  const googleLang = toGoogleTranslateCode(sourceLanguage);
  const startedAt = Date.now();

  console.log('[translation] Google romanizeText v3 request', {
    sourceLanguage,
    googleLang,
    textCharCount: text.length,
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
      bodyPreview: errorText.slice(0, 500),
    });
    throw new Error(`Google romanize API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as GoogleRomanizeResponse;
  const romanized = data.romanizations?.[0]?.romanizedText;
  if (!romanized) throw new Error('No romanization returned from Google API');

  console.log('[translation] Google romanizeText v3 ok', {
    sourceLanguage,
    elapsedMs,
    resultCharCount: romanized.length,
  });

  return romanized;
}
