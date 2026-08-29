/**
 * Verifies every language in SUPPORTED_LANGUAGES is reachable by the legacy
 * Google Translate v2 fallback path. The final safety net the LLM queue
 * schedules when every model stage fails (`GOOGLE_TRANSLATE_SOURCE`).
 *
 * For each supported language we resolve its app code through the same
 * `toGoogleTranslateCode` map that `translateText()` uses, then assert the
 * resolved code appears in the live `/v2/languages` catalog.
 *
 * - Loads .env.local so developers don't have to export the key manually.
 * - Skips silently when GOOGLE_TRANSLATE_API_KEY is absent (CI without secrets).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';
import { toGoogleTranslateCode } from '../../convex/features/translation';

function loadEnvLocal() {
  const envPath = resolve(__dirname, '../../.env.local');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;

type LanguagesResponse = { data: { languages: Array<{ language: string }> } };

describe.skipIf(!apiKey)(
  'Google Translate v2 fallback supports every configured language',
  () => {
    it('every SUPPORTED_LANGUAGES entry maps to a code in /v2/languages', async () => {
      const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2/languages?key=${apiKey}`,
      );
      if (!res.ok) {
        throw new Error(
          `/v2/languages ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }
      const body = (await res.json()) as LanguagesResponse;
      const supported = new Set(body.data.languages.map((l) => l.language));

      const broken: string[] = [];
      for (const lang of SUPPORTED_LANGUAGES) {
        const mapped = toGoogleTranslateCode(lang.code);
        if (!supported.has(mapped)) {
          broken.push(`${lang.code} → "${mapped}" (not in v2 catalog)`);
        }
      }
      if (broken.length > 0) {
        throw new Error(
          `${broken.length}/${SUPPORTED_LANGUAGES.length} languages have no Google Translate v2 fallback:\n` +
            broken.map((m) => `  - ${m}`).join('\n'),
        );
      }
    }, 60_000);
  },
);
