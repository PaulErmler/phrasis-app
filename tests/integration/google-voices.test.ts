/**
 * Verifies every Google Chirp3-HD voice apiCode referenced in lib/voices.ts is
 * present in Google's live voice catalog.
 *
 * Uses `GET texttospeech.googleapis.com/v1/voices` once, then matches each
 * configured Google voice apiCode against the returned `name` values.
 *
 * Only Google is covered: 'azure' and 'elevenlabs' are retired tombstone
 * providers (lib/languages.ts) that no language routes to. The completeness checks in
 * `tests/unit/lib/voices.test.ts` ensure every language has *some* voice for
 * its active provider; this test ensures those voices exist
 * upstream.
 *
 * - Loads .env.local so developers don't have to export the key manually.
 * - Skips silently when the API key is absent (CI without secrets).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';
import { VOICE_POOLS, type Voice } from '../../lib/voices';

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

const apiKey = process.env.GOOGLE_TTS_API_KEY;

function collectUniqueGoogleVoices(): Voice[] {
  const seen = new Map<string, Voice>();
  for (const pool of Object.values(VOICE_POOLS)) {
    for (const voice of pool) {
      if (voice.provider !== 'google') continue;
      if (!seen.has(voice.apiCode)) seen.set(voice.apiCode, voice);
    }
  }
  return [...seen.values()];
}

const voices = collectUniqueGoogleVoices();

type GoogleVoice = { name: string; languageCodes: string[] };

describe.skipIf(!apiKey)(
  'Google Chirp3-HD voice names exist in the live catalog',
  () => {
    it(
      `all ${voices.length} configured Google voices resolve against /v1/voices`,
      async () => {
        const res = await fetch(
          `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`,
        );
        if (!res.ok) {
          throw new Error(
            `/v1/voices ${res.status}: ${(await res.text()).slice(0, 200)}`,
          );
        }
        const body = (await res.json()) as { voices?: GoogleVoice[] };
        const known = new Set((body.voices ?? []).map((v) => v.name));

        const missing = voices.filter((v) => !known.has(v.apiCode));
        if (missing.length > 0) {
          throw new Error(
            `${missing.length}/${voices.length} Google voices not found in catalog:\n` +
              missing.map((v) => `  - ${v.name} (${v.apiCode})`).join('\n'),
          );
        }
      },
      60_000,
    );

    it(
      'every Google-routed language has at least one active voice in the catalog',
      async () => {
        const res = await fetch(
          `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`,
        );
        if (!res.ok) {
          throw new Error(
            `/v1/voices ${res.status}: ${(await res.text()).slice(0, 200)}`,
          );
        }
        const body = (await res.json()) as { voices?: GoogleVoice[] };
        const known = new Set((body.voices ?? []).map((v) => v.name));

        const broken: string[] = [];
        for (const lang of SUPPORTED_LANGUAGES) {
          if (lang.ttsProvider !== 'google') continue;
          const pool = VOICE_POOLS[lang.code] ?? [];
          const usable = pool.filter(
            (v) =>
              v.provider === 'google' &&
              v.active !== false &&
              known.has(v.apiCode),
          );
          if (usable.length === 0) {
            broken.push(
              `${lang.code} (no Google voices in catalog match the configured pool)`,
            );
          }
        }
        if (broken.length > 0) {
          throw new Error(
            `Languages with broken Google TTS coverage:\n` +
              broken.map((m) => `  - ${m}`).join('\n'),
          );
        }
      },
      60_000,
    );
  },
);

describe('Google voice config shape', () => {
  it('every Google voice has a non-empty apiCode and name', () => {
    for (const voice of voices) {
      expect(voice.apiCode, `${voice.name} apiCode`).toMatch(/.+/);
      expect(voice.name, `voice name`).toMatch(/.+/);
    }
  });

  it('every Google voice apiCode looks like a {locale}-Chirp3-HD-{Name} string', () => {
    // {locale} is a BCP-47-ish tag like en-US / cmn-CN / yue-HK / ar-XA.
    const shape = /^[a-z]{2,3}-[A-Za-z]{2}-Chirp3-HD-[A-Za-z]+$/;
    for (const voice of voices) {
      expect(
        voice.apiCode,
        `${voice.name} apiCode should match Google Chirp3-HD format`,
      ).toMatch(shape);
    }
  });
});
