/**
 * Benchmark: can a no-thinking GPT-5.6 model (Luna, and the production Sol
 * stage) turn a mixed-English curriculum sentence into British and Australian
 * English with a minimal-change prompt, changing only what marks the accent
 * and leaving everything else alone?
 *
 *   pnpm eval:accents --smoke
 *   pnpm eval:accents
 *   pnpm eval:accents --conditions=verbatim,luna,flash-lite --judge-only
 *   pnpm eval:accents --wild=0 --no-judge
 *
 * Before 2026-09-05 `en_gb` / `en_au` courses showed the `en` text verbatim,
 * so the `verbatim` condition is the baseline: doing nothing, at zero cost.
 * Every paid condition runs the production rewrite prompt
 * (`buildAccentRewritePrompt` via `TranslationPromptArgs.accentRewrite`,
 * through the real `translateTextWithLLM`); only the model differs. `luna`
 * is the production `ACCENT_REWRITE_STAGES[0]` verbatim.
 *
 * Dataset: scripts/eval/translation-accent-cases.ts (hand-written cases with
 * per-accent regex expectations) plus a seeded, difficulty-stratified sample
 * of the real catalogue (`--wild=N`, from
 * data_preparation/data/output/sentences.csv) that measures how many real
 * sentences would change at all.
 *
 * Signals: mechanical pass rate on the curated cases (must / mustNot /
 * unchanged), change size (token diff vs the source; identity rate is the
 * activation rate), and a Gemini 3.1 Pro judge scoring every unique candidate
 * 0-10 per accent, with the untouched source always in the candidate set so
 * "leave it alone" is scored on the same scale.
 *
 * Cost: real billed USD from OpenRouter usage accounting on every call, with a
 * running budget guard (default $1.00). Results cache to
 * .scratch/translation-accents-bench/cache.json keyed by (condition, accent,
 * item id + content hash), so a re-run never re-buys.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import {
  ACCENT_REWRITE_STAGES,
  SOL_MINIMAL,
  getAccentRewriteConfig,
  getTranslationConfigForLanguage,
  postProcessTranslation,
  type ModelStage,
} from '../lib/languages';
import type { TranslationPromptArgs } from '../convex/features/translationLLM';
import {
  CASES,
  type Accent,
  type AccentCase,
  type AccentKind,
  type Expectation,
} from './eval/translation-accent-cases';
import {
  argValue,
  Bench,
  createOpenRouterFromEnv,
  fmtUsd,
  judgeCandidates,
  pool,
  seededShuffle,
  type JudgeOutcome,
  type OpenRouterClient,
} from './eval/lib/bench';

// ------------------------------------------------------------------- config

const ACCENTS: Accent[] = ['en_gb', 'en_au'];
const BASELINE = 'verbatim';
const DEFAULT_CONDITIONS = [BASELINE, 'luna', 'sol-minimal'];
const KINDS: AccentKind[] = [
  'spelling',
  'vocabulary',
  'grammar',
  'divergent',
  'frozen',
  'control',
];
const WILD_CSV = resolve(
  __dirname,
  '../data_preparation/data/output/sentences.csv',
);
const WILD_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const OUT_DIR = resolve(__dirname, '../.scratch/translation-accents-bench');
const bench = new Bench({
  outDir: OUT_DIR,
  budgetUsd: 1.0,
  budgetHint:
    're-run with fewer --conditions, a smaller --wild, or raise --budget',
});

/** null = the baseline: no call, the source text is the answer. */
const CONDITIONS: Record<string, ModelStage | null> = {
  verbatim: null,
  // The production stage (lib/languages.ts), verbatim.
  luna: ACCENT_REWRITE_STAGES[0],
  'sol-minimal': { ...SOL_MINIMAL, maxOutputTokens: 1_000 },
  // Cheap alternative, off by default.
  'flash-lite': {
    model: 'google/gemini-3.5-flash-lite',
    reasoning: 'minimal',
    maxOutputTokens: 1_000,
  },
};

type Args = {
  conditions: string[];
  accents: Accent[];
  wild: number;
  limit: number;
  budget: number;
  concurrency: number;
  smoke: boolean;
  judgeOnly: boolean;
  noJudge: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argValue(argv, name);
  const smoke = argv.includes('--smoke');
  return {
    conditions: (
      get('conditions') ??
      (smoke ? 'verbatim,luna' : DEFAULT_CONDITIONS.join(','))
    )
      .split(',')
      .filter(Boolean),
    accents: (get('accents') ?? ACCENTS.join(','))
      .split(',')
      .filter((a): a is Accent => a === 'en_gb' || a === 'en_au'),
    wild: Number(get('wild') ?? (smoke ? 0 : 100)),
    limit: Number(get('limit') ?? (smoke ? 5 : CASES.length)),
    budget: Number(get('budget') ?? 1.0),
    concurrency: Number(get('concurrency') ?? 4),
    smoke,
    judgeOnly: argv.includes('--judge-only'),
    noJudge: smoke || argv.includes('--no-judge'),
  };
}

// ------------------------------------------------------------------ dataset

type Item = {
  id: string;
  kind: AccentKind | 'wild';
  text: string;
  /** Absent for wild items: nothing mechanical to check. */
  expect?: Record<Accent, Expectation>;
};

function fnv(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Edited text never reuses a stale result. */
function itemKey(it: Item): string {
  return `${it.id}#${fnv(it.text)}`;
}

function curatedItems(limit: number): Item[] {
  return CASES.slice(0, limit).map((c: AccentCase) => ({
    id: c.id,
    kind: c.kind,
    text: c.text,
    expect: c.expect,
  }));
}

/** A seeded sample of the catalogue, equal counts per CEFR level. */
function wildItems(n: number): Item[] {
  if (n <= 0) return [];
  const rows = parse(readFileSync(WILD_CSV, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
  }) as { id: string; text: string; difficulty: string }[];
  const perLevel = Math.ceil(n / WILD_LEVELS.length);
  const picked: Item[] = [];
  for (const level of WILD_LEVELS) {
    const pool = rows.filter((r) => r.difficulty === level);
    for (const r of seededShuffle(pool, `accents-wild:${level}`).slice(
      0,
      perLevel,
    )) {
      picked.push({ id: `wild-${level}-${r.id}`, kind: 'wild', text: r.text });
    }
  }
  return seededShuffle(picked, 'accents-wild:order').slice(0, n);
}

// ------------------------------------------------------------------- prompt

/**
 * The production prompt args for an accent rewrite: `accentRewrite` set
 * makes `buildPrompt` return `buildAccentRewritePrompt` and ignore the
 * context fields, exactly as the LLM queue worker does for an `en`
 * sentence on an `en_gb` course. The bench therefore measures the very
 * prompt production sends.
 */
function promptArgsFor(accent: Accent, text: string): TranslationPromptArgs {
  const cfg = getTranslationConfigForLanguage(accent);
  const accentRewrite = getAccentRewriteConfig(accent, 'en');
  if (!accentRewrite) throw new Error(`${accent} declares no accentRewrite`);
  return {
    text,
    sourceLang: 'en',
    targetLang: accent,
    targetLangName: cfg.targetLangName,
    targetLangNativeName: cfg.targetLangNativeName,
    targetRegion: cfg.targetRegion,
    addressesSomeone: false,
    referentGender: 'male',
    accentRewrite,
  };
}

function accentName(accent: Accent): string {
  return getAccentRewriteConfig(accent, 'en')?.name ?? accent;
}

/**
 * Cleanup for records cached before the bench moved onto the production
 * path (which already strips quotes and post-processes). Idempotent, so it
 * is applied to every record on read.
 */
function cleanOutput(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2) {
    const pairs = new Set(['"', "'", '“', '”', '‘', '’', '«', '»']);
    const first = s[0];
    const last = s[s.length - 1];
    if (first === last && pairs.has(first)) s = s.slice(1, -1).trim();
  }
  return postProcessTranslation('en', s);
}

function cacheKey(condition: string, accent: Accent, it: Item): string {
  return `${condition}|${accent}|${itemKey(it)}`;
}

/** The cleaned text a condition produced for an item, null for a failure. */
function outputText(
  condition: string,
  accent: Accent,
  it: Item,
): string | null {
  if (condition === BASELINE) return it.text;
  const rec = bench.cache[cacheKey(condition, accent, it)];
  return rec?.text ? cleanOutput(rec.text) : null;
}

// --------------------------------------------------------------- mechanical

function checkExpect(
  exp: Expectation,
  source: string,
  out: string,
): { pass: boolean; why: string[] } {
  const why: string[] = [];
  if (exp.unchanged && out !== source) why.push('changed');
  for (const re of exp.must ?? []) if (!re.test(out)) why.push(`missing ${re}`);
  for (const re of exp.mustNot ?? []) if (re.test(out)) why.push(`kept ${re}`);
  return { pass: why.length === 0, why };
}

/** Whitespace tokens that differ, LCS-based so one substitution counts once. */
function changedTokens(a: string, b: string): number {
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  const dp: number[][] = Array.from({ length: x.length + 1 }, () =>
    new Array<number>(y.length + 1).fill(0),
  );
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      dp[i][j] =
        x[i - 1] === y[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return Math.max(x.length, y.length) - dp[x.length][y.length];
}

// ------------------------------------------------------------------- judge

function buildScoringPrompt(
  accent: Accent,
  source: string,
  candidates: string[],
): string {
  const name = accentName(accent);
  return [
    `You are a native ${name} English editor evaluating light-touch localisations of a short English sentence. Score each candidate 0-10.`,
    ``,
    `<source>${source}</source>`,
    ``,
    `<candidates>`,
    ...candidates.map((t, i) => `  <candidate id="${i + 1}">${t}</candidate>`),
    `</candidates>`,
    ``,
    `<instructions>`,
    `The candidate will be shown to a learner of ${name} English as the way a ${name} speaker would write this sentence, and read aloud by a ${name} voice. The rewrite must change ONLY what marks the accent (spelling, everyday vocabulary, a grammatical habit that sounds American) and nothing else. Judge four things: (1) it reads as natural ${name} English to a native speaker; (2) no Americanism remains that a ${name} reader would notice as foreign (American spelling, an everyday word ${name} speakers do not use); (3) nothing else changed: same meaning, tone, register, sentence structure, punctuation, quotation marks, names, places, brands, numbers, units, currencies and dates, even American ones; (4) no added slang, regional colour or filler. A candidate identical to the source is correct when the source already reads as natural ${name} English, and wrong when an obvious Americanism was left in.`,
    `10 = exactly what a careful native editor would produce, including leaving it alone when nothing needs to change; 8-9 = right, with one debatable choice; 6-7 = one unnecessary change or one missed Americanism; 4-5 = added slang, changed something meaning-carrying (a number, unit, name, quotation mark), or still plainly American; 0-3 = the meaning changed.`,
    `</instructions>`,
    ``,
    `Output ONLY a JSON array, one integer score per candidate in id order, e.g. [7,9,4]. No commentary.`,
  ].join('\n');
}

function judgeKey(accent: Accent, it: Item): string {
  return `judge|${accent}|${itemKey(it)}`;
}

async function judgeItem(
  openrouter: OpenRouterClient,
  accent: Accent,
  it: Item,
  unique: string[],
): Promise<JudgeOutcome | null> {
  const shuffled = seededShuffle(unique, `${accent}:${itemKey(it)}`);
  return judgeCandidates(
    bench,
    openrouter,
    buildScoringPrompt(accent, it.text, shuffled),
    shuffled,
    `${accent}/${it.id}`,
  );
}

// ----------------------------------------------------------------- reporting

type Rate = { yes: number; n: number };
type Agg = {
  n: number;
  fails: number;
  scoreSum: number;
  scored: number;
  wins: number;
  ties: number;
  losses: number;
  identical: number;
  changedTokenSum: number;
  mech: Rate;
  mechPerKind: Record<string, Rate>;
  wildIdentity: Rate;
  inputTokens: number;
  outputTokens: number;
  realCostUsd: number;
};

function newAgg(): Agg {
  return {
    n: 0,
    fails: 0,
    scoreSum: 0,
    scored: 0,
    wins: 0,
    ties: 0,
    losses: 0,
    identical: 0,
    changedTokenSum: 0,
    mech: { yes: 0, n: 0 },
    mechPerKind: {},
    wildIdentity: { yes: 0, n: 0 },
    inputTokens: 0,
    outputTokens: 0,
    realCostUsd: 0,
  };
}

function pct(r: Rate): string {
  return r.n ? `${Math.round((100 * r.yes) / r.n)}%` : 'n/a';
}

type DiffLine = {
  it: Item;
  accent: Accent;
  condition: string;
  out: string;
  mech?: { pass: boolean; why: string[] };
  score?: number;
};

function writeDiffSheet(lines: DiffLine[]): void {
  const byItem = new Map<string, DiffLine[]>();
  for (const l of lines) {
    const k = l.it.id;
    byItem.set(k, [...(byItem.get(k) ?? []), l]);
  }
  const md: string[] = [
    `# Accent rewrite diff sheet`,
    ``,
    `Every item where at least one condition changed the text, or failed a mechanical check. Format: condition/accent, then the output, then the check result and judge score.`,
    ``,
  ];
  for (const [id, group] of byItem) {
    const it = group[0].it;
    md.push(`## ${id} (${it.kind})`, ``, `Source: ${it.text}`, ``);
    for (const l of group) {
      const mark =
        l.mech === undefined
          ? ''
          : l.mech.pass
            ? ' ✓'
            : ` ✗ ${l.mech.why.join('; ')}`;
      const score = l.score === undefined ? '' : ` [judge ${l.score}]`;
      const same = l.out === it.text ? ' (unchanged)' : '';
      md.push(`- ${l.condition}/${l.accent}: ${l.out}${same}${mark}${score}`);
    }
    md.push(``);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'diff-sheet.md'), md.join('\n'));
  console.log(`Wrote ${byItem.size} items to ${OUT_DIR}/diff-sheet.md`);
}

// --------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  bench.budgetUsd = args.budget;

  const unknown = args.conditions.filter((c) => !(c in CONDITIONS));
  if (unknown.length > 0) {
    console.error(
      `Unknown condition(s): ${unknown.join(', ')}. Known: ${Object.keys(CONDITIONS).join(', ')}`,
    );
    process.exit(1);
  }
  const conditionNames = args.conditions;
  const paid = conditionNames.filter((c) => CONDITIONS[c] !== null);
  const items = [...curatedItems(args.limit), ...wildItems(args.wild)];

  const openrouter = createOpenRouterFromEnv(
    'pnpm eval:accents (tsx --env-file=.env.local)',
  );

  console.log(
    `Benchmark: ${items.length} items (${items.filter((i) => i.kind !== 'wild').length} curated + ${items.filter((i) => i.kind === 'wild').length} wild) x ${args.accents.join(',')} x [${conditionNames.join(', ')}], budget $${bench.budgetUsd}`,
  );

  // ── Rewrite sweep ────────────────────────────────────────────────────────
  if (!args.judgeOnly) {
    const work: { condition: string; accent: Accent; it: Item }[] = [];
    for (const condition of paid)
      for (const accent of args.accents)
        for (const it of items) work.push({ condition, accent, it });
    let done = 0;
    await pool(work, args.concurrency, async ({ condition, accent, it }) => {
      await bench.translateCached(
        cacheKey(condition, accent, it),
        CONDITIONS[condition]!,
        promptArgsFor(accent, it.text),
      );
      done++;
      if (done % 25 === 0 || done === work.length) {
        bench.save();
        console.log(
          `  rewrote ${done}/${work.length}  (spent ${fmtUsd(bench.spentUsd)})`,
        );
      }
    });
    bench.save();
  }

  // ── Judging ──────────────────────────────────────────────────────────────
  if (!args.noJudge) {
    const judgeWork: { accent: Accent; it: Item }[] = [];
    for (const accent of args.accents)
      for (const it of items) judgeWork.push({ accent, it });
    await pool(judgeWork, args.concurrency, async ({ accent, it }) => {
      const texts = new Set<string>();
      for (const condition of conditionNames) {
        const t = outputText(condition, accent, it);
        if (t) texts.add(t);
      }
      // Always score "leave it alone" on the same scale.
      texts.add(it.text);
      const jk = judgeKey(accent, it);
      if (bench.hasJudgedAll(jk, texts)) return;
      const outcome = await judgeItem(openrouter, accent, it, [...texts]);
      if (outcome) bench.storeJudge(jk, outcome);
    });
    bench.save();
  }

  // ── Aggregate ────────────────────────────────────────────────────────────
  const aggs: Record<string, Agg> = {};
  const aggKey = (condition: string, accent: Accent) =>
    `${condition}/${accent}`;
  for (const condition of conditionNames)
    for (const accent of args.accents)
      aggs[aggKey(condition, accent)] = newAgg();
  let judgeCost = 0;
  const diffLines: DiffLine[] = [];

  for (const accent of args.accents) {
    for (const it of items) {
      const jk = judgeKey(accent, it);
      const judgeRec = bench.cache[jk];
      const scores = bench.judgeScores(jk);
      if (judgeRec)
        for (const t of judgeRec.telemetry) judgeCost += t.costUsd ?? 0;
      const baselineScore = scores[it.text];
      const perCondition: DiffLine[] = [];
      let anyChangeOrFail = false;

      for (const condition of conditionNames) {
        const agg = aggs[aggKey(condition, accent)];
        const rec =
          condition === BASELINE
            ? undefined
            : bench.cache[cacheKey(condition, accent, it)];
        if (condition !== BASELINE && !rec) continue;
        agg.n++;
        for (const t of rec?.telemetry ?? []) {
          agg.inputTokens += t.inputTokens;
          agg.outputTokens += t.outputTokens;
          agg.realCostUsd += t.costUsd ?? 0;
        }
        const out = outputText(condition, accent, it);
        if (out === null) {
          agg.fails++;
          continue;
        }
        const same = out === it.text;
        if (same) agg.identical++;
        else agg.changedTokenSum += changedTokens(it.text, out);
        if (it.kind === 'wild') {
          agg.wildIdentity.n++;
          if (same) agg.wildIdentity.yes++;
        }
        let mech: { pass: boolean; why: string[] } | undefined;
        if (it.expect) {
          mech = checkExpect(it.expect[accent], it.text, out);
          agg.mech.n++;
          agg.mechPerKind[it.kind] ??= { yes: 0, n: 0 };
          agg.mechPerKind[it.kind].n++;
          if (mech.pass) {
            agg.mech.yes++;
            agg.mechPerKind[it.kind].yes++;
          }
        }
        const score = scores[out];
        if (score !== undefined) {
          agg.scoreSum += score;
          agg.scored++;
          if (condition !== BASELINE && baselineScore !== undefined) {
            if (score > baselineScore) agg.wins++;
            else if (score < baselineScore) agg.losses++;
            else agg.ties++;
          }
        }
        if (!same || (mech && !mech.pass)) anyChangeOrFail = true;
        perCondition.push({ it, accent, condition, out, mech, score });
      }
      if (anyChangeOrFail) diffLines.push(...perCondition);
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const lines: string[] = [];
  const p = (s: string) => {
    lines.push(s);
    console.log(s);
  };
  p(
    `\n=== Results (${items.length} items x ${args.accents.join(',')}; ${paid.length} paid condition(s)) ===\n`,
  );
  p(
    `condition/accent    | judge | vs verbatim (W/T/L) | mech pass | identical | tokens changed | fails | real cost | cost/sentence`,
  );
  p(`-`.repeat(126));
  for (const condition of conditionNames) {
    for (const accent of args.accents) {
      const a = aggs[aggKey(condition, accent)];
      const m = a.scored ? (a.scoreSum / a.scored).toFixed(2) : 'n/a';
      const wtl =
        condition === BASELINE
          ? '(baseline)'
          : `${a.wins}/${a.ties}/${a.losses}`;
      const ok = a.n - a.fails;
      const ident = ok ? `${Math.round((100 * a.identical) / ok)}%` : 'n/a';
      const changed = ok - a.identical;
      const tok = changed ? (a.changedTokenSum / changed).toFixed(1) : 'n/a';
      const perSent = a.n ? a.realCostUsd / a.n : 0;
      p(
        `${aggKey(condition, accent).padEnd(19)} | ${String(m).padStart(5)} | ${wtl.padStart(19)} | ${pct(a.mech).padStart(9)} | ${ident.padStart(9)} | ${tok.padStart(14)} | ${String(a.fails).padStart(5)} | ${fmtUsd(a.realCostUsd).padStart(9)} | ${fmtUsd(perSent).padStart(13)}`,
      );
    }
  }
  p(`\nMechanical pass rate per kind (curated cases only):`);
  for (const condition of conditionNames) {
    for (const accent of args.accents) {
      const a = aggs[aggKey(condition, accent)];
      p(
        `  ${aggKey(condition, accent).padEnd(19)} ${KINDS.map((k) => `${k}=${pct(a.mechPerKind[k] ?? { yes: 0, n: 0 })}`).join('  ')}`,
      );
    }
  }
  if (args.wild > 0) {
    p(
      `\nWild sample: share of real catalogue sentences left unchanged (100% - activation rate):`,
    );
    for (const condition of paid) {
      for (const accent of args.accents) {
        const a = aggs[aggKey(condition, accent)];
        p(
          `  ${aggKey(condition, accent).padEnd(19)} unchanged=${pct(a.wildIdentity)}  (n=${a.wildIdentity.n})`,
        );
      }
    }
  }
  p(
    `\nJudge cost: ${fmtUsd(judgeCost)}   Spent this run (cache misses only): ${fmtUsd(bench.spentUsd)}`,
  );
  p(
    `Token totals per condition/accent (in/out): ` +
      Object.entries(aggs)
        .filter(([k]) => !k.startsWith(BASELINE))
        .map(([k, a]) => `${k}=${a.inputTokens}/${a.outputTokens}`)
        .join('  '),
  );

  bench.writeReport(lines, { args, aggs, judgeCost, spentUsd: bench.spentUsd });
  writeDiffSheet(diffLines);
}

main().catch((err) => {
  bench.save();
  console.error(err);
  process.exit(1);
});
