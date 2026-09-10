/**
 * Does a quality-control pass improve production translations?
 *
 *   pnpm eval:qc                                   # 100 FLORES devtest sentences
 *   pnpm eval:qc --dataset=catalogue               # 100 short curriculum sentences
 *   pnpm eval:qc --dataset=catalogue --max-chars=60 --n=100 --seed=b
 *   pnpm eval:qc --print-prompts
 *
 * Two passes, both on the production stage (`SOL_MINIMAL`, no thinking):
 *
 *   pass 1  the production translation, `buildPrompt` verbatim through
 *           `translateTextWithLLM` — exactly what the app does today.
 *   pass 2  a quality-control pass over pass 1's output. It carries the SAME
 *           `<context>` block (speaker/referent/addressee gender, register)
 *           and the SAME gender-and-politeness instructions the translation
 *           got (`PROMPT_B_INSTRUCTIONS`, plus `requestedFormInstruction`
 *           when a form is requested), so the reviewer is held to the
 *           constraints the translator was held to. On top of that, one
 *           instruction: return the sentence, or make it accurate and as
 *           natural as possible.
 *
 * Two datasets, both seeded-shuffled:
 *
 *   flores     FLORES-200 devtest (`eng_Latn` → `deu_Latn`), downloaded once
 *              to .scratch/flores/. Wikipedia-register prose with HUMAN
 *              reference translations, so COMET can score both passes
 *              against a reference. No speaker/register metadata: the
 *              context fields are inferred from the English.
 *   catalogue  The app's own curriculum
 *              (data_preparation/data/output/sentences_translated.csv),
 *              filtered to short sentences. Carries the REAL metadata the
 *              production prompt consumes — register, addressee number and
 *              gender, speaker gender — mapped the same way
 *              `resolvePromptMetadata` maps it in
 *              convex/features/llmTranslationQueue.ts. No human reference
 *              exists for it, so COMET cannot be computed; the blind human
 *              rating is the quality signal. (The CSV's own `de` column is
 *              pipeline output, not a reference — scoring against it would
 *              reward resembling the previous translation.)
 *
 * Scoring is a separate step, so this script never needs Python:
 *   pnpm eval:flores-qc && .scratch/flores-qc/score.sh
 * writes COMET (Unbabel/wmt22-comet-da) and chrF++ back into results.json.
 *
 * The human read is what decides it: `scripts/build-flores-artifact.py` turns
 * results.json into a blind A/B rating page, where the two passes are shuffled
 * per sentence and the metrics stay hidden until a sentence is rated.
 *
 * Cost: real billed USD from OpenRouter usage accounting, budget guard at
 * $1.00 by default. Everything caches to .scratch/flores-qc/cache.json keyed
 * by (pass, sentence hash), so a re-run never re-buys.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { resolve } from 'node:path';
import { generateText } from 'ai';
import {
  ACCENT_REWRITE_STAGES,
  SOL_MINIMAL,
  getTranslationConfigForLanguage,
  type ModelStage,
} from '../lib/languages';
import {
  buildContextLines,
  buildPrompt,
  normalizeModelOutput,
  openrouterCallOptions,
  requestedFormInstruction,
  PROMPT_B_INSTRUCTIONS,
  type TranslationPromptArgs,
} from '../convex/features/translationLLM';
import { openrouterCostUsd, openrouterGenerationId } from '../convex/lib/posthogAi';
import {
  argValue,
  Bench,
  createOpenRouterFromEnv,
  fmtUsd,
  pool,
  seededShuffle,
  type CallTelemetry,
  type OpenRouterClient,
} from './eval/lib/bench';

// ------------------------------------------------------------------- config

const FLORES_DIR = resolve(process.cwd(), '.scratch/flores/flores200_dataset/devtest');
const SRC_FILE = resolve(FLORES_DIR, 'eng_Latn.devtest');
const REF_FILE = resolve(FLORES_DIR, 'deu_Latn.devtest');
const CATALOGUE_CSV = resolve(
  process.cwd(),
  'data_preparation/data/output/sentences_translated.csv',
);

type Dataset = 'flores' | 'catalogue';
const outDirFor = (d: Dataset) => resolve(process.cwd(), `.scratch/translation-qc/${d}`);

/** Longest source sentence admitted by `--dataset=catalogue`. */
const DEFAULT_MAX_CHARS = 60;

const RUN_HINT = 'pnpm eval:qc';
const TARGET = 'de';
const DEFAULT_N = 100;
const DEFAULT_SEED = 'flores-1';
const DEFAULT_BUDGET_USD = 1.0;
const CONCURRENCY = 6;

/** The production stage every language translates on (`sol_minimal`). Pass 1
 *  is always this, so switching the QC model reuses the cached translations. */
const STAGE: ModelStage = SOL_MINIMAL;

/**
 * Which model runs the quality pass. `sol` is the translator reviewing
 * itself; `luna` is the production single-call rewrite stage
 * (`ACCENT_REWRITE_STAGES[0]`, no thinking, 1k output cap) — the model the
 * app already trusts with "return this sentence or a better one", at a
 * fraction of Sol's price. Verbatim, so what is measured is the stage as it
 * would ship.
 */
const QC_STAGES: Record<string, ModelStage> = {
  sol: SOL_MINIMAL,
  luna: ACCENT_REWRITE_STAGES[0],
  // A third family, so the reviewer is not the translator's sibling. Same
  // model the sentence-form benches judge with (`FLASH_JUDGE_MODEL`).
  gemini: {
    model: 'google/gemini-3.8-flash',
    reasoning: 'minimal',
    maxOutputTokens: 1_000,
  },
};

// ------------------------------------------------------------------ dataset

type CatalogueMeta = {
  register: string;
  addresseeNumber: string;
  speakerGender: string;
  addresseeGender: string;
};

type Item = {
  id: string;
  source: string;
  /** FLORES only: the human reference. Absent for the catalogue. */
  reference?: string;
  /** Catalogue only: the row's real production metadata. */
  meta?: CatalogueMeta;
};

function contentHash(text: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function loadFlores(n: number, seed: string): Item[] {
  if (!existsSync(SRC_FILE)) {
    console.error(
      `FLORES devtest not found at ${FLORES_DIR}.\n` +
        `Fetch it once:\n` +
        `  mkdir -p .scratch/flores && curl -o .scratch/flores/flores200.tar.gz \\\n` +
        `    https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz \\\n` +
        `    && tar xzf .scratch/flores/flores200.tar.gz -C .scratch/flores`,
    );
    process.exit(1);
  }
  const src = readFileSync(SRC_FILE, 'utf8').split('\n').filter(Boolean);
  const ref = readFileSync(REF_FILE, 'utf8').split('\n').filter(Boolean);
  const all: Item[] = src.map((source, i) => ({
    id: String(i),
    source,
    reference: ref[i],
  }));
  return seededShuffle(all, seed).slice(0, n);
}

/**
 * Short curriculum sentences with the metadata the production prompt reads.
 * `text_en` is the English source; the CSV's per-language columns are the
 * previous pipeline output and are deliberately ignored.
 */
function loadCatalogue(n: number, seed: string, maxChars: number): Item[] {
  if (!existsSync(CATALOGUE_CSV)) {
    console.error(`Catalogue CSV not found at ${CATALOGUE_CSV}`);
    process.exit(1);
  }
  const rows = parse(readFileSync(CATALOGUE_CSV, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
  const all: Item[] = rows
    .map((r) => ({
      id: r.id,
      source: (r.text_en || r.text || '').trim(),
      meta: {
        register: r.register,
        addresseeNumber: r.addressee_number,
        speakerGender: r.speaker_gender,
        addresseeGender: r.addressee_gender,
      },
    }))
    .filter((it) => it.source.length > 0 && it.source.length <= maxChars);
  return seededShuffle(all, seed).slice(0, n);
}

function loadItems(
  dataset: Dataset,
  n: number,
  seed: string,
  maxChars: number,
): Item[] {
  return dataset === 'flores'
    ? loadFlores(n, seed)
    : loadCatalogue(n, seed, maxChars);
}

/**
 * Stable male/female pick, mirroring `legacyReferentGenderFallback` in
 * convex/features/llmTranslationQueue.ts (FNV-1a over `referent|<id>`), so a
 * catalogue row lands on the gender production would have given it.
 */
function referentGenderFor(id: string): 'male' | 'female' {
  const str = `referent|${id}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 1) === 0 ? 'male' : 'female';
}

/**
 * The prompt payload. A catalogue row supplies the real metadata, mapped the
 * way `resolvePromptMetadata` maps it in the worker: `addressesSomeone` is
 * (addressee_number !== 'not_applicable'), an addressee gender only counts
 * when it is male or female, and `referentGender` is the stable coin flip.
 * FLORES has no metadata, so those two fields are inferred from the English;
 * both passes see the same values either way.
 */
function promptArgsFor(item: Item): TranslationPromptArgs {
  const cfg = getTranslationConfigForLanguage(TARGET);
  const base = {
    text: item.source,
    sourceLang: 'en',
    targetLang: TARGET,
    targetLangName: cfg.targetLangName,
    targetLangNativeName: cfg.targetLangNativeName,
    targetRegion: cfg.targetRegion,
  };
  if (!item.meta) {
    return {
      ...base,
      addressesSomeone: /\byou(r|rs|rself)?\b/iu.test(item.source),
      referentGender: /\b(she|her|hers|herself)\b/iu.test(item.source)
        ? 'female'
        : 'male',
      formality: 'neutral',
    };
  }
  const m = item.meta;
  const gender = (v: string): 'male' | 'female' | undefined =>
    v === 'male' || v === 'female' ? v : undefined;
  return {
    ...base,
    addressesSomeone: m.addresseeNumber !== 'not_applicable',
    referentGender: referentGenderFor(item.id),
    speakerGender:
      m.speakerGender === 'male' ||
      m.speakerGender === 'female' ||
      m.speakerGender === 'neutral'
        ? m.speakerGender
        : undefined,
    addresseeGender: gender(m.addresseeGender),
    formality:
      m.register === 'formal' || m.register === 'informal' || m.register === 'neutral'
        ? m.register
        : 'neutral',
  };
}

// ---------------------------------------------------------------- qc prompt

/**
 * The quality-control prompt. Everything above `<instructions>` is the
 * production translation prompt's own framing: the same language name, the
 * same `<context>` block from `buildContextLines`, and the same
 * gender-and-register rules in `PROMPT_B_INSTRUCTIONS`. Only the task
 * changes — review instead of translate — so a reviewer that rewrites the
 * register or drops a gender agreement is breaking the same rules the
 * translator was given, not rules invented here.
 */
function buildQcPrompt(args: TranslationPromptArgs, candidate: string): string {
  const fullName =
    args.targetLangNativeName && args.targetLangNativeName !== args.targetLangName
      ? `${args.targetLangName} (${args.targetLangNativeName})`
      : args.targetLangName;
  return [
    `You are a professional English-to-${fullName} translator reviewing a translation for a language-learning app, suitable for ${args.targetRegion}. A learner will see the ${args.targetLangName} sentence next to the English and learn it as the way to say the English.`,
    ``,
    `<context>`,
    ...buildContextLines(args),
    `</context>`,
    ``,
    `<source>${args.text}</source>`,
    `<translation>${candidate}</translation>`,
    ``,
    `<instructions>`,
    PROMPT_B_INSTRUCTIONS,
    ...requestedFormInstruction(args),
    `Quality check the translation above: make sure it is accurate and natural. Return it as it is, or, if you can improve it, make it sound as natural as possible — the phrasing a native speaker would actually use, not a ${args.targetLangName}-coloured rendering of the English. It must still mean the same as the English, keep the same speech act, and stay usable in the same range of situations. Do not change what is already right.`,
    `</instructions>`,
    ``,
    `Output only the ${fullName} translation. No commentary, no explanations, no tags, no quotation marks, no alternative renderings.`,
  ].join('\n');
}

/** One QC call on the production stage, cached and budgeted. */
async function qcCached(
  bench: Bench,
  openrouter: OpenRouterClient,
  key: string,
  prompt: string,
  stage: ModelStage,
): Promise<string | null> {
  const hit = bench.cache[key];
  if (hit) return hit.text;
  const startedAt = Date.now();
  const providerOptions = openrouterCallOptions(stage.reasoning, stage.provider);
  try {
    const res = await generateText({
      model: openrouter(stage.model),
      prompt,
      temperature: 0,
      maxOutputTokens: stage.maxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const telemetry: CallTelemetry[] = [
      {
        model: stage.model,
        inputTokens: res.usage.inputTokens ?? 0,
        outputTokens: res.usage.outputTokens ?? 0,
        costUsd: openrouterCostUsd(res.providerMetadata),
        latencyMs: Date.now() - startedAt,
        role: 'quality-control',
        generationId: openrouterGenerationId(res.providerMetadata),
      },
    ];
    bench.recordSpend(telemetry);
    const text = normalizeModelOutput(TARGET, res.text);
    bench.cache[key] = { text, telemetry };
    return text;
  } catch (err) {
    console.warn(`  qc failed: ${err instanceof Error ? err.message.slice(0, 140) : err}`);
    return null;
  }
}

// --------------------------------------------------------------------- main

type Row = {
  id: string;
  source: string;
  reference?: string;
  /**
   * The `<context>` block both passes were given, verbatim from
   * `buildContextLines` — the gender and register the model was actually
   * held to, not a re-derivation. Surfaced per sentence in the rating page.
   */
  context: string[];
  pass1: string | null;
  pass2: string | null;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const n = Number(argValue(argv, 'n') ?? DEFAULT_N);
  const seed = argValue(argv, 'seed') ?? DEFAULT_SEED;
  const budgetUsd = Number(argValue(argv, 'budget') ?? DEFAULT_BUDGET_USD);
  const maxChars = Number(argValue(argv, 'max-chars') ?? DEFAULT_MAX_CHARS);
  const dataset = (argValue(argv, 'dataset') ?? 'flores') as Dataset;
  const qcModel = argValue(argv, 'qc-model') ?? 'sol';
  const qcStage = QC_STAGES[qcModel];
  if (!qcStage) {
    console.error(`--qc-model must be one of ${Object.keys(QC_STAGES).join(', ')}`);
    process.exit(1);
  }
  const suffix = qcModel === 'sol' ? '' : `-${qcModel}`;
  if (dataset !== 'flores' && dataset !== 'catalogue') {
    console.error(`--dataset must be "flores" or "catalogue", got "${dataset}"`);
    process.exit(1);
  }
  const outDir = outDirFor(dataset);

  if (argv.includes('--print-prompts')) {
    const item = loadItems(dataset, 1, seed, maxChars)[0];
    const args = promptArgsFor(item);
    console.log('=== PASS 1 — production translation ===\n');
    console.log(buildPrompt(args));
    console.log('\n\n=== PASS 2 — quality control ===\n');
    console.log(buildQcPrompt(args, '<the pass 1 output>'));
    console.log(
      `\n\n(both: ${STAGE.model}, reasoning ${STAGE.reasoning}, temperature 0)`,
    );
    return;
  }

  const bench = new Bench({
    outDir,
    budgetUsd,
      budgetHint: `re-run ${RUN_HINT} to continue from the cache, or raise --budget`,
  });
  const openrouter = createOpenRouterFromEnv(RUN_HINT);
  const items = loadItems(dataset, n, seed, maxChars);
  console.log(
    `${items.length} ${dataset} sentences, en→${TARGET}, seed "${seed}", ` +
      `budget ${fmtUsd(budgetUsd)}\n`,
  );

  const rows: Row[] = items.map((it) => ({
    ...it,
    context: buildContextLines(promptArgsFor(it)),
    pass1: null,
    pass2: null,
  }));
  let done = 0;
  await pool(rows, CONCURRENCY, async (row) => {
    const args = promptArgsFor(row);
    // Key on the PROMPT, not the sentence: editing `PROMPT_B_INSTRUCTIONS`
    // or the context mapping must invalidate the cached call rather than
    // serve a translation the current prompt would never produce.
    const key = contentHash(buildPrompt(args));
    const p1 = await bench.translateCached(`p1|${key}`, STAGE, args);
    row.pass1 = p1.text;
    if (p1.text) {
      row.pass2 = await qcCached(
        bench,
        openrouter,
        `p2|${qcModel}|${key}|${contentHash(p1.text)}`,
        buildQcPrompt(args, p1.text),
        qcStage,
      );
    }
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${rows.length}  ${fmtUsd(bench.spentUsd)}`);
  });
  bench.save();

  const both = rows.filter((r) => r.pass1 && r.pass2);
  const changed = both.filter((r) => r.pass1 !== r.pass2);
  const lines: string[] = [];
  lines.push(
    `${dataset} en→${TARGET}, ${rows.length} sentences, seed "${seed}"` +
      (dataset === 'catalogue' ? ` (≤ ${maxChars} chars, real metadata)` : ''),
  );
  lines.push(`Pass 1: ${STAGE.model} (${STAGE.reasoning})`);
  lines.push(`Pass 2: ${qcStage.model} (${qcStage.reasoning}), temperature 0`);
  lines.push('');
  lines.push(`QC changed ${changed.length}/${both.length} sentences`);
  lines.push(`Spent: ${fmtUsd(bench.spentUsd)}`);
  lines.push('');
  for (const r of changed) {
    lines.push(`[${r.id}] ${r.source}`);
    lines.push(`  p1  ${r.pass1}`);
    lines.push(`  p2  ${r.pass2}`);
    if (r.reference) lines.push(`  ref ${r.reference}`);
    lines.push('');
  }
  console.log('\n' + lines.slice(0, 12).join('\n'));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `report${suffix}.txt`), lines.join('\n') + '\n');
  writeFileSync(
    resolve(outDir, `results${suffix}.json`),
    JSON.stringify(
      {
        dataset,
        seed,
        n: rows.length,
        maxChars: dataset === 'catalogue' ? maxChars : undefined,
        stage: STAGE,
        qcModel,
        qcStage,
        target: TARGET,
        spentUsd: bench.spentUsd,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outDir}/report${suffix}.txt and results${suffix}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
