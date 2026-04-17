/**
 * Generate ElevenLabs audio for every flashcard line on the landing page.
 *
 * Re-run this script whenever messages/landing/{en,de}.json card content
 * changes. It walks the known schema, dedupes by (text, lang), hashes each
 * pair to a stable filename, calls ElevenLabs only for missing files, and
 * emits a manifest at lib/landing/audio-manifest.json that components look
 * up at render time.
 *
 * Usage:
 *   pnpm landing:audio          # generate missing files only
 *   pnpm landing:audio --prune  # also delete orphan mp3s no longer in manifest
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

// One deterministic voice per language so re-runs produce stable hashes and
// the demo speaks consistently. All female (matches the existing landing
// "same speaker, different language" feel).
const LANDING_VOICES: Record<string, string> = {
  en: 'aMSt68OGf4xUZAnLpTU8', // Juniper
  de: '8wPhfH9uUzEMHTmRkoAR', // Irene
  es: 'AxFLn9byyiDbMn5fmyqu', // Aitana
  fr: 'hFgOzpmS0CMtL2to8sAl', // Camille
  hi: '1qEiC6qsybMkmnNdVMbK', // Monika
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
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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

function hashFor(text: string, lang: string, voiceId: string): string {
  return createHash('sha256')
    .update(`${text}\n${lang}\n${voiceId}\n${MODEL_ID}`)
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
    if (existsSync(absFile)) {
      console.log(`[skip ${i}/${pairs.length}] ${lang}  ${preview}`);
      skipped++;
      continue;
    }

    process.stdout.write(`[gen  ${i}/${pairs.length}] ${lang}  ${preview} … `);
    try {
      const buf = await synthesize(text, voiceId, apiKey);
      await mkdir(langDir, { recursive: true });
      await writeFile(absFile, buf);
      console.log(`${buf.length} bytes`);
      generated++;
      // Stay polite to ElevenLabs (matches scripts/audit-elevenlabs-billing.ts).
      await new Promise((r) => setTimeout(r, 80));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR — ${msg}`);
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
  console.log(`Manifest:     ${relative(REPO_ROOT, MANIFEST_PATH)} (${Object.keys(sortedManifest).length} langs)`);
  console.log(`Orphans:      ${orphans.length}`);
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
