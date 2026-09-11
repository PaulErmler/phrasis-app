#!/usr/bin/env -S npx tsx
/**
 * Classify the speaker gender of every OGTE curriculum sentence, offline.
 *
 * One call per sentence, one word back (`male`, `female`, `neutral`), with
 * the prompt production shares (lib/speakerGenderPrompt.ts). The verdicts
 * land in `speaker_gender.csv` next to the level CSVs, and the definitive
 * ones are emitted as code (`convex/lib/speakerGenderVerdicts.ts`) so the
 * `applySpeakerGenderVerdicts` migration writes them onto `texts` on every
 * deploy; `scripts/uploadOgteV1.mjs` carries the CSV too for texts uploaded
 * later. Nothing here talks to Convex. Resumable: rows already in the
 * output are skipped, so a killed or capped run continues where it
 * stopped. An unparseable answer is not written, so a re-run retries it.
 *
 *   pnpm classify:speaker                                  scan (resumable)
 *   pnpm classify:speaker -- --limit 200                   smoke run
 *   pnpm classify:speaker -- --emit                        regenerate convex/lib/speakerGenderVerdicts.ts
 *                                                          from the CSV, no API calls
 *   pnpm classify:speaker -- --sample 150 --neutral 100    hand-check sample, no API calls
 *                                                          (gendered verdicts, then neutral ones)
 *   pnpm classify:speaker -- --compare google/gemini-3.1-flash-lite --n 500
 *                                                          second opinion, prints disagreements
 *   ... --filter 'brother|sister|wife'                     restrict --sample / --compare to
 *                                                          sentences matching the regex
 *
 * Model (Paul, 2026-09-11): 2.5 Flash Lite on the cheapest endpoint, no
 * thinking, output capped at $0.22 per million tokens, so a busy flex tier
 * falls through to standard and nothing dearer. `:floor` is the routing
 * idiom the app uses (convex/config/aiModels.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import {
  buildSpeakerGenderSystemPrompt,
  buildSpeakerGenderUserPrompt,
  parseSpeakerGenderVerdict,
  SPEAKER_GENDER_VERDICTS,
  type SpeakerGenderVerdict,
} from '../lib/speakerGenderPrompt';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(
  HERE,
  '../data_preparation/ogte-dataset/data/output',
);
const LEVELS_DIR = path.join(OUTPUT_DIR, 'levels_curated');
const DEFAULT_OUT = path.join(OUTPUT_DIR, 'speaker_gender.csv');
const VERDICTS_MODULE = path.join(
  HERE,
  '../convex/lib/speakerGenderVerdicts.ts',
);
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite:floor';
/** USD per million output tokens; just above the flex tier's $0.20. */
const MAX_COMPLETION_PRICE_PER_M = 0.22;
const DEFAULT_MAX_COST_USD = 2;
const DEFAULT_CONCURRENCY = 12;
const RETRIES = 5;

type Sentence = { id: string; text: string; level: string };
type Verdict = { verdict: SpeakerGenderVerdict; model: string };

type Args = {
  model: string;
  concurrency: number;
  limit: number | null;
  maxCost: number;
  out: string;
  sample: number | null;
  /** Neutral rows in the hand-check sample; defaults to `sample`. */
  neutral: number | null;
  seed: number;
  compare: string | null;
  n: number;
  /** Restrict --sample and --compare to sentences matching this regex. */
  filter: RegExp | null;
  emit: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    model: DEFAULT_MODEL,
    concurrency: DEFAULT_CONCURRENCY,
    limit: null,
    maxCost: DEFAULT_MAX_COST_USD,
    out: DEFAULT_OUT,
    sample: null,
    neutral: null,
    seed: 1,
    compare: null,
    n: 500,
    filter: null,
    emit: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    // `pnpm classify:speaker -- --limit 5` forwards the separator itself.
    if (a === '--') continue;
    if (a === '--model') args.model = next();
    else if (a === '--concurrency') args.concurrency = Number(next());
    else if (a === '--limit') args.limit = Number(next());
    else if (a === '--max-cost') args.maxCost = Number(next());
    else if (a === '--out') args.out = path.resolve(next());
    else if (a === '--sample') args.sample = Number(next());
    else if (a === '--neutral') args.neutral = Number(next());
    else if (a === '--seed') args.seed = Number(next());
    else if (a === '--compare') args.compare = next();
    else if (a === '--n') args.n = Number(next());
    else if (a === '--filter') args.filter = new RegExp(next(), 'i');
    else if (a === '--emit') args.emit = true;
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Corpus and verdict files
// ---------------------------------------------------------------------------

function readCorpus(): Sentence[] {
  const files = fs
    .readdirSync(LEVELS_DIR)
    .filter((f) => /^ogte_\d+.*\.csv$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No level CSVs in ${LEVELS_DIR}`);
  const seen = new Set<string>();
  const out: Sentence[] = [];
  for (const file of files) {
    const rows = parse(fs.readFileSync(path.join(LEVELS_DIR, file), 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as { id?: string; text?: string }[];
    for (const row of rows) {
      const id = (row.id ?? '').trim();
      const text = (row.text ?? '').trim();
      if (!id || !text || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, text, level: file.replace(/\.csv$/, '') });
    }
  }
  return out;
}

function readVerdicts(file: string): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  if (!fs.existsSync(file)) return map;
  const rows = parse(fs.readFileSync(file, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as { id: string; speakerGender: string; model: string }[];
  for (const row of rows) {
    const verdict = parseSpeakerGenderVerdict(row.speakerGender);
    if (verdict) map.set(row.id, { verdict, model: row.model });
  }
  return map;
}

function appendVerdict(file: string, id: string, verdict: Verdict) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, 'id,speakerGender,model\n');
  }
  fs.appendFileSync(file, `${id},${verdict.verdict},${verdict.model}\n`);
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

async function classify(
  sentence: string,
  model: string,
  apiKey: string,
): Promise<{
  verdict: SpeakerGenderVerdict | null;
  raw: string;
  costUsd: number;
}> {
  // Gemini 3.x refuses a disabled-reasoning request ("Reasoning is
  // mandatory for this endpoint"), so only 2.5 gets thinking switched off;
  // a thinking model also needs room for its hidden tokens.
  const thinkingOff = model.includes('gemini-2.5');
  const body = {
    model,
    usage: { include: true },
    ...(thinkingOff
      ? {
          reasoning: { enabled: false },
          // The cap is the scan model's; a second-opinion model prices
          // above it and would find no endpoint.
          provider: { max_price: { completion: MAX_COMPLETION_PRICE_PER_M } },
        }
      : {}),
    max_tokens: thinkingOff ? 4 : 256,
    temperature: 0,
    messages: [
      { role: 'system', content: buildSpeakerGenderSystemPrompt() },
      { role: 'user', content: buildSpeakerGenderUserPrompt(sentence) },
    ],
  };
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) =>
        setTimeout(r, 1000 * (attempt + 1) + Math.random() * 500),
      );
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { cost?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    return {
      verdict: parseSpeakerGenderVerdict(raw),
      raw,
      costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : 0,
    };
  }
  throw new Error('OpenRouter: exhausted retries (rate limit / 5xx)');
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean,
) {
  let next = 0;
  async function lane() {
    while (next < items.length && !shouldStop()) {
      const i = next++;
      await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
}

// ---------------------------------------------------------------------------
// The verdict module
// ---------------------------------------------------------------------------

/**
 * Write the definitive verdicts as code. Neutral ones are left out: the
 * resolver treats an unstamped `speakerGender` as the coin flip anyway, so
 * a migration has nothing to write for them. Sorted by id for stable
 * diffs.
 */
function emitVerdictsModule(verdicts: Map<string, Verdict>) {
  const gendered = [...verdicts]
    .filter(([, v]) => v.verdict !== 'neutral')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const models = new Map<string, number>();
  for (const [, v] of verdicts) {
    models.set(v.model, (models.get(v.model) ?? 0) + 1);
  }
  const model = [...models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  const lines = gendered.map(([id, v]) => `  '${id}': '${v.verdict}',`);
  const source = `// GENERATED by scripts/classify-speaker-gender.mts (\`pnpm classify:speaker -- --emit\`)
// from data_preparation/ogte-dataset/data/output/speaker_gender.csv. Do not edit.
//
// The curriculum sentences whose English fixes their speaker: OGTE \`id\`
// (\`texts.externalId\`) to verdict. The neutral verdicts (${verdicts.size - gendered.length}
// of ${verdicts.size}) are not listed: the resolver treats an unstamped
// \`speakerGender\` as the coin flip anyway (lib/sentenceMetadataSource.ts).
// Written onto every deployment's texts by the \`applySpeakerGenderVerdicts\`
// migration in convex/migrations.ts.

/** The model the listed verdicts came from. */
export const SPEAKER_GENDER_VERDICTS_MODEL =
  '${model}';

export const SPEAKER_GENDER_VERDICTS: Readonly<
  Record<string, 'male' | 'female'>
> = {
${lines.join('\n')}
};
`;
  fs.writeFileSync(VERDICTS_MODULE, source);
  console.log(
    `Wrote ${gendered.length} definitive verdicts to ${path.relative(process.cwd(), VERDICTS_MODULE)}`,
  );
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/** Deterministic PRNG so a sample is the same sample on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const random = rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function printSample(
  corpus: Sentence[],
  verdicts: Map<string, Verdict>,
  n: number,
  neutralN: number,
  seed: number,
  filter: RegExp | null,
) {
  const byId = new Map(corpus.map((s) => [s.id, s]));
  const matches = ([id]: [string, Verdict]) =>
    filter === null || filter.test(byId.get(id)?.text ?? '');
  const gendered = shuffle(
    [...verdicts].filter((e) => e[1].verdict !== 'neutral' && matches(e)),
    seed,
  ).slice(0, n);
  const neutral = shuffle(
    [...verdicts].filter((e) => e[1].verdict === 'neutral' && matches(e)),
    seed + 1,
  ).slice(0, neutralN);
  for (const [label, rows] of [
    ['GENDERED', gendered],
    ['NEUTRAL', neutral],
  ] as const) {
    console.log(`\n### ${label} (${rows.length})`);
    for (const [id, v] of rows) {
      console.log(
        `${id}\t${v.verdict}\t${byId.get(id)?.text ?? '(text not in corpus)'}`,
      );
    }
  }
}

async function compare(
  corpus: Sentence[],
  verdicts: Map<string, Verdict>,
  args: Args,
  apiKey: string,
) {
  const model = args.compare!;
  const byId = new Map(corpus.map((s) => [s.id, s]));
  const picked = shuffle(
    [...verdicts.keys()].filter(
      (id) =>
        args.filter === null || args.filter.test(byId.get(id)?.text ?? ''),
    ),
    args.seed,
  ).slice(0, args.n);
  const outFile = path.join(
    path.dirname(args.out),
    `speaker_gender.compare.${model.replace(/[^a-z0-9.-]+/gi, '-')}.csv`,
  );
  fs.writeFileSync(outFile, 'id,speakerGender,model\n');
  let cost = 0;
  let agree = 0;
  const disagreements: string[] = [];
  await runPool(
    picked,
    args.concurrency,
    async (id) => {
      const sentence = byId.get(id);
      if (!sentence) return;
      const result = await classify(sentence.text, model, apiKey);
      cost += result.costUsd;
      if (!result.verdict) return;
      fs.appendFileSync(outFile, `${id},${result.verdict},${model}\n`);
      const scan = verdicts.get(id)!.verdict;
      if (scan === result.verdict) agree++;
      else {
        disagreements.push(
          `${id}\tscan=${scan}\t${model}=${result.verdict}\t${sentence.text}`,
        );
      }
    },
    () => false,
  );
  console.log(`\n### DISAGREEMENTS (${disagreements.length})`);
  for (const line of disagreements) console.log(line);
  console.log(
    `\nAgreement ${agree}/${picked.length} (${((100 * agree) / picked.length).toFixed(1)}%), cost $${cost.toFixed(4)}, written to ${path.relative(process.cwd(), outFile)}`,
  );
}

async function scan(
  corpus: Sentence[],
  verdicts: Map<string, Verdict>,
  args: Args,
  apiKey: string,
) {
  const todo = corpus.filter((s) => !verdicts.has(s.id));
  const limited = args.limit !== null ? todo.slice(0, args.limit) : todo;
  console.log(
    `Corpus ${corpus.length}, done ${verdicts.size}, scanning ${limited.length} with ${args.model} (concurrency ${args.concurrency}, cap $${args.maxCost})`,
  );
  const started = Date.now();
  let cost = 0;
  let done = 0;
  let invalid = 0;
  const counts: Record<SpeakerGenderVerdict, number> = {
    male: 0,
    female: 0,
    neutral: 0,
  };
  const stop = () => cost > args.maxCost;
  await runPool(
    limited,
    args.concurrency,
    async (sentence) => {
      const result = await classify(sentence.text, args.model, apiKey);
      cost += result.costUsd;
      done++;
      if (!result.verdict) {
        invalid++;
        console.warn(
          `invalid answer for ${sentence.id}: ${JSON.stringify(result.raw)}`,
        );
        return;
      }
      counts[result.verdict]++;
      appendVerdict(args.out, sentence.id, {
        verdict: result.verdict,
        model: args.model,
      });
      if (done % 500 === 0) {
        console.log(
          `${done}/${limited.length} $${cost.toFixed(4)} ${Math.round((Date.now() - started) / 1000)}s`,
        );
      }
    },
    stop,
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `\nDone ${done} (${SPEAKER_GENDER_VERDICTS.map((v) => `${v} ${counts[v]}`).join(', ')}, invalid ${invalid}) in ${seconds}s, cost $${cost.toFixed(4)}`,
  );
  if (stop()) {
    console.error(`Stopped at the $${args.maxCost} cap; re-run to resume.`);
    process.exit(2);
  }
  if (done < todo.length) {
    console.log(`${todo.length - done} sentences left; re-run to resume.`);
    return;
  }
  emitVerdictsModule(readVerdicts(args.out));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpus = readCorpus();
  const verdicts = readVerdicts(args.out);
  if (args.dryRun) {
    console.log(buildSpeakerGenderSystemPrompt());
    console.log(
      `\n${corpus.length} sentences, ${verdicts.size} already classified`,
    );
    return;
  }
  if (args.emit) {
    emitVerdictsModule(verdicts);
    return;
  }
  if (args.sample !== null) {
    printSample(
      corpus,
      verdicts,
      args.sample,
      args.neutral ?? args.sample,
      args.seed,
      args.filter,
    );
    return;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run with: pnpm classify:speaker',
    );
    process.exit(1);
  }
  if (args.compare) {
    await compare(corpus, verdicts, args, apiKey);
    return;
  }
  await scan(corpus, verdicts, args, apiKey);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
