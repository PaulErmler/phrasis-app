/**
 * Generate ElevenLabs audio for every flashcard line on the landing page.
 *
 * Re-run this script whenever messages/landing/{en,de}.json card content
 * changes. It walks the known schema, dedupes by (text, lang), hashes each
 * pair to a stable filename, calls ElevenLabs only for missing files, and
 * emits a manifest at lib/landing/audio-manifest.json that components look
 * up at render time.
 *
 * Each generated mp3 is also validated round-trip: the audio is transcribed
 * with ElevenLabs Scribe and the transcription is compared (normalized,
 * Levenshtein ≤ 1) to the original text. On mismatch the script retries up
 * to 3 times, then surfaces the failure in the summary so a human can listen.
 *
 * Usage:
 *   pnpm landing:audio               # generate + validate missing files only
 *   pnpm landing:audio --revalidate  # also re-validate files already on disk; regenerate any that fail
 *   pnpm landing:audio --prune       # delete orphan mp3s no longer in manifest
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PUBLIC_AUDIO_DIR = join(REPO_ROOT, 'public', 'audio', 'landing');
const MANIFEST_PATH = join(REPO_ROOT, 'lib', 'landing', 'audio-manifest.json');
const MESSAGES_DIR = join(REPO_ROOT, 'messages', 'landing');

const MODEL_ID = 'eleven_flash_v2_5';

// Mirrors the in-app default settings (convex/features/tts.ts:135). Kept
// in sync so landing-page audio sounds the same as audio users will hear
// inside the app once they sign up.
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75 };

// One deterministic voice per language so re-runs produce stable hashes and
// the demo speaks consistently. All female (matches the existing landing
// "same speaker, different language" feel).
const LANDING_VOICES: Record<string, string> = {
  en: 'aMSt68OGf4xUZAnLpTU8', // Juniper
  de: '8wPhfH9uUzEMHTmRkoAR', // Irene
  es: 'SDVJaMLoJa7wc3s2sn7d', // Lydia (Aitana stuttered persistently on "están" at stability 0.5)
  fr: 'hFgOzpmS0CMtL2to8sAl', // Camille
  hi: 'MF4J4IDTRo0AxOO4dpFR', // Devi
};

interface Pair {
  text: string;
  lang: keyof typeof LANDING_VOICES;
}

// ---------------------------------------------------------------------------
// String walker — knows the messages/landing/*.json schema explicitly so a
// future schema addition fails loudly here rather than silently shipping
// no-audio strings.
// ---------------------------------------------------------------------------

interface MultiCard {
  base?: string;
  hi?: string;
  es?: string;
  fr?: string;
}

interface LandingBundle {
  reviewModes?: {
    mock?: { base?: string; hi?: string; es?: string; fr?: string };
  };
  chatDemo?: {
    grammar?: {
      card1Base?: string;
      card1Target?: string;
      card2Base?: string;
      card2Target?: string;
      multiCard1?: MultiCard;
      multiCard2?: MultiCard;
    };
    threeCards?: {
      simple?: Partial<Record<`${'card1' | 'card2' | 'card3'}${'Base' | 'Target'}`, string>>;
      multi?: Partial<Record<'card1' | 'card2' | 'card3', MultiCard>>;
    };
    curiosity?: {
      simple?: Partial<Record<`${'card1' | 'card2'}${'Base' | 'Target'}`, string>>;
      multi?: Partial<Record<'card1' | 'card2', MultiCard>>;
    };
  };
}

function pushPair(out: Pair[], text: string | undefined, lang: keyof typeof LANDING_VOICES) {
  if (!text || !text.trim()) return;
  out.push({ text, lang });
}

function pushMulti(out: Pair[], card: MultiCard, baseLang: 'en' | 'de') {
  pushPair(out, card.base, baseLang);
  pushPair(out, card.hi, 'hi');
  pushPair(out, card.es, 'es');
  pushPair(out, card.fr, 'fr');
}

function extractFromBundle(json: LandingBundle, baseLang: 'en' | 'de'): Pair[] {
  const out: Pair[] = [];

  // reviewModes.mock — single + multi target sets
  const mock = json.reviewModes?.mock;
  if (mock) {
    pushPair(out, mock.base, baseLang);
    pushPair(out, mock.hi, 'hi');
    pushPair(out, mock.es, 'es');
    pushPair(out, mock.fr, 'fr');
  }

  const chat = json.chatDemo;
  if (chat) {
    // Grammar
    pushPair(out, chat.grammar?.card1Base, baseLang);
    pushPair(out, chat.grammar?.card1Target, 'es');
    pushPair(out, chat.grammar?.card2Base, baseLang);
    pushPair(out, chat.grammar?.card2Target, 'es');
    if (chat.grammar?.multiCard1) pushMulti(out, chat.grammar.multiCard1, baseLang);
    if (chat.grammar?.multiCard2) pushMulti(out, chat.grammar.multiCard2, baseLang);

    // threeCards
    const tcSimple = chat.threeCards?.simple;
    for (const k of ['card1', 'card2', 'card3'] as const) {
      pushPair(out, tcSimple?.[`${k}Base`], baseLang);
      pushPair(out, tcSimple?.[`${k}Target`], 'es');
    }
    const tcMulti = chat.threeCards?.multi;
    for (const k of ['card1', 'card2', 'card3'] as const) {
      const card = tcMulti?.[k];
      if (card) pushMulti(out, card, baseLang);
    }

    // Curiosity
    const curSimple = chat.curiosity?.simple;
    for (const k of ['card1', 'card2'] as const) {
      pushPair(out, curSimple?.[`${k}Base`], baseLang);
      pushPair(out, curSimple?.[`${k}Target`], 'es');
    }
    const curMulti = chat.curiosity?.multi;
    for (const k of ['card1', 'card2'] as const) {
      const card = curMulti?.[k];
      if (card) pushMulti(out, card, baseLang);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// ElevenLabs synthesis (mirrors convex/features/tts.ts:111-154)
// ---------------------------------------------------------------------------

async function synthesize(text: string, voiceId: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: VOICE_SETTINGS,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

// ---------------------------------------------------------------------------
// Scribe transcription + comparison (mirrors convex/features/tts.ts:181-223
// and convex/lib/textComparison.ts — kept inline so the script has no
// runtime dependency on Convex code)
// ---------------------------------------------------------------------------

async function transcribe(buf: Buffer, languageCode: string, apiKey: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' }), 'audio.mp3');
  fd.append('model_id', 'scribe_v2');
  fd.append('tag_audio_events', 'false');
  fd.append('diarize', 'false');
  fd.append('language_code', languageCode);

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Scribe ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

function normalize(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Edit-distance threshold of 1 matches the production pipeline
// (convex/lib/textComparison.ts:53). This is strict enough to reject the
// typical flash_v2_5 failure modes:
//   - repeated words ("cómo estás" → "cómo, cómo estás" — +5 chars)
//   - dragged vowels ("estás" → "estaaaaás" — +4 chars)
//   - trailing mumbles ("están" → "están mmm ahí están" — +12 chars)
// All trigger a MISMATCH and force a retry. A 1-character difference is
// allowed because Scribe occasionally misses a diacritic or trailing punct.
const MAX_EDIT_DISTANCE = 1;

function transcriptionMatches(original: string, transcribed: string): boolean {
  const a = normalize(original);
  const b = normalize(transcribed);
  if (a === b) return true;
  return levenshtein(a, b) <= MAX_EDIT_DISTANCE;
}

const MAX_VALIDATION_ATTEMPTS = 3;

/**
 * Allowlist of (text → expected-Scribe-transcription) pairs where the audio
 * is verified-correct but Scribe consistently transcribes it differently.
 * Mostly script-mixing artifacts: e.g. Hindi speakers pronounce English
 * loanwords in Latin and Scribe transcribes the loanword in Latin script
 * even though our source text uses Devanagari.
 *
 * Each entry must have a comment explaining WHY the mismatch is acceptable.
 * Adding to this list weakens validation — be conservative.
 */
const ALLOWED_ALT_TRANSCRIPTIONS: Map<string, string> = new Map([
  // "मेनू" (menu) is a borrowed English word in Hindi; native speakers
  // pronounce it as English "menu". Both Devi and Monika voices read it
  // that way — the audio is correct, Scribe is just being literal about
  // what it heard and writing the loanword in Latin script.
  ['hi::क्या हम मेनू देख सकते हैं?', 'क्या हम menu देख सकते हैं?'],
]);

function allowlistKey(text: string, lang: string): string {
  return `${lang}::${text}`;
}

function hashFor(text: string, lang: string, voiceId: string): string {
  // Settings are part of the hash so that changing stability /
  // similarity_boost in the future invalidates every existing file and
  // forces regeneration — no risk of mixing audio from two settings.
  return createHash('sha256')
    .update(
      `${text}\n${lang}\n${voiceId}\n${MODEL_ID}\n${JSON.stringify(VOICE_SETTINGS)}`,
    )
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is required (load via --env-file=.env.local)');
    process.exit(1);
  }

  const prune = process.argv.includes('--prune');
  const revalidate = process.argv.includes('--revalidate');

  // Walk both locale bundles
  const bundles: Array<{ baseLang: 'en' | 'de'; path: string }> = [
    { baseLang: 'en', path: join(MESSAGES_DIR, 'en.json') },
    { baseLang: 'de', path: join(MESSAGES_DIR, 'de.json') },
  ];

  const all: Pair[] = [];
  for (const { baseLang, path } of bundles) {
    const json = JSON.parse(await readFile(path, 'utf8')) as LandingBundle;
    all.push(...extractFromBundle(json, baseLang));
  }

  // Dedupe by (text, lang) — identical Spanish lines reused across cards
  // collapse to one synthesis call.
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (const p of all) {
    const key = `${p.lang}::${p.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(p);
  }

  console.log(`Found ${all.length} card lines; ${pairs.length} unique after dedupe.\n`);

  // Manifest builds up as we go: lang -> text -> public URL
  const manifest: Record<string, Record<string, string>> = {};
  const referencedAbsPaths = new Set<string>();

  let generated = 0;
  let skipped = 0;
  const validationFailures: Array<{ text: string; lang: string; transcribed: string }> = [];
  let i = 0;

  for (const { text, lang } of pairs) {
    i++;
    const voiceId = LANDING_VOICES[lang];
    if (!voiceId) {
      console.error(`[skip] no voice configured for lang="${lang}"`);
      continue;
    }
    const hash = hashFor(text, lang, voiceId);
    const langDir = join(PUBLIC_AUDIO_DIR, lang);
    const absFile = join(langDir, `${hash}.mp3`);
    const publicUrl = `/audio/landing/${lang}/${hash}.mp3`;

    referencedAbsPaths.add(absFile);
    if (!manifest[lang]) manifest[lang] = {};
    manifest[lang][text] = publicUrl;

    const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    if (existsSync(absFile) && !revalidate) {
      console.log(`[skip ${i}/${pairs.length}] ${lang}  ${preview}`);
      skipped++;
      continue;
    }
    const allowedAlt = ALLOWED_ALT_TRANSCRIPTIONS.get(allowlistKey(text, lang));
    const acceptTranscription = (heard: string): boolean =>
      transcriptionMatches(text, heard) ||
      (allowedAlt !== undefined && transcriptionMatches(allowedAlt, heard));

    if (existsSync(absFile) && revalidate) {
      // Re-transcribe the existing file. If it matches, skip; if not, fall
      // through to the regenerate/retry block below.
      process.stdout.write(`[check ${i}/${pairs.length}] ${lang}  ${preview} … `);
      try {
        const buf = await readFile(absFile);
        await new Promise((r) => setTimeout(r, 80));
        const heard = await transcribe(buf, lang, apiKey);
        if (acceptTranscription(heard)) {
          console.log(allowedAlt && !transcriptionMatches(text, heard) ? 'OK (allowlisted)' : 'OK');
          skipped++;
          await new Promise((r) => setTimeout(r, 80));
          continue;
        }
        console.log(`MISMATCH — heard: "${heard}" — regenerating`);
        await rm(absFile);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`READ/SCRIBE ERROR — ${msg} — regenerating`);
        try { await rm(absFile); } catch { /* file went away on its own */ }
      }
    }

    // Generate + validate with retry. On a Scribe mismatch the most likely
    // cause is a one-off TTS hallucination (especially on flash_v2_5), so
    // re-rolling usually succeeds.
    let lastTranscribed = '';
    let validated = false;
    for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
      const tag = attempt === 1 ? `[gen  ${i}/${pairs.length}]` : `[retry ${attempt}/${MAX_VALIDATION_ATTEMPTS}]`;
      process.stdout.write(`${tag} ${lang}  ${preview} … `);
      try {
        const buf = await synthesize(text, voiceId, apiKey);
        await mkdir(langDir, { recursive: true });
        await writeFile(absFile, buf);
        process.stdout.write(`${buf.length}b  validating … `);
        // Stay polite to ElevenLabs between calls.
        await new Promise((r) => setTimeout(r, 80));
        lastTranscribed = await transcribe(buf, lang, apiKey);
        if (acceptTranscription(lastTranscribed)) {
          console.log(
            allowedAlt && !transcriptionMatches(text, lastTranscribed)
              ? 'OK (allowlisted)'
              : 'OK',
          );
          generated++;
          validated = true;
          break;
        }
        console.log(`MISMATCH — heard: "${lastTranscribed}"`);
        await new Promise((r) => setTimeout(r, 80));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`ERROR — ${msg}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!validated) {
      validationFailures.push({ text, lang, transcribed: lastTranscribed });
      process.exitCode = 1;
    }
  }

  // Write manifest with stably-sorted keys for diff-friendly PRs.
  const sortedManifest: Record<string, Record<string, string>> = {};
  for (const lang of Object.keys(manifest).sort()) {
    sortedManifest[lang] = {};
    for (const text of Object.keys(manifest[lang]).sort()) {
      sortedManifest[lang][text] = manifest[lang][text];
    }
  }
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(sortedManifest, null, 2) + '\n');

  // Orphan scan
  const orphans: string[] = [];
  if (existsSync(PUBLIC_AUDIO_DIR)) {
    for (const lang of await readdir(PUBLIC_AUDIO_DIR)) {
      const langDir = join(PUBLIC_AUDIO_DIR, lang);
      let entries: string[];
      try {
        entries = await readdir(langDir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.mp3')) continue;
        const abs = join(langDir, name);
        if (!referencedAbsPaths.has(abs)) orphans.push(abs);
      }
    }
  }

  console.log('\n----- Summary -----');
  console.log(`Generated:    ${generated}`);
  console.log(`Skipped:      ${skipped} (already on disk)`);
  console.log(`Failures:     ${validationFailures.length}`);
  console.log(`Manifest:     ${relative(REPO_ROOT, MANIFEST_PATH)} (${Object.keys(sortedManifest).length} langs)`);
  console.log(`Orphans:      ${orphans.length}`);
  if (validationFailures.length > 0) {
    console.log(`\nValidation failed for ${validationFailures.length} clip(s) after ${MAX_VALIDATION_ATTEMPTS} attempts:`);
    for (const f of validationFailures) {
      console.log(`  - [${f.lang}] expected: "${f.text}"`);
      console.log(`           heard:    "${f.transcribed}"`);
    }
    console.log('Files were kept on disk; listen to them or re-run the script to retry.');
  }
  if (orphans.length > 0) {
    for (const abs of orphans) console.log(`  - ${relative(REPO_ROOT, abs)}`);
    if (prune) {
      for (const abs of orphans) await rm(abs);
      console.log(`Pruned ${orphans.length} orphan file(s).`);
    } else {
      console.log('Re-run with --prune to delete orphans.');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
