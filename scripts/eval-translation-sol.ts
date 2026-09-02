/**
 * Benchmark: can GPT-5.6 Sol beat the current production translation
 * pipeline (GPT-5.6 Luna best-of-3, no thinking)?
 *
 *   pnpm tsx --env-file=.env.local scripts/eval-translation-sol.ts --smoke
 *   pnpm tsx --env-file=.env.local scripts/eval-translation-sol.ts --limit=10 --langs=de,ru,ja,fi
 *
 * Reuses the REAL production machinery end-to-end: `buildPrompt`,
 * `translateTextWithLLM`, and `translateBestOfN` from
 * convex/features/translationLLM.ts, plus the exact `LUNA_BO3` stage from
 * lib/languages.ts as the baseline. Sol conditions are the same stage shape
 * with the model/reasoning swapped, so the comparison isolates the model
 * change and nothing else.
 *
 * Dataset: data_preparation/translation_eval/data/flores_sample.csv — the
 * 100 hard FLORES-200 devtest sentences (with per-language reference
 * translations and speaker/addressee/formality context) that drove the
 * May + Aug 2026 evals.
 *
 * Quality: one judge call per (sentence, language) — Gemini 3.1 Pro (a
 * different model family than every candidate, to avoid self-preference)
 * scores each unique candidate 0–10 against the FLORES human reference.
 *
 * Cost: real billed USD comes from OpenRouter usage accounting on every
 * call. Sol conditions are ALSO reported at the assumed $4/M-in $20/M-out
 * pricing the caller asked for. A running budget guard aborts the sweep
 * before it can pass `--budget` (default $1.80).
 *
 * Results cache to .scratch/sol-translation-bench/cache.json keyed by
 * (condition, lang, src_hash), so an aborted or re-scoped run never re-buys
 * a translation it already has.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  translateTextWithLLM,
  translateBestOfN,
  openrouterCallOptions,
  type TranslationPromptArgs,
  type LlmCallTelemetry,
  type ReasoningEffort,
} from '../convex/features/translationLLM';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';
import {
  LUNA_BO3,
  getTranslationConfigForLanguage,
  type ModelStage,
} from '../lib/languages';

// ------------------------------------------------------------------- config

const SOL = 'openai/gpt-5.6-sol';
const JUDGE_MODEL = 'google/gemini-3.1-pro-preview';
const JUDGE_REASONING: ReasoningEffort = 'low';
const JUDGE_MAX_OUTPUT_TOKENS = 4_000;

/** Assumed production pricing for Sol, per the task: $4/M in, $20/M out. */
const SOL_ASSUMED_IN_PER_TOKEN = 4 / 1e6;
const SOL_ASSUMED_OUT_PER_TOKEN = 20 / 1e6;

const OUT_DIR = resolve(__dirname, '../.scratch/sol-translation-bench');
const CACHE_PATH = resolve(OUT_DIR, 'cache.json');
const FLORES_PATH = resolve(
  __dirname,
  '../data_preparation/translation_eval/data/flores_sample.csv',
);

function solStage(
  reasoning: ReasoningEffort,
  bo3: boolean,
): ModelStage {
  return {
    model: SOL,
    reasoning,
    maxOutputTokens: 6_000,
    ...(bo3
      ? {
          samples: { total: 3, extraTemperature: 1 },
          judge: { model: SOL, reasoning, maxRetries: 2 },
        }
      : {}),
  };
}

const CONDITIONS: Record<string, ModelStage> = {
  'luna-bo3': LUNA_BO3, // current production pipeline, verbatim
  'sol-minimal': solStage('minimal', false),
  'sol-low': solStage('low', false),
  'sol-medium': solStage('medium', false),
  'sol-minimal-bo3': solStage('minimal', true),
  'sol-low-bo3': solStage('low', true),
};

// --------------------------------------------------------------------- args

type Args = {
  langs: string[];
  limit: number;
  budget: number;
  concurrency: number;
  conditions: string[];
  smoke: boolean;
  judgeOnly: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) =>
    argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  const smoke = argv.includes('--smoke');
  return {
    langs: (get('langs') ?? (smoke ? 'de' : 'de,ru,ja,fi'))
      .split(',')
      .filter(Boolean),
    limit: Number(get('limit') ?? (smoke ? 2 : 10)),
    budget: Number(get('budget') ?? 1.8),
    concurrency: Number(get('concurrency') ?? 4),
    conditions: (get('conditions') ?? Object.keys(CONDITIONS).join(','))
      .split(',')
      .filter(Boolean),
    smoke,
    judgeOnly: argv.includes('--judge-only'),
  };
}

// ------------------------------------------------------------------ dataset

type FloresRow = {
  src_hash: string;
  src: string;
  speaker_gender: string;
  addressee_gender: string;
  formality: string;
  [refCol: string]: string;
};

function loadRows(limit: number): FloresRow[] {
  const raw = readFileSync(FLORES_PATH, 'utf8');
  const rows = parse(raw, { columns: true }) as FloresRow[];
  return rows.slice(0, limit);
}

/** Deterministic referent gender from src_hash, mirroring the prod fallback. */
function referentGenderFor(hash: string): 'male' | 'female' {
  let h = 0;
  for (const ch of hash) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? 'male' : 'female';
}

function promptArgsFor(row: FloresRow, lang: string): TranslationPromptArgs {
  const cfg = getTranslationConfigForLanguage(lang);
  const formality =
    row.formality === 'formal' ||
    row.formality === 'informal' ||
    row.formality === 'neutral'
      ? row.formality
      : undefined;
  const addresseeGender =
    row.addressee_gender === 'male' || row.addressee_gender === 'female'
      ? row.addressee_gender
      : undefined;
  return {
    text: row.src,
    sourceLang: 'en',
    targetLang: lang,
    targetLangName: cfg.targetLangName,
    targetLangNativeName: cfg.targetLangNativeName,
    targetRegion: cfg.targetRegion,
    // FLORES rows carry addressee/formality context (assigned for the May
    // 2026 eval); treat a row as addressing someone when a register exists,
    // same trigger the prior harness used.
    addressesSomeone: formality !== undefined,
    speakerGender:
      row.speaker_gender === 'male' ||
      row.speaker_gender === 'female' ||
      row.speaker_gender === 'neutral'
        ? row.speaker_gender
        : undefined,
    addresseeGender,
    formality,
    referentGender: referentGenderFor(row.src_hash),
  };
}

// -------------------------------------------------------------------- cache

type CallRecord = {
  text: string | null; // null = the stage failed
  failReason?: string;
  telemetry: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
    latencyMs: number;
    role?: string;
  }[];
};

type Cache = Record<string, CallRecord>; // `${condition}|${lang}|${src_hash}`

function loadCache(): Cache {
  if (!existsSync(CACHE_PATH)) return {};
  return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Cache;
}

let cache: Cache = {};
function saveCache() {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
}

// ------------------------------------------------------------- budget guard

let spentUsd = 0;
let budgetUsd = 1.8;
function recordSpend(telemetry: { costUsd?: number }[]) {
  for (const t of telemetry) spentUsd += t.costUsd ?? 0;
  if (spentUsd > budgetUsd) {
    saveCache();
    console.error(
      `\nBUDGET GUARD: spent $${spentUsd.toFixed(3)} > $${budgetUsd}. ` +
        `Cache saved; re-run with a smaller --limit/--langs or raise --budget.`,
    );
    process.exit(2);
  }
}

// ------------------------------------------------------------- translation

function slimTelemetry(
  list: (LlmCallTelemetry & { role?: string })[],
): CallRecord['telemetry'] {
  return list.map((t) => ({
    model: t.model,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    costUsd: t.costUsd,
    latencyMs: t.latencyMs,
    role: t.role,
  }));
}

async function runOne(
  condition: string,
  stage: ModelStage,
  row: FloresRow,
  lang: string,
): Promise<CallRecord> {
  const key = `${condition}|${lang}|${row.src_hash}`;
  if (cache[key]) return cache[key];
  const args = promptArgsFor(row, lang);

  let record: CallRecord;
  if (stage.samples) {
    const res = await translateBestOfN({ ...args, stage });
    record = {
      text: res.result.ok ? res.result.text : null,
      ...(res.result.ok ? {} : { failReason: res.result.reason }),
      telemetry: slimTelemetry(res.telemetryList),
    };
  } else {
    const res = await translateTextWithLLM({
      ...args,
      model: stage.model,
      reasoning: stage.reasoning,
      maxOutputTokens: stage.maxOutputTokens,
      provider: stage.provider,
    });
    record = {
      text: res.ok ? res.text : null,
      ...(res.ok ? {} : { failReason: res.reason }),
      telemetry: res.telemetry ? slimTelemetry([res.telemetry]) : [],
    };
  }
  cache[key] = record;
  recordSpend(record.telemetry);
  return record;
}

async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
) {
  let i = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

// ------------------------------------------------------------------- judge

/** Seeded shuffle (same scheme as translationLLM's) so reruns re-judge identically. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const next = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildScoringPrompt(
  args: TranslationPromptArgs,
  reference: string,
  candidates: string[],
): string {
  const ctx: string[] = [
    `  <speaker_gender>${args.speakerGender ?? 'unspecified'}</speaker_gender>`,
    `  <referent_gender>${args.referentGender}</referent_gender>`,
  ];
  if (args.addressesSomeone) {
    ctx.push(
      `  <addressee_gender>${args.addresseeGender ?? 'unspecified'}</addressee_gender>`,
      `  <register>${args.formality ?? 'neutral'}</register>`,
    );
  }
  return [
    `You are a professional English-to-${args.targetLangName} translation evaluator. Score each candidate ${args.targetLangName} translation of the English source on a 0-10 scale.`,
    ``,
    `<context>`,
    ...ctx,
    `</context>`,
    ``,
    `<source>${args.text}</source>`,
    ``,
    `<human_reference>${reference}</human_reference>`,
    ``,
    `<candidates>`,
    ...candidates.map((c, i) => `  <candidate id="${i + 1}">${c}</candidate>`),
    `</candidates>`,
    ``,
    `<instructions>`,
    `Score each candidate independently on: (1) accuracy and completeness of meaning versus the source, (2) natural, idiomatic ${args.targetLangName} as used in ${args.targetRegion} today, (3) adherence to the context constraints (grammatical agreement with the given genders; 'informal'/'neutral' register means the casual T-form, only 'formal' means the polite V-form). The human reference shows one correct rendering; a candidate may legitimately differ from it and still score 10 if accurate and natural. 10 = publication quality, 8-9 = minor style issues, 6-7 = noticeable awkwardness or a small inaccuracy, 4-5 = a clear error in meaning/grammar/register, 0-3 = major mistranslation.`,
    `</instructions>`,
    ``,
    `Output ONLY a JSON array, one integer score per candidate in id order, e.g. [7,9,4]. No commentary.`,
  ].join('\n');
}

type JudgeOutcome = {
  scores: Record<string, number>; // candidate text -> score
  telemetry: CallRecord['telemetry'];
};

async function judgeSentence(
  openrouter: ReturnType<typeof createOpenRouter>,
  args: TranslationPromptArgs,
  reference: string,
  uniqueCandidates: string[],
  seed: string,
): Promise<JudgeOutcome | null> {
  const shuffled = seededShuffle(uniqueCandidates, seed);
  const prompt = buildScoringPrompt(args, reference, shuffled);
  const providerOptions = openrouterCallOptions(JUDGE_REASONING);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await generateText({
        model: openrouter(JUDGE_MODEL),
        prompt,
        temperature: 0,
        maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
        ...(providerOptions ? { providerOptions } : {}),
      });
      const telemetry = [
        {
          model: JUDGE_MODEL,
          inputTokens: res.usage.inputTokens ?? 0,
          outputTokens: res.usage.outputTokens ?? 0,
          costUsd: openrouterCostUsd(res.providerMetadata),
          latencyMs: Date.now() - startedAt,
          role: 'quality-judge',
          generationId: openrouterGenerationId(res.providerMetadata),
        },
      ];
      recordSpend(telemetry);
      const match = res.text.match(/\[[\s\d,.]*\]/);
      if (!match) throw new Error(`unparseable: ${res.text.slice(0, 80)}`);
      const parsed = JSON.parse(match[0]) as number[];
      if (parsed.length !== shuffled.length) {
        throw new Error(
          `expected ${shuffled.length} scores, got ${parsed.length}`,
        );
      }
      const scores: Record<string, number> = {};
      shuffled.forEach((text, i) => (scores[text] = parsed[i]));
      return { scores, telemetry };
    } catch (err) {
      console.warn(
        `  judge attempt ${attempt} failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
      );
    }
  }
  return null;
}

// ----------------------------------------------------------------- reporting

type ConditionAgg = {
  n: number;
  fails: number;
  scoreSum: number;
  scored: number;
  wins: number;
  ties: number;
  losses: number;
  inputTokens: number;
  outputTokens: number;
  realCostUsd: number;
  perLang: Record<string, { scoreSum: number; scored: number }>;
};

function fmtUsd(x: number): string {
  return `$${x.toFixed(4)}`;
}

// --------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  budgetUsd = args.budget;
  cache = loadCache();

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run via: pnpm tsx --env-file=.env.local scripts/eval-translation-sol.ts',
    );
    process.exit(1);
  }
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    extraBody: { usage: { include: true } },
  });

  const rows = loadRows(args.limit);
  const conditionNames = args.conditions.filter((c) => c in CONDITIONS);
  console.log(
    `Benchmark: ${rows.length} sentences x ${args.langs.join(',')} x [${conditionNames.join(', ')}], budget $${budgetUsd}`,
  );

  // ── Translation sweep ────────────────────────────────────────────────────
  if (!args.judgeOnly) {
    const work: { condition: string; row: FloresRow; lang: string }[] = [];
    for (const condition of conditionNames) {
      for (const lang of args.langs) {
        for (const row of rows) work.push({ condition, row, lang });
      }
    }
    let done = 0;
    await pool(work, args.concurrency, async ({ condition, row, lang }) => {
      await runOne(condition, CONDITIONS[condition], row, lang);
      done++;
      if (done % 20 === 0 || done === work.length) {
        saveCache();
        console.log(
          `  translated ${done}/${work.length}  (spent ${fmtUsd(spentUsd)})`,
        );
      }
    });
    saveCache();
  }

  // ── Judging ──────────────────────────────────────────────────────────────
  const judgeCacheKey = (lang: string, hash: string) =>
    `judge|${lang}|${hash}`;
  type JudgeRecord = { scores: Record<string, number>; telemetry: CallRecord['telemetry'] };
  const judgeWork: { row: FloresRow; lang: string }[] = [];
  for (const lang of args.langs)
    for (const row of rows) judgeWork.push({ row, lang });

  await pool(judgeWork, args.concurrency, async ({ row, lang }) => {
    const jk = judgeCacheKey(lang, row.src_hash);
    const texts = new Set<string>();
    for (const condition of conditionNames) {
      const rec = cache[`${condition}|${lang}|${row.src_hash}`];
      if (rec?.text) texts.add(rec.text);
    }
    if (texts.size === 0) return;
    // Re-judge only when a candidate is missing from the cached verdict (a
    // new condition produced a translation the judge has never scored).
    if (cache[jk]) {
      const cached = JSON.parse(cache[jk].text ?? '{}') as Record<
        string,
        number
      >;
      if ([...texts].every((t) => cached[t] !== undefined)) return;
    }
    const reference = row[`ref_${lang}`];
    if (!reference) {
      console.warn(`  no FLORES reference for ${lang}, skipping judge`);
      return;
    }
    const outcome = await judgeSentence(
      openrouter,
      promptArgsFor(row, lang),
      reference,
      [...texts],
      `${lang}:${row.src_hash}`,
    );
    if (outcome) {
      cache[jk] = {
        text: JSON.stringify(outcome.scores),
        telemetry: outcome.telemetry,
      } as CallRecord;
      saveCache();
    }
  });
  saveCache();

  // ── Aggregate ────────────────────────────────────────────────────────────
  const aggs: Record<string, ConditionAgg> = {};
  for (const c of conditionNames) {
    aggs[c] = {
      n: 0,
      fails: 0,
      scoreSum: 0,
      scored: 0,
      wins: 0,
      ties: 0,
      losses: 0,
      inputTokens: 0,
      outputTokens: 0,
      realCostUsd: 0,
      perLang: {},
    };
  }
  let judgeCost = 0;

  for (const lang of args.langs) {
    for (const row of rows) {
      const jk = judgeCacheKey(lang, row.src_hash);
      const judgeRec = cache[jk] as JudgeRecord | undefined;
      const scores: Record<string, number> = judgeRec
        ? JSON.parse((judgeRec as unknown as CallRecord).text ?? '{}')
        : {};
      if (judgeRec) {
        for (const t of (judgeRec as unknown as CallRecord).telemetry) {
          judgeCost += t.costUsd ?? 0;
        }
      }
      const baselineRec = cache[`luna-bo3|${lang}|${row.src_hash}`];
      const baselineScore = baselineRec?.text
        ? scores[baselineRec.text]
        : undefined;

      for (const condition of conditionNames) {
        const rec = cache[`${condition}|${lang}|${row.src_hash}`];
        if (!rec) continue;
        const agg = aggs[condition];
        agg.n++;
        if (!rec.text) agg.fails++;
        for (const t of rec.telemetry) {
          agg.inputTokens += t.inputTokens;
          agg.outputTokens += t.outputTokens;
          agg.realCostUsd += t.costUsd ?? 0;
        }
        const score = rec.text ? scores[rec.text] : undefined;
        if (score !== undefined) {
          agg.scoreSum += score;
          agg.scored++;
          agg.perLang[lang] ??= { scoreSum: 0, scored: 0 };
          agg.perLang[lang].scoreSum += score;
          agg.perLang[lang].scored++;
          if (condition !== 'luna-bo3' && baselineScore !== undefined) {
            if (score > baselineScore) agg.wins++;
            else if (score < baselineScore) agg.losses++;
            else agg.ties++;
          }
        }
      }
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const lines: string[] = [];
  const p = (s: string) => {
    lines.push(s);
    console.log(s);
  };
  p(`\n=== Results (${rows.length} sentences x ${args.langs.join(',')}) ===\n`);
  p(
    `condition        | mean score | vs baseline (W/T/L) | fails | real cost | cost/sentence | assumed $4/$20 cost/sentence`,
  );
  p(`-`.repeat(120));
  for (const condition of conditionNames) {
    const a = aggs[condition];
    const mean = a.scored ? (a.scoreSum / a.scored).toFixed(2) : 'n/a';
    const perSentReal = a.n ? a.realCostUsd / a.n : 0;
    const isSol = condition.startsWith('sol');
    const assumedTotal = isSol
      ? a.inputTokens * SOL_ASSUMED_IN_PER_TOKEN +
        a.outputTokens * SOL_ASSUMED_OUT_PER_TOKEN
      : a.realCostUsd;
    const perSentAssumed = a.n ? assumedTotal / a.n : 0;
    const wtl =
      condition === 'luna-bo3'
        ? '(baseline)'
        : `${a.wins}/${a.ties}/${a.losses}`;
    p(
      `${condition.padEnd(16)} | ${String(mean).padStart(10)} | ${wtl.padStart(19)} | ${String(a.fails).padStart(5)} | ${fmtUsd(a.realCostUsd).padStart(9)} | ${fmtUsd(perSentReal).padStart(13)} | ${fmtUsd(perSentAssumed).padStart(12)}`,
    );
  }
  p(`\nPer-language mean scores:`);
  for (const condition of conditionNames) {
    const a = aggs[condition];
    const parts = args.langs.map((l) => {
      const pl = a.perLang[l];
      return `${l}=${pl?.scored ? (pl.scoreSum / pl.scored).toFixed(2) : 'n/a'}`;
    });
    p(`  ${condition.padEnd(16)} ${parts.join('  ')}`);
  }
  p(`\nJudge cost: ${fmtUsd(judgeCost)}   Total spent this+cached runs: ${fmtUsd(spentUsd)}`);
  p(
    `Token totals per condition (in/out incl. reasoning + bo3 judges): ` +
      conditionNames
        .map((c) => `${c}=${aggs[c].inputTokens}/${aggs[c].outputTokens}`)
        .join('  '),
  );

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, 'report.txt'),
    lines.join('\n') + '\n',
  );
  writeFileSync(
    resolve(OUT_DIR, 'aggregates.json'),
    JSON.stringify({ args, aggs, judgeCost, spentUsd }, null, 2),
  );
  console.log(`\nWrote ${OUT_DIR}/report.txt and aggregates.json`);
}

main().catch((err) => {
  saveCache();
  console.error(err);
  process.exit(1);
});
