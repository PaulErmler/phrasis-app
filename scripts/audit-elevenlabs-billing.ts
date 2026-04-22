/**
 * Audit every ElevenLabs voice in the curated pool against the Voices API to
 * confirm:
 *   1. category is `premade` or `professional` (the only first-party
 *      categories — `generated`, `cloned`, `famous`, `high_quality` indicate
 *      voices that may carry pricing multipliers or other restrictions);
 *   2. live moderation is OFF (`live_moderation_enabled !== true`) — live
 *      moderation adds latency and can interrupt synthesis on flagged content;
 *   3. safety_control is NONE/missing (anything else means the voice is
 *      gated, e.g. requires CAPTCHA or is banned).
 *
 * Note on "shared" voices: a voice with `sharing.status = "copied"` is one
 * the account owner pulled in from the Voice Library. It does NOT change the
 * per-character billing — TTS pricing is per character × model, regardless of
 * whether the voice is built-in, a Professional Voice Clone, or copied from
 * the library. So we do NOT flag `sharing` here.
 *
 * Note on `high_quality_base_model_ids`: this is an informational list of
 * models that produce high-quality audio for this voice. It is NOT a billing
 * tier — listed models are billed at their standard rates. We DO check that
 * the production model (eleven_flash_v2_5) appears in each voice's list, so
 * we surface voices that may sound degraded under our chosen model.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/audit-elevenlabs-billing.ts
 */
const PRODUCTION_MODEL_ID = 'eleven_flash_v2_5';
import { VOICE_POOLS } from '../lib/voices';

const API_URL = 'https://api.elevenlabs.io/v1/voices';

interface VoiceMeta {
  voice_id: string;
  name: string;
  category?: string;
  high_quality_base_model_ids?: string[];
  is_legacy?: boolean;
  safety_control?: string;
  live_moderation_enabled?: boolean;
  fiat_rate?: number;
  rate?: number;
  sharing?: { status?: string } | null;
  available_for_tiers?: string[];
}

interface AuditRow {
  voiceId: string;
  curatedName: string;
  languages: string[];
  ok: true | false;
  flags: string[];
  notHighQualityForProd: boolean;
  meta: VoiceMeta | null;
  error?: string;
}

const STANDARD_CATEGORIES = new Set(['premade', 'professional']);

function collectVoices(): Map<string, { name: string; languages: Set<string> }> {
  const out = new Map<string, { name: string; languages: Set<string> }>();
  for (const [lang, pool] of Object.entries(VOICE_POOLS)) {
    for (const v of pool) {
      if (v.provider !== 'elevenlabs') continue;
      const entry = out.get(v.apiCode) ?? { name: v.name, languages: new Set() };
      entry.languages.add(lang);
      out.set(v.apiCode, entry);
    }
  }
  return out;
}

async function fetchVoice(voiceId: string, apiKey: string): Promise<VoiceMeta> {
  const res = await fetch(`${API_URL}/${encodeURIComponent(voiceId)}`, {
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as VoiceMeta;
}

function evaluate(meta: VoiceMeta): {
  ok: boolean;
  flags: string[];
  notHighQualityForProd: boolean;
} {
  const flags: string[] = [];

  const category = meta.category ?? '<missing>';
  if (!STANDARD_CATEGORIES.has(category)) {
    flags.push(`non-standard category: ${category}`);
  }
  if (meta.is_legacy) flags.push('legacy voice');
  if (meta.live_moderation_enabled === true) flags.push('live_moderation_enabled=true');
  if (meta.safety_control && meta.safety_control !== 'NONE') {
    flags.push(`safety_control=${meta.safety_control}`);
  }

  // Soft warning: voice is fine to use, but turbo_v2_5 isn't in its
  // ElevenLabs-recommended HQ model list, so output may be lower fidelity.
  const hqIds = meta.high_quality_base_model_ids ?? [];
  const notHighQualityForProd = hqIds.length > 0 && !hqIds.includes(PRODUCTION_MODEL_ID);

  return { ok: flags.length === 0, flags, notHighQualityForProd };
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is required');
    process.exit(1);
  }

  const voices = collectVoices();
  console.log(`Auditing ${voices.size} unique ElevenLabs voices…\n`);

  const rows: AuditRow[] = [];
  let i = 0;
  for (const [voiceId, info] of voices) {
    i++;
    process.stdout.write(`[${i}/${voices.size}] ${info.name} (${voiceId}) … `);
    try {
      const meta = await fetchVoice(voiceId, apiKey);
      const verdict = evaluate(meta);
      rows.push({
        voiceId,
        curatedName: info.name,
        languages: [...info.languages].sort(),
        ok: verdict.ok,
        flags: verdict.flags,
        notHighQualityForProd: verdict.notHighQualityForProd,
        meta,
      });
      const status = verdict.ok ? 'OK' : `FLAGGED — ${verdict.flags.join('; ')}`;
      const hq = verdict.notHighQualityForProd ? `   ⚠ not HQ for ${PRODUCTION_MODEL_ID}` : '';
      console.log(`${status}${hq}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({
        voiceId,
        curatedName: info.name,
        languages: [...info.languages].sort(),
        ok: false,
        flags: [`API error`],
        notHighQualityForProd: false,
        meta: null,
        error: msg,
      });
      console.log(`ERROR — ${msg}`);
    }
    // Stay under provider concurrency; the per-voice metadata call is cheap
    // but ElevenLabs free/starter plans cap at 3 concurrent.
    await new Promise((r) => setTimeout(r, 80));
  }

  const flagged = rows.filter((r) => !r.ok);
  console.log('\n----- Summary -----');
  console.log(`OK:      ${rows.length - flagged.length}/${rows.length}`);
  console.log(`Flagged: ${flagged.length}/${rows.length}`);

  if (flagged.length > 0) {
    console.log('\nFlagged voices:');
    for (const r of flagged) {
      const langs = r.languages.join(',');
      console.log(`  - ${r.curatedName} (${r.voiceId}) [${langs}]`);
      for (const f of r.flags) console.log(`      • ${f}`);
      if (r.error) console.log(`      • ${r.error}`);
    }
  }

  // Voices whose HQ list doesn't include the production model — these still
  // synthesize fine, just at lower fidelity. Worth surfacing so a future
  // model swap (or per-voice override) can be decided deliberately.
  const notHQ = rows.filter((r) => r.notHighQualityForProd);
  console.log(
    `\nNot high-quality for ${PRODUCTION_MODEL_ID}: ${notHQ.length}/${rows.length}`,
  );
  if (notHQ.length > 0) {
    for (const r of notHQ) {
      const hq = r.meta?.high_quality_base_model_ids ?? [];
      const langs = r.languages.join(',');
      console.log(`  - ${r.curatedName} (${r.voiceId}) [${langs}]`);
      console.log(`      hq models: ${hq.join(', ') || '(none)'}`);
    }
  }

  // Print a categorical breakdown so you can see at a glance the distribution.
  const byCategory = new Map<string, number>();
  for (const r of rows) {
    const c = r.meta?.category ?? '(error)';
    byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
  }
  console.log('\nCategory distribution:');
  for (const [c, n] of [...byCategory.entries()].sort()) {
    console.log(`  ${c}: ${n}`);
  }

  if (flagged.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
