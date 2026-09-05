/**
 * STT backend benchmark: MAI-Transcribe-2 vs Gemini 3.1 Flash Lite on the
 * app's own audio. Samples come from the dev deployment's `audioAssets`
 * (clip + the exact text it was synthesized from), so "correct" means the
 * transcript matches the stored sentence the way the TTS validator checks
 * it in production.
 *
 *   # samples.json: [{language, spokenText, url, voiceName, ttsProvider,
 *   #                 ttsQuality, hasWordTimings}], one row per stored clip.
 *   # Produced by a throwaway internal query (see "Sampling" below).
 *   pnpm eval:stt                       # every sampled language, both backends
 *   pnpm eval:stt --langs=uz,de --limit=3 --backends=gemini
 *   pnpm eval:stt --judge      # strict misses also go through the lenient judge
 *
 * Reuses the production backends verbatim (convex/lib/stt/openrouter.ts and
 * gemini.ts), the production script fix (`normalizeTranscriptScript`) and
 * the production strict comparator (`textsMatchForLanguage`), so the match
 * rate is what TTS validation would see. CER is on the equality-normalized
 * strings (case, punctuation and symbols removed) so a comma never counts.
 *
 * Sampling. No sampler is deployed (it would be dead code in production).
 * To refresh samples.json, drop this internal query into convex/admin/ for
 * the run, `npx convex run admin/sttBench:sampleAudioAssets
 * '{"perLanguage":20}' --push > .scratch/stt-bench/samples.json`, then
 * delete the file and run `npx convex codegen`:
 *
 *   export const sampleAudioAssets = internalQuery({
 *     args: { perLanguage: v.number(), languages: v.optional(v.array(v.string())) },
 *     handler: async (ctx, args) => {
 *       const languages = [...new Set((args.languages ??
 *         SUPPORTED_LANGUAGES.map((l) => l.code)).map(getAudioAssetLanguage))];
 *       const out = [];
 *       for (const language of languages) {
 *         const rows = (await ctx.db.query('audioAssets')
 *           .withIndex('by_key', (q) => q.eq('language', language))
 *           .take(args.perLanguage * 4))
 *           .filter((a) => a.ttsQuality !== 'unknown' && a.spokenText.trim());
 *         const step = Math.max(1, Math.floor(rows.length / args.perLanguage));
 *         for (let i = 0, n = 0; i < rows.length && n < args.perLanguage; i += step, n++) {
 *           const a = rows[i];
 *           const url = await ctx.storage.getUrl(a.storageId);
 *           if (url) out.push({ language, spokenText: a.spokenText, url,
 *             voiceName: a.voiceName, ttsProvider: a.ttsProvider,
 *             ttsQuality: a.ttsQuality, hasWordTimings: a.wordTimings !== undefined });
 *         }
 *       }
 *       return out;
 *     },
 *   });
 *
 * Results cache to .scratch/stt-bench/cache.json keyed by (backend, url);
 * a re-run only buys what it hasn't got. The key is read from the
 * environment by name; nothing here opens .env.local.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transcribeAudio as transcribeWithMai } from '../convex/lib/stt/openrouter';
import { transcribeAudioWithGemini } from '../convex/lib/stt/gemini';
import { normalizeTranscriptScript } from '../convex/lib/stt/scriptNormalize';
import { textsMatchForLanguage } from '../convex/lib/textComparison';
import { textsMatchSemantic } from '../convex/lib/ttsSemanticValidation';
import { normalizeForComparison } from '../lib/textCompare/normalize';
import { getSttBackend } from '../lib/languages';
import { argValue, fmtUsd, pool } from './eval/lib/bench';

type Sample = {
  language: string;
  spokenText: string;
  url: string;
  voiceName: string;
  ttsProvider?: string;
  ttsQuality?: string;
  hasWordTimings: boolean;
};

type Backend = 'mai' | 'gemini';

type Result = {
  text: string | null;
  error?: string;
  latencyMs: number;
  costUsd?: number;
  /** Strict comparator verdict (what the validation loop checks first). */
  match: boolean;
  /** Lenient judge verdict on a strict miss; undefined until `--judge` ran.
   * With `--judge` the run mirrors production: strict first, judge on a
   * miss, either verdict accepts the clip. */
  semantic?: 'match' | 'mismatch' | 'error';
  semanticCostUsd?: number;
  cer: number;
  words: number;
};

const OUT_DIR = resolve(__dirname, '../.scratch/stt-bench');
const CACHE_PATH = resolve(OUT_DIR, 'cache.json');

const BACKENDS: Record<
  Backend,
  (blob: Blob, language: string) => ReturnType<typeof transcribeWithMai>
> = {
  mai: (blob, language) => transcribeWithMai(blob, language),
  gemini: (blob, language) => transcribeAudioWithGemini(blob, language),
};

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Character error rate on equality-normalized strings, capped at 1. */
function cer(expected: string, actual: string): number {
  const e = normalizeForComparison(expected);
  const a = normalizeForComparison(actual);
  if (!e.length) return a.length ? 1 : 0;
  return Math.min(1, levenshtein(e, a) / e.length);
}

async function run(
  backend: Backend,
  sample: Sample,
  blob: Blob,
): Promise<Result> {
  const startedAt = Date.now();
  try {
    const raw = await BACKENDS[backend](blob, sample.language);
    const { text, wordTimings, costUsd } = normalizeTranscriptScript(
      raw,
      sample.language,
    );
    return {
      text,
      latencyMs: Date.now() - startedAt,
      costUsd,
      match: textsMatchForLanguage(sample.spokenText, text, sample.language),
      cer: cer(sample.spokenText, text),
      words: wordTimings.length,
    };
  } catch (err) {
    return {
      text: null,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      latencyMs: Date.now() - startedAt,
      match: false,
      cer: 1,
      words: 0,
    };
  }
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set. Run via: pnpm eval:stt');
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const samplesPath =
    argValue(argv, 'samples') ?? resolve(OUT_DIR, 'samples.json');
  const langs = argValue(argv, 'langs')?.split(',').filter(Boolean);
  const limit = Number(argValue(argv, 'limit') ?? Infinity);
  const backends = (argValue(argv, 'backends') ?? 'mai,gemini')
    .split(',')
    .filter((b): b is Backend => b === 'mai' || b === 'gemini');
  const concurrency = Number(argValue(argv, 'concurrency') ?? 4);
  const judge = argv.includes('--judge');

  const all = JSON.parse(readFileSync(samplesPath, 'utf8')) as Sample[];
  const perLang = new Map<string, Sample[]>();
  for (const s of all) {
    if (langs && !langs.includes(s.language)) continue;
    const list = perLang.get(s.language) ?? [];
    if (list.length < limit) list.push(s);
    perLang.set(s.language, list);
  }
  const samples = [...perLang.values()].flat();
  console.log(
    `${samples.length} clips over ${perLang.size} languages, backends: ${backends.join(', ')}`,
  );

  mkdirSync(OUT_DIR, { recursive: true });
  const cache: Record<string, Result> = existsSync(CACHE_PATH)
    ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
    : {};
  const save = () => writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));

  const audio = new Map<string, Blob>();
  await pool(samples, concurrency, async (s) => {
    const needed = backends.some((b) => !cache[`${b}|${s.url}`]);
    if (!needed) return;
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`fetch ${s.url}: ${res.status}`);
    audio.set(
      s.url,
      new Blob([await res.arrayBuffer()], { type: 'audio/mp3' }),
    );
  });

  let done = 0;
  const jobs = samples.flatMap((s) => backends.map((b) => ({ s, b })));
  await pool(jobs, concurrency, async ({ s, b }) => {
    const key = `${b}|${s.url}`;
    if (!cache[key]) {
      cache[key] = await run(b, s, audio.get(s.url)!);
      if (++done % 10 === 0) save();
    }
  });
  save();

  if (judge) {
    await pool(jobs, concurrency, async ({ s, b }) => {
      const r = cache[`${b}|${s.url}`];
      if (r.match || r.text === null || r.semantic !== undefined) return;
      let cost = 0;
      r.semantic = await textsMatchSemantic(
        s.spokenText,
        r.text,
        s.language,
        (t) => (cost += t.costUsd ?? 0),
      );
      r.semanticCostUsd = cost;
    });
    save();
  }
  const accepted = (r: Result) => r.match || r.semantic === 'match';

  // ------------------------------------------------------------ reporting
  const lines: string[] = [];
  const agg = (rows: { s: Sample; r: Result }[]) => {
    const ok = rows.filter((x) => x.r.text !== null);
    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
    return {
      n: rows.length,
      fails: rows.length - ok.length,
      matchPct: (100 * rows.filter((x) => accepted(x.r)).length) / rows.length,
      strictPct: (100 * rows.filter((x) => x.r.match).length) / rows.length,
      cer: mean(rows.map((x) => x.r.cer)),
      latencyMs: mean(ok.map((x) => x.r.latencyMs)),
      costUsd: ok.reduce((a, x) => a + (x.r.costUsd ?? 0), 0),
      timings: ok.filter((x) => x.r.words > 0).length,
    };
  };
  const fmt = (a: ReturnType<typeof agg>) =>
    `n=${String(a.n).padStart(3)} match=${a.matchPct.toFixed(0).padStart(3)}% (strict ${a.strictPct.toFixed(0)}%) CER=${(100 * a.cer).toFixed(1).padStart(5)}% lat=${Math.round(a.latencyMs).toString().padStart(5)}ms cost=${fmtUsd(a.costUsd)} (${fmtUsd(a.costUsd / Math.max(1, a.n - a.fails))}/clip) timings=${a.timings} fails=${a.fails}`;

  lines.push(
    `=== STT backends on ${samples.length} stored clips (${judge ? 'strict + lenient judge' : 'strict only'}) ===`,
    '',
  );
  for (const b of backends) {
    const rows = samples.map((s) => ({ s, r: cache[`${b}|${s.url}`] }));
    lines.push(`${b.padEnd(7)} ${fmt(agg(rows))}`);
  }
  lines.push('', 'Per language (match% / CER%):');
  const langRows = [...perLang.keys()].sort();
  lines.push(
    `${'lang'.padEnd(16)} routed  ${backends.map((b) => b.padEnd(16)).join('')}`,
  );
  for (const lang of langRows) {
    const cells = backends.map((b) => {
      const a = agg(
        perLang.get(lang)!.map((s) => ({ s, r: cache[`${b}|${s.url}`] })),
      );
      return `${a.matchPct.toFixed(0).padStart(3)}% / ${(100 * a.cer).toFixed(1).padStart(5)}%  `;
    });
    lines.push(
      `${lang.padEnd(16)} ${getSttBackend(lang) === 'gemini-flash-lite' ? 'gemini ' : 'mai    '} ${cells.join('')}`,
    );
  }
  lines.push('', 'Mismatches (expected → transcript):');
  for (const s of samples) {
    for (const b of backends) {
      const r = cache[`${b}|${s.url}`];
      if (accepted(r)) continue;
      lines.push(
        `  [${b}] ${s.language}: ${s.spokenText}\n      → ${r.text ?? `ERROR ${r.error}`}${r.semantic ? ` (judge: ${r.semantic})` : ''}`,
      );
    }
  }
  writeFileSync(resolve(OUT_DIR, 'report.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\nWrote ${OUT_DIR}/report.txt`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
