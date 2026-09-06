/**
 * Generate Gemini TTS audio for every flashcard line on the landing page.
 *
 * Re-run this script whenever messages/landing/{en,de}.json card content
 * changes. It walks the known schema, dedupes by (text, lang), hashes each
 * pair to a stable filename, calls Gemini (via OpenRouter, reusing the in-app
 * provider in convex/lib/tts/gemini.ts) only for missing files, and emits a
 * manifest at lib/landing/audio-manifest.json that components look up at
 * render time. Switching off ElevenLabs changed the hash inputs, so the first
 * run regenerates every clip — run with `--prune` to drop the old mp3s.
 *
 * Each generated mp3 is also validated round-trip: the audio is transcribed
 * with MAI-Transcribe-2 (via OpenRouter) and the transcription is compared
 * (normalized, Levenshtein ≤ 1) to the original text. On mismatch the script
 * retries up to 3 times, then surfaces the failure in the summary so a human
 * can listen.
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
import { Mp3Encoder } from '@breezystack/lamejs';
import { ttsDeliveryInstruction } from '../convex/lib/tts/deliveryInstruction';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PUBLIC_AUDIO_DIR = join(REPO_ROOT, 'public', 'audio', 'landing');
const MANIFEST_PATH = join(REPO_ROOT, 'lib', 'landing', 'audio-manifest.json');
const MESSAGES_DIR = join(REPO_ROOT, 'messages', 'landing');

// Identifies the synthesis setup in the filename hash. Bumping it (or changing a
// voice below) invalidates every existing clip and forces regeneration. This is
// distinct from the ElevenLabs model id the old hashes used, so the switch to
// Gemini regenerates all landing audio on the next run.
// `-f` suffix: the 2026-09-04 no-performing prompt (`ttsDeliveryInstruction`
// in convex/lib/tts/deliveryInstruction.ts). Bumped so the next
// `pnpm landing:audio` run regenerates every demo clip with the calmer
// delivery users hear in-app.
const TTS_MODEL_LABEL = 'gemini-3.1-flash-tts-f';

// Mirrors the in-app synthesis speed (scheduleMissingContent enqueues TTS at
// speed 1), so landing audio sounds like what users hear inside the app.
const SPEED = 1;

// One deterministic Gemini voice per language so re-runs produce stable hashes
// and the demo speaks consistently. Values are Gemini voice apiCodes (a bare
// name, or `Name@locale` to pin an accent); `GEMINI_LOCALE` below supplies the
// locale when the apiCode is bare. Gemini ships 4 production voices (2F: Leda,
// Gacrux; 2M: Achird, Iapetus); tune per language as desired.
const LANDING_VOICES: Record<string, string> = {
  en: 'Leda@en-US', // female, US accent pinned
  de: 'Gacrux', // female (de → de-DE)
  es: 'Leda', // female (es → es-ES, Castilian)
  fr: 'Gacrux', // female (fr → fr-FR)
  hi: 'Leda', // female (hi → hi-IN)
};

// Per-language Gemini BCP-47 locale (mirrors each language's `geminiBcp47` in
// lib/languages.ts) used when the voice apiCode carries no `@locale` suffix.
const GEMINI_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  hi: 'hi-IN',
};

// Language name injected into the Gemini "## Instruction" block — matches the
// in-app prompt shape in convex/lib/tts/gemini.ts so landing audio sounds like
// in-app audio.
const GEMINI_LANG_NAME: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Castilian Spanish',
  fr: 'French',
  hi: 'Hindi',
};

// Gemini 3.1 Flash TTS via OpenRouter's OpenAI-compatible speech endpoint.
// OpenRouter emits ONLY raw PCM (24 kHz / 16-bit / mono) for this model, so we
// request PCM and transcode to MP3 with lamejs below — same as the in-app
// provider (convex/lib/tts/gemini.ts). Self-contained here so the script keeps
// no runtime dependency on Convex code (which won't load under tsx/ESM).
const GEMINI_MODEL = 'google/gemini-3.1-flash-tts-preview';
const GEMINI_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const PCM_SAMPLE_RATE = 24000;
const MP3_KBPS = 48;

interface Pair {
  text: string;
  lang: keyof typeof LANDING_VOICES;
}

// ---------------------------------------------------------------------------
// String walker — knows the messages/landing/*.json schema explicitly so a
// future schema addition fails loudly here rather than silently shipping
// no-audio strings.
// ---------------------------------------------------------------------------

interface DemoCard {
  base?: string;
  es?: string;
  fr?: string;
}

/** One conversation part: either assistant prose (no audio) or a card. */
interface DemoPart {
  text?: string;
  card?: DemoCard;
}

interface DemoScenario {
  userMessage?: string;
  simple?: DemoPart[];
  multi?: DemoPart[];
}

interface LandingBundle {
  reviewModes?: {
    mock?: { base?: string; hi?: string; es?: string; fr?: string };
  };
  chatDemo?: {
    contextCard?: DemoCard;
    scenarios?: Partial<
      Record<'grammar' | 'simpler' | 'restaurant', DemoScenario>
    >;
  };
  writingCompare?: {
    // Spanish demo sentences (deliberately untranslated in every bundle).
    expected?: string;
    typed?: string;
  };
}

function pushPair(
  out: Pair[],
  text: string | undefined,
  lang: keyof typeof LANDING_VOICES,
) {
  if (!text || !text.trim()) return;
  out.push({ text, lang });
}

function pushCard(out: Pair[], card: DemoCard, baseLang: 'en' | 'de') {
  pushPair(out, card.base, baseLang);
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

  // writingCompare — the "Expected answer" card in the compare section.
  // `typed` gets no clip: it renders as the learner's answer, not a speaker.
  pushPair(out, json.writingCompare?.expected, 'es');

  const chat = json.chatDemo;
  if (chat) {
    if (chat.contextCard) pushCard(out, chat.contextCard, baseLang);
    for (const scenario of Object.values(chat.scenarios ?? {})) {
      for (const variant of ['simple', 'multi'] as const) {
        for (const part of scenario[variant] ?? []) {
          if (part.card) pushCard(out, part.card, baseLang);
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Gemini synthesis (self-contained — mirrors convex/lib/tts/gemini.ts). Requests
// PCM from OpenRouter and transcodes to MP3 with lamejs. Kept inline (rather than
// importing the Convex provider) because Convex `.ts` modules don't load cleanly
// under tsx/ESM. Reads OPENROUTER_API_KEY from the env (--env-file=.env.local).
// ---------------------------------------------------------------------------

/** Transcode raw little-endian PCM (24 kHz / 16-bit / mono — Gemini's output)
 * to MP3. Node is little-endian on x64/arm64, matching Gemini's byte order. */
function pcmToMp3(pcm: Uint8Array): Buffer {
  if (pcm.byteLength % 2 !== 0) {
    throw new Error(
      `Gemini PCM byte length must be even (16-bit samples); got ${pcm.byteLength}`,
    );
  }
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.byteLength / 2),
  );
  const encoder = new Mp3Encoder(1, PCM_SAMPLE_RATE, MP3_KBPS);
  const chunks: Buffer[] = [];
  const BLOCK = 1152; // one MP3 granule
  for (let i = 0; i < samples.length; i += BLOCK) {
    const enc = encoder.encodeBuffer(samples.subarray(i, i + BLOCK));
    if (enc.length > 0) chunks.push(Buffer.from(enc));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

/** Split a Gemini voice apiCode into the bare name + optional `@locale`. */
function parseVoiceApiCode(apiCode: string): {
  voiceName: string;
  locale?: string;
} {
  const at = apiCode.indexOf('@');
  if (at === -1) return { voiceName: apiCode };
  return { voiceName: apiCode.slice(0, at), locale: apiCode.slice(at + 1) };
}

async function synthesize(
  text: string,
  lang: string,
  voiceApiCode: string,
): Promise<Buffer> {
  const apiKey = process.env.OPENROUTER_API_KEY!;
  const { voiceName, locale } = parseVoiceApiCode(voiceApiCode);
  const languageCode = locale ?? GEMINI_LOCALE[lang] ?? lang;
  const languageName = GEMINI_LANG_NAME[lang] ?? lang;
  // Matches the in-app "## Instruction … ## Transcript …" prompt shape, with
  // the same instruction text the app sends.
  const input =
    `## Instruction: ${ttsDeliveryInstruction(languageName)}\n\n` +
    `## Transcript: ${text}`;

  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input,
      voice: voiceName,
      response_format: 'pcm',
      speed: SPEED,
      provider: { options: { google: { language_code: languageCode } } },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini TTS ${res.status}: ${body.slice(0, 300)}`);
  }
  const pcm = new Uint8Array(await res.arrayBuffer());
  // OpenRouter intermittently returns an empty 200 for this model; throwing
  // here lets the main loop's validation-retry re-roll.
  if (pcm.byteLength === 0) {
    throw new Error('No audio content returned from Gemini TTS');
  }
  return pcmToMp3(pcm);
}

// ---------------------------------------------------------------------------
// OpenRouter transcription (MAI-Transcribe-2) + comparison (mirrors
// convex/lib/stt/openrouter.ts and convex/lib/textComparison.ts — kept inline
// so the script has no runtime dependency on Convex code)
// ---------------------------------------------------------------------------

const STT_MODEL = 'microsoft/mai-transcribe-2';

async function transcribe(buf: Buffer, languageCode: string): Promise<string> {
  const fd = new FormData();
  fd.append('model', STT_MODEL);
  fd.append('response_format', 'json');
  // Bare ISO-639-1 code, which is what the landing pairs already use.
  fd.append('language', languageCode);
  fd.append(
    'file',
    new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' }),
    'audio.mp3',
  );

  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter STT ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? '';
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
// typical TTS-hallucination failure modes:
//   - repeated words ("cómo estás" → "cómo, cómo estás" — +5 chars)
//   - dragged vowels ("estás" → "estaaaaás" — +4 chars)
//   - trailing mumbles ("están" → "están mmm ahí están" — +12 chars)
// All trigger a MISMATCH and force a retry. A 1-character difference is
// allowed because the STT model occasionally misses a
// diacritic or trailing punct.
const MAX_EDIT_DISTANCE = 1;

function transcriptionMatches(original: string, transcribed: string): boolean {
  const a = normalize(original);
  const b = normalize(transcribed);
  if (a === b) return true;
  return levenshtein(a, b) <= MAX_EDIT_DISTANCE;
}

const MAX_VALIDATION_ATTEMPTS = 3;

/**
 * Allowlist of (text → expected-STT-transcription) pairs where the audio
 * is verified-correct but the STT model consistently
 * transcribes it differently. Mostly script-mixing artifacts: e.g. Hindi
 * speakers pronounce English loanwords in Latin and the STT transcribes the
 * loanword in Latin script even though our source text uses Devanagari.
 *
 * Each entry must have a comment explaining WHY the mismatch is acceptable.
 * Adding to this list weakens validation — be conservative.
 */
const ALLOWED_ALT_TRANSCRIPTIONS: Map<string, string> = new Map([
  // "मेनू" (menu) is a borrowed English word in Hindi; native speakers
  // pronounce it as English "menu". The configured Hindi Gemini voice reads it
  // that way — the audio is correct, the STT is just being literal about what
  // it heard and writing the loanword in Latin script.
  ['hi::क्या हम मेनू देख सकते हैं?', 'क्या हम menu देख सकते हैं?'],
]);

function allowlistKey(text: string, lang: string): string {
  return `${lang}::${text}`;
}

function hashFor(text: string, lang: string, voiceApiCode: string): string {
  // The model label + voice + speed are part of the hash so swapping providers
  // (ElevenLabs → Gemini) or voices invalidates every existing file and forces
  // regeneration — no risk of mixing audio from two setups.
  return createHash('sha256')
    .update(`${text}\n${lang}\n${voiceApiCode}\n${TTS_MODEL_LABEL}\n${SPEED}`)
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      'OPENROUTER_API_KEY is required for Gemini TTS and STT validation (load via --env-file=.env.local)',
    );
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

  console.log(
    `Found ${all.length} card lines; ${pairs.length} unique after dedupe.\n`,
  );

  // Manifest builds up as we go: lang -> text -> public URL
  const manifest: Record<string, Record<string, string>> = {};
  const referencedAbsPaths = new Set<string>();

  let generated = 0;
  let skipped = 0;
  const validationFailures: Array<{
    text: string;
    lang: string;
    transcribed: string;
  }> = [];
  let i = 0;

  for (const { text, lang } of pairs) {
    i++;
    const voiceApiCode = LANDING_VOICES[lang];
    if (!voiceApiCode) {
      console.error(`[skip] no voice configured for lang="${lang}"`);
      continue;
    }
    const hash = hashFor(text, lang, voiceApiCode);
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
      process.stdout.write(
        `[check ${i}/${pairs.length}] ${lang}  ${preview} … `,
      );
      try {
        const buf = await readFile(absFile);
        await new Promise((r) => setTimeout(r, 80));
        const heard = await transcribe(buf, lang);
        if (acceptTranscription(heard)) {
          console.log(
            allowedAlt && !transcriptionMatches(text, heard)
              ? 'OK (allowlisted)'
              : 'OK',
          );
          skipped++;
          await new Promise((r) => setTimeout(r, 80));
          continue;
        }
        console.log(`MISMATCH — heard: "${heard}" — regenerating`);
        await rm(absFile);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`READ/STT ERROR — ${msg} — regenerating`);
        try {
          await rm(absFile);
        } catch {
          /* file went away on its own */
        }
      }
    }

    // Generate + validate with retry. On an STT mismatch the most likely
    // cause is a one-off TTS hallucination, so re-rolling usually succeeds.
    let lastTranscribed = '';
    let validated = false;
    for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
      const tag =
        attempt === 1
          ? `[gen  ${i}/${pairs.length}]`
          : `[retry ${attempt}/${MAX_VALIDATION_ATTEMPTS}]`;
      process.stdout.write(`${tag} ${lang}  ${preview} … `);
      try {
        const buf = await synthesize(text, lang, voiceApiCode);
        await mkdir(langDir, { recursive: true });
        await writeFile(absFile, buf);
        process.stdout.write(`${buf.length}b  validating … `);
        // Stay polite to the API between calls.
        await new Promise((r) => setTimeout(r, 80));
        lastTranscribed = await transcribe(buf, lang);
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
  await writeFile(
    MANIFEST_PATH,
    JSON.stringify(sortedManifest, null, 2) + '\n',
  );

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
  console.log(
    `Manifest:     ${relative(REPO_ROOT, MANIFEST_PATH)} (${Object.keys(sortedManifest).length} langs)`,
  );
  console.log(`Orphans:      ${orphans.length}`);
  if (validationFailures.length > 0) {
    console.log(
      `\nValidation failed for ${validationFailures.length} clip(s) after ${MAX_VALIDATION_ATTEMPTS} attempts:`,
    );
    for (const f of validationFailures) {
      console.log(`  - [${f.lang}] expected: "${f.text}"`);
      console.log(`           heard:    "${f.transcribed}"`);
    }
    console.log(
      'Files were kept on disk; listen to them or re-run the script to retry.',
    );
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
