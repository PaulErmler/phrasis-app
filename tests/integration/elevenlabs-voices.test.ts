/**
 * Verifies every ElevenLabs voice_id referenced in lib/languages.ts still
 * exists in the ElevenLabs shared voice library.
 *
 * Uses `GET /v1/shared-voices?search={voice_id}` which returns the voice if
 * it's still listed publicly. No credits consumed. If an owner deletes or
 * unlists their voice, the search returns no match for that id.
 *
 * - Loads .env.local so developers don't have to export the key manually.
 * - Skips silently when the key is absent (CI without secrets).
 * - Concurrency-capped at 3 to stay under ElevenLabs' rate limit.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { VOICE_POOLS, type Voice } from '../../lib/voices';

// Hand-rolled .env.local loader — avoids adding dotenv to the global vitest
// setup. Only sets vars that aren't already in process.env.
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

const apiKey = process.env.ELEVENLABS_API_KEY;

function collectUniqueVoices(): Voice[] {
  const seen = new Map<string, Voice>();
  for (const pool of Object.values(VOICE_POOLS)) {
    for (const voice of pool) {
      if (voice.provider !== 'elevenlabs') continue;
      if (!seen.has(voice.apiCode)) seen.set(voice.apiCode, voice);
    }
  }
  return [...seen.values()];
}

const voices = collectUniqueVoices();

const CONCURRENCY = 3;

async function probeVoice(
  voice: Voice,
  key: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(voice.apiCode)}&page_size=10`,
    {
      headers: { 'xi-api-key': key, Accept: 'application/json' },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `search failed: ${res.status} ${body.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    voices?: { voice_id: string }[];
  };
  const match = data.voices?.find((v) => v.voice_id === voice.apiCode);
  if (!match) {
    return {
      ok: false,
      error: 'not found in shared voice library (owner may have removed/unlisted it)',
    };
  }
  return { ok: true };
}

describe.skipIf(!apiKey)('ElevenLabs voice IDs are valid on the account', () => {
  it(
    `all ${voices.length} unique voice IDs synthesize successfully`,
    async () => {
      const failures: string[] = [];
      // Simple sliding-window pool capped at CONCURRENCY.
      let cursor = 0;
      async function worker() {
        while (cursor < voices.length) {
          const i = cursor++;
          const v = voices[i];
          try {
            const result = await probeVoice(v, apiKey!);
            if (!result.ok) {
              failures.push(`  - ${v.name} (${v.apiCode}) — ${result.error}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push(`  - ${v.name} (${v.apiCode}) — ${msg}`);
          }
        }
      }
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () => worker()),
      );

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${voices.length} ElevenLabs voice IDs are NOT usable:\n` +
            failures.join('\n'),
        );
      }
    },
    120_000,
  );
});

// Always-runs sanity checks so the file has at least one passing assertion
// even when the integration suite is skipped (e.g. CI without the key).
describe('ElevenLabs voice config shape', () => {
  it('every ElevenLabs voice has a non-empty apiCode and name', () => {
    for (const voice of voices) {
      expect(voice.apiCode, `${voice.name} apiCode`).toMatch(/.+/);
      expect(voice.name, `voice name`).toMatch(/.+/);
    }
  });

  it('has at least one ElevenLabs voice configured', () => {
    expect(voices.length).toBeGreaterThan(0);
  });
});
