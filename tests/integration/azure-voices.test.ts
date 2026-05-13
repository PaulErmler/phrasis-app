/**
 * Verifies every Azure voice short name referenced in lib/voices.ts is
 * present in the Azure voice catalog for the configured region.
 *
 * Uses `GET /cognitiveservices/voices/list` once, then matches each
 * configured Azure voice apiCode against the returned ShortName values.
 *
 * - Loads .env.local so developers don't have to export the key manually.
 * - Skips silently when the key/region is absent (CI without secrets).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
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

const apiKey = process.env.AZURE_SPEECH_API_KEY;
const region = process.env.AZURE_SPEECH_REGION;

function collectUniqueVoices(): Voice[] {
  const seen = new Map<string, Voice>();
  for (const pool of Object.values(VOICE_POOLS)) {
    for (const voice of pool) {
      if (voice.provider !== 'azure') continue;
      if (!seen.has(voice.apiCode)) seen.set(voice.apiCode, voice);
    }
  }
  return [...seen.values()];
}

const voices = collectUniqueVoices();

type AzureVoice = { ShortName: string; Locale: string };

describe.skipIf(!apiKey || !region)(
  'Azure voice short names exist in the region catalog',
  () => {
    it(
      `all ${voices.length} configured Azure voices resolve against /voices/list`,
      async () => {
        const res = await fetch(
          `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
          { headers: { 'Ocp-Apim-Subscription-Key': apiKey! } },
        );
        if (!res.ok) {
          throw new Error(
            `voices/list ${res.status}: ${(await res.text()).slice(0, 200)}`,
          );
        }
        const catalog = (await res.json()) as AzureVoice[];
        const known = new Set(catalog.map((v) => v.ShortName));

        const missing = voices.filter((v) => !known.has(v.apiCode));
        if (missing.length > 0) {
          throw new Error(
            `${missing.length}/${voices.length} Azure voices not found in region "${region}":\n` +
              missing.map((v) => `  - ${v.name} (${v.apiCode})`).join('\n'),
          );
        }
      },
      60_000,
    );
  },
);

describe('Azure voice config shape', () => {
  it('every Azure voice has a non-empty apiCode and name', () => {
    for (const voice of voices) {
      expect(voice.apiCode, `${voice.name} apiCode`).toMatch(/.+/);
      expect(voice.name, `voice name`).toMatch(/.+/);
    }
  });

  it('every Azure voice apiCode looks like a {locale}-{Name}Neural short name', () => {
    // Two valid shapes:
    //   - {locale}-{Name}Neural                          (standard Neural)
    //   - {locale}-{Name}:DragonHDLatestNeural           (Microsoft Dragon HD)
    const shape =
      /^[a-z]{2,3}-[A-Za-z0-9]+-[A-Za-z0-9]+(?::DragonHDLatest)?Neural$/;
    for (const voice of voices) {
      expect(
        voice.apiCode,
        `${voice.name} apiCode should match Azure short-name format`,
      ).toMatch(shape);
    }
  });
});
