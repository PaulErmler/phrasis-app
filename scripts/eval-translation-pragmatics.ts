/**
 * Benchmark: does GPT-5.6 Terra (single call, no thinking) fix "too
 * situation-specific" translations better than the production Luna
 * best-of-3 pipeline, and is the best-of-3 judge itself part of the problem?
 *
 *   pnpm eval:pragmatics --smoke
 *   pnpm eval:pragmatics
 *   pnpm eval:pragmatics --langs=de,ja --conditions=luna-bo3,terra-none
 *   pnpm eval:pragmatics --judge-only
 *   pnpm eval:pragmatics --export-blind
 *
 * Same machinery as scripts/eval-translation-sol.ts: the REAL production
 * `translateTextWithLLM` / `translateBestOfN`, the exact `LUNA_BO3` stage as
 * the baseline, and the `TERRA_SINGLE` stage from lib/languages.ts as the
 * candidate, so the comparison isolates the model change. `luna-single` is
 * `LUNA_BO3` minus sampling and judge: if it closes most of the gap, the bo3
 * judge is selecting the over-specific candidate and dropping bo3 is the
 * cheaper fix.
 *
 * Dataset: scripts/eval/translation-pragmatics-cases.ts, 20 short English
 * sentences whose function (check-in question, farewell, decline, ...) is
 * clear but whose surface invites a literal or narrowed rendering, plus
 * register and statement controls. No human references. The judge (Gemini
 * 3.1 Pro, a different family than every candidate) scores each unique
 * candidate 0-10 against the source and the case's one-line intent gloss,
 * with explicit penalties for a changed speech act and for narrowing the
 * source to one situation. A mechanical question-mark rate is printed as a
 * sanity signal next to the judge's `speechAct` / `contrast` numbers.
 *
 * Cost: real billed USD from OpenRouter usage accounting on every call. A
 * running budget guard aborts before passing `--budget` (default $2.00).
 * Results cache to .scratch/translation-pragmatics-bench/cache.json keyed by
 * (condition, lang, case id + content hash), so a re-run never re-buys.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { type TranslationPromptArgs } from '../convex/features/translationLLM';
import {
  LUNA_BO3,
  LUNA_PROVIDER_CONSTRAINTS,
  SOL_MINIMAL,
  TERRA_SINGLE,
  getTranslationConfigForLanguage,
  type ModelStage,
} from '../lib/languages';
import {
  CASES,
  type CaseKind,
  type PragmaticsCase,
} from './eval/translation-pragmatics-cases';
import {
  argValue,
  Bench,
  contextLines,
  createOpenRouterFromEnv,
  fmtUsd,
  judgeCandidates,
  pool,
  seededShuffle,
  type JudgeOutcome,
  type OpenRouterClient,
} from './eval/lib/bench';

// ------------------------------------------------------------------- config

const DEFAULT_LANGS = [
  'de',
  'ja',
  'zh',
  'ru',
  'is',
  'sw',
  'ar',
  'ar_eg',
  'ar_lev',
];
const DEFAULT_CONDITIONS = ['luna-bo3', 'luna-single', 'terra-none'];
const BASELINE = 'luna-bo3';
const KINDS: CaseKind[] = [
  'speechAct',
  'generality',
  'idiomFunction',
  'register',
  'contrast',
];

const OUT_DIR = resolve(__dirname, '../.scratch/translation-pragmatics-bench');
const bench = new Bench({
  outDir: OUT_DIR,
  budgetUsd: 2.0,
  budgetHint: 're-run with fewer --langs/--conditions or raise --budget',
});

/** `LUNA_BO3` without sampling and judge: one temp-0 call. */
const LUNA_SINGLE: ModelStage = {
  model: LUNA_BO3.model,
  reasoning: LUNA_BO3.reasoning,
  maxOutputTokens: LUNA_BO3.maxOutputTokens,
  provider: LUNA_BO3.provider,
};

const CONDITIONS: Record<string, ModelStage> = {
  'luna-bo3': LUNA_BO3, // production pipeline, verbatim
  'luna-single': LUNA_SINGLE,
  'terra-none': TERRA_SINGLE, // the stage phase 2 would ship
  // Sol on the default-routed (standard) endpoint, as the 2026-09-01 bench
  // ran it. Off unless asked for.
  'sol-minimal': {
    model: 'openai/gpt-5.6-sol',
    reasoning: 'minimal',
    maxOutputTokens: 6_000,
  },
  // The production stage: same model, `:floor` routing (flex tier first,
  // price-sorted, $22.1/M completion ceiling). Compare its real cost and
  // latency against `sol-minimal` to confirm the cheap endpoint is used.
  'sol-floor': SOL_MINIMAL,
  // Best-of-3 on the production Sol stage (temp 0 + two temp-1 samples)
  // with the cheap no-thinking Luna judge picking, i.e. today's bo3
  // machinery with Sol candidates. Asked for 2026-09-03 to check whether
  // sampling buys anything over the single call.
  'sol-bo3-luna': {
    ...SOL_MINIMAL,
    samples: { total: 3, extraTemperature: 1 },
    judge: {
      model: LUNA_BO3.judge!.model,
      reasoning: LUNA_BO3.judge!.reasoning,
      provider: LUNA_PROVIDER_CONSTRAINTS,
      maxRetries: 2,
    },
  },
  // Same sampling with Sol itself judging (production routing, minimal
  // thinking), to separate "sampling adds nothing" from "the Luna judge picks
  // badly".
  'sol-bo3-sol': {
    ...SOL_MINIMAL,
    samples: { total: 3, extraTemperature: 1 },
    judge: {
      model: SOL_MINIMAL.model,
      reasoning: SOL_MINIMAL.reasoning,
      provider: SOL_MINIMAL.provider,
      maxRetries: 2,
    },
  },
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
  exportBlind: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argValue(argv, name);
  const smoke = argv.includes('--smoke');
  return {
    langs: (get('langs') ?? (smoke ? 'de' : DEFAULT_LANGS.join(',')))
      .split(',')
      .filter(Boolean),
    limit: Number(get('limit') ?? (smoke ? 2 : CASES.length)),
    budget: Number(get('budget') ?? 2.0),
    concurrency: Number(get('concurrency') ?? 4),
    conditions: (get('conditions') ?? DEFAULT_CONDITIONS.join(','))
      .split(',')
      .filter(Boolean),
    smoke,
    judgeOnly: argv.includes('--judge-only'),
    exportBlind: argv.includes('--export-blind'),
  };
}

// ------------------------------------------------------------------ dataset

/** FNV-1a over the fields the model sees, so an edited case never reuses a stale result. */
function contentHash(c: PragmaticsCase): string {
  const s = `${c.text}|${JSON.stringify(c.metadata)}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function caseKey(c: PragmaticsCase): string {
  return `${c.id}#${contentHash(c)}`;
}

function promptArgsFor(c: PragmaticsCase, lang: string): TranslationPromptArgs {
  const cfg = getTranslationConfigForLanguage(lang);
  return {
    text: c.text,
    sourceLang: 'en',
    targetLang: lang,
    targetLangName: cfg.targetLangName,
    targetLangNativeName: cfg.targetLangNativeName,
    targetRegion: cfg.targetRegion,
    addressesSomeone: c.metadata.addressesSomeone,
    speakerGender: c.metadata.speakerGender,
    addresseeGender: c.metadata.addresseeGender,
    formality: c.metadata.formality,
    referentGender: c.metadata.referentGender,
  };
}

// ------------------------------------------------------------------- judge

function isDialectTarget(lang: string): boolean {
  return (
    lang.includes('_') &&
    lang !== 'zh_traditional' &&
    lang !== 'yue_traditional'
  );
}

function buildScoringPrompt(
  args: TranslationPromptArgs,
  c: PragmaticsCase,
  candidates: string[],
): string {
  const ctx = contextLines(args);
  const dialectLine = isDialectTarget(args.targetLang)
    ? ` The target is the ${args.targetLangName} spoken in ${args.targetRegion}: a candidate written in the standard/formal written variety instead of that spoken variety scores at most 4.`
    : '';
  return [
    `You are a professional English-to-${args.targetLangName} translation evaluator. Score each candidate ${args.targetLangName} translation of the English source on a 0-10 scale.`,
    ``,
    `<context>`,
    ...ctx,
    `</context>`,
    ``,
    `<source>${args.text}</source>`,
    ``,
    `<intended_function>${c.intent}</intended_function>`,
    ``,
    `<candidates>`,
    ...candidates.map((t, i) => `  <candidate id="${i + 1}">${t}</candidate>`),
    `</candidates>`,
    ``,
    `<instructions>`,
    `Score each candidate independently. A learner will see this ${args.targetLangName} sentence next to the English and learn it as the way to say the English. Judge four things: (1) the meaning AND the speech act of the source are preserved, as described in <intended_function> (a question stays a question, a request stays a request, a farewell stays a farewell); (2) the source's level of generality is preserved: the translation must fit the same range of situations the English fits, so deduct for added specifics (who, what, where, why, or one particular situation) that the source does not state, and for resolving an ambiguity the English leaves open; (3) natural, idiomatic ${args.targetLangName} as actually spoken in ${args.targetRegion} today, the phrasing a native speaker would produce in that range of situations;${dialectLine} (4) the context constraints: grammatical agreement with the given genders, and 'informal'/'neutral' register means the casual T-form while only 'formal' means the polite V-form or honorific.`,
    `10 = a native speaker would say exactly this across the same situations; 8-9 = minor style issues; 6-7 = noticeable awkwardness, or slightly narrower or more specific than the source; 4-5 = wrong register, wrong variety, or narrowed to one particular situation; 0-3 = wrong speech act or wrong meaning.`,
    `</instructions>`,
    ``,
    `Output ONLY a JSON array, one integer score per candidate in id order, e.g. [7,9,4]. No commentary.`,
  ].join('\n');
}

async function judgeCase(
  openrouter: OpenRouterClient,
  c: PragmaticsCase,
  lang: string,
  uniqueCandidates: string[],
): Promise<JudgeOutcome | null> {
  const args = promptArgsFor(c, lang);
  const shuffled = seededShuffle(uniqueCandidates, `${lang}:${caseKey(c)}`);
  const prompt = buildScoringPrompt(args, c, shuffled);
  return judgeCandidates(
    bench,
    openrouter,
    prompt,
    shuffled,
    `${lang}/${c.id}`,
  );
}

// -------------------------------------------------------------- mechanical

/** Does the rendering end as a question? Covers Latin, CJK and Arabic marks. */
function endsAsQuestion(text: string): boolean {
  return /[?？؟]\s*$/.test(text.trim());
}

// ----------------------------------------------------------------- blind

function exportBlind(
  langs: string[],
  cases: PragmaticsCase[],
  conditionNames: string[],
) {
  const sheet: string[] = [
    `# Blind pragmatics scoring sheet`,
    ``,
    `Score every lettered candidate 0-10 for: (1) meaning and speech act kept,`,
    `(2) as general as the English (no added situation), (3) natural in the`,
    `named variety, (4) register/gender context respected.`,
    ``,
  ];
  const mapping: {
    id: string;
    lang: string;
    letters: Record<string, string[]>;
    judgeScores: Record<string, number> | null;
  }[] = [];
  for (const lang of langs) {
    for (const c of cases) {
      const id = `${lang}-${c.id}`;
      const byText = new Map<string, string[]>();
      for (const cond of conditionNames) {
        const rec = bench.cache[`${cond}|${lang}|${caseKey(c)}`];
        if (rec?.text)
          byText.set(rec.text, [...(byText.get(rec.text) ?? []), cond]);
      }
      if (byText.size === 0) continue;
      const shuffled = seededShuffle([...byText.keys()], `blind:${id}`);
      const letters: Record<string, string[]> = {};
      const judgeRaw = bench.cache[`judge|${lang}|${caseKey(c)}`]?.text;
      const judgeScores = judgeRaw
        ? (JSON.parse(judgeRaw) as Record<string, number>)
        : null;
      const judgeByLetter: Record<string, number> = {};
      const m = c.metadata;
      const ctx = [
        `speaker=${m.speakerGender ?? 'unspecified'}`,
        m.addressesSomeone
          ? `addressee=${m.addresseeGender ?? 'unspecified'}`
          : '',
        m.addressesSomeone ? `register=${m.formality ?? 'neutral'}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      sheet.push(`---`, ``, `## ${id} (${c.kind})`, ``);
      sheet.push(`**Source (en):** ${c.text}`);
      sheet.push(`**Intent:** ${c.intent}`);
      sheet.push(`**Context:** ${ctx}`, ``);
      shuffled.forEach((text, i) => {
        const letter = String.fromCharCode(65 + i);
        letters[letter] = byText.get(text)!;
        if (judgeScores && judgeScores[text] !== undefined)
          judgeByLetter[letter] = judgeScores[text];
        sheet.push(`- **${letter}:** ${text}`);
      });
      sheet.push(``);
      mapping.push({
        id,
        lang,
        letters,
        judgeScores: Object.keys(judgeByLetter).length ? judgeByLetter : null,
      });
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'blind-sheet.md'), sheet.join('\n'));
  writeFileSync(
    resolve(OUT_DIR, 'blind-mapping.json'),
    JSON.stringify(mapping, null, 1),
  );
  console.log(
    `Wrote ${mapping.length} items to ${OUT_DIR}/blind-sheet.md (+ blind-mapping.json). Read the mapping only after scoring.`,
  );
}

// ----------------------------------------------------------------- reporting

type Bucket = { scoreSum: number; scored: number };
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
  perLang: Record<string, Bucket>;
  perKind: Record<string, Bucket>;
  // Mechanical: speechAct renderings ending as a question / contrast renderings NOT ending as one.
  speechActQuestion: { yes: number; n: number };
  contrastStatement: { yes: number; n: number };
};

function mean(b: Bucket | undefined): string {
  return b?.scored ? (b.scoreSum / b.scored).toFixed(2) : 'n/a';
}
function pct(x: { yes: number; n: number }): string {
  return x.n ? `${Math.round((100 * x.yes) / x.n)}%` : 'n/a';
}

// --------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  bench.budgetUsd = args.budget;

  const cases = CASES.slice(0, args.limit);
  const conditionNames = args.conditions.filter((c) => c in CONDITIONS);
  const unknownConditions = args.conditions.filter((c) => !(c in CONDITIONS));
  if (unknownConditions.length > 0) {
    console.error(
      `Unknown condition(s): ${unknownConditions.join(', ')}. Known: ${Object.keys(CONDITIONS).join(', ')}`,
    );
    process.exit(1);
  }
  for (const lang of args.langs) {
    if (getTranslationConfigForLanguage(lang).provider !== 'openrouter') {
      console.error(
        `Language ${lang} is not an OpenRouter-translated language.`,
      );
      process.exit(1);
    }
  }

  if (args.exportBlind) {
    exportBlind(args.langs, cases, conditionNames);
    return;
  }

  const openrouter = createOpenRouterFromEnv(
    'pnpm eval:pragmatics (tsx --env-file=.env.local)',
  );

  console.log(
    `Benchmark: ${cases.length} cases x ${args.langs.join(',')} x [${conditionNames.join(', ')}], budget $${bench.budgetUsd}`,
  );

  // ── Translation sweep ────────────────────────────────────────────────────
  if (!args.judgeOnly) {
    const work: { condition: string; c: PragmaticsCase; lang: string }[] = [];
    for (const condition of conditionNames) {
      for (const lang of args.langs) {
        for (const c of cases) work.push({ condition, c, lang });
      }
    }
    let done = 0;
    await pool(work, args.concurrency, async ({ condition, c, lang }) => {
      await bench.translateCached(
        `${condition}|${lang}|${caseKey(c)}`,
        CONDITIONS[condition],
        promptArgsFor(c, lang),
      );
      done++;
      if (done % 20 === 0 || done === work.length) {
        bench.save();
        console.log(
          `  translated ${done}/${work.length}  (spent ${fmtUsd(bench.spentUsd)})`,
        );
      }
    });
    bench.save();
  }

  // ── Judging ──────────────────────────────────────────────────────────────
  const judgeKey = (lang: string, c: PragmaticsCase) =>
    `judge|${lang}|${caseKey(c)}`;
  const judgeWork: { c: PragmaticsCase; lang: string }[] = [];
  for (const lang of args.langs)
    for (const c of cases) judgeWork.push({ c, lang });

  await pool(judgeWork, args.concurrency, async ({ c, lang }) => {
    const jk = judgeKey(lang, c);
    const texts = new Set<string>();
    for (const condition of conditionNames) {
      const rec = bench.cache[`${condition}|${lang}|${caseKey(c)}`];
      if (rec?.text) texts.add(rec.text);
    }
    if (texts.size === 0) return;
    // Re-judge only when a candidate is missing from the cached verdict.
    if (bench.hasJudgedAll(jk, texts)) return;
    const outcome = await judgeCase(openrouter, c, lang, [...texts]);
    if (outcome) bench.storeJudge(jk, outcome);
  });
  bench.save();

  // ── Aggregate ────────────────────────────────────────────────────────────
  const aggs: Record<string, ConditionAgg> = {};
  for (const cnd of conditionNames) {
    aggs[cnd] = {
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
      perKind: {},
      speechActQuestion: { yes: 0, n: 0 },
      contrastStatement: { yes: 0, n: 0 },
    };
  }
  let judgeCost = 0;
  const seenJudge = new Set<string>();

  for (const lang of args.langs) {
    for (const c of cases) {
      const jk = judgeKey(lang, c);
      const judgeRec = bench.cache[jk];
      const scores = bench.judgeScores(jk);
      if (judgeRec && !seenJudge.has(jk)) {
        seenJudge.add(jk);
        for (const t of judgeRec.telemetry) judgeCost += t.costUsd ?? 0;
      }
      const baselineRec = bench.cache[`${BASELINE}|${lang}|${caseKey(c)}`];
      const baselineScore = baselineRec?.text
        ? scores[baselineRec.text]
        : undefined;

      for (const condition of conditionNames) {
        const rec = bench.cache[`${condition}|${lang}|${caseKey(c)}`];
        if (!rec) continue;
        const agg = aggs[condition];
        agg.n++;
        if (!rec.text) agg.fails++;
        for (const t of rec.telemetry) {
          agg.inputTokens += t.inputTokens;
          agg.outputTokens += t.outputTokens;
          agg.realCostUsd += t.costUsd ?? 0;
        }
        if (rec.text) {
          if (c.kind === 'speechAct') {
            agg.speechActQuestion.n++;
            if (endsAsQuestion(rec.text)) agg.speechActQuestion.yes++;
          }
          if (c.kind === 'contrast') {
            agg.contrastStatement.n++;
            if (!endsAsQuestion(rec.text)) agg.contrastStatement.yes++;
          }
        }
        const score = rec.text ? scores[rec.text] : undefined;
        if (score !== undefined) {
          agg.scoreSum += score;
          agg.scored++;
          agg.perLang[lang] ??= { scoreSum: 0, scored: 0 };
          agg.perLang[lang].scoreSum += score;
          agg.perLang[lang].scored++;
          agg.perKind[c.kind] ??= { scoreSum: 0, scored: 0 };
          agg.perKind[c.kind].scoreSum += score;
          agg.perKind[c.kind].scored++;
          if (condition !== BASELINE && baselineScore !== undefined) {
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
  p(`\n=== Results (${cases.length} cases x ${args.langs.join(',')}) ===\n`);
  p(
    `condition     | mean  | vs ${BASELINE} (W/T/L) | fails | real cost | cost/sentence | speechAct ends '?' | contrast stays '.'`,
  );
  p(`-`.repeat(118));
  for (const condition of conditionNames) {
    const a = aggs[condition];
    const m = a.scored ? (a.scoreSum / a.scored).toFixed(2) : 'n/a';
    const perSent = a.n ? a.realCostUsd / a.n : 0;
    const wtl =
      condition === BASELINE ? '(baseline)' : `${a.wins}/${a.ties}/${a.losses}`;
    p(
      `${condition.padEnd(13)} | ${String(m).padStart(5)} | ${wtl.padStart(19)} | ${String(a.fails).padStart(5)} | ${fmtUsd(a.realCostUsd).padStart(9)} | ${fmtUsd(perSent).padStart(13)} | ${pct(a.speechActQuestion).padStart(18)} | ${pct(a.contrastStatement).padStart(18)}`,
    );
  }
  p(
    `\nPer-kind mean scores (the complaint is the first three kinds; the last two are controls):`,
  );
  for (const condition of conditionNames) {
    const a = aggs[condition];
    p(
      `  ${condition.padEnd(13)} ${KINDS.map((k) => `${k}=${mean(a.perKind[k])}`).join('  ')}`,
    );
  }
  p(`\nPer-language mean scores:`);
  for (const condition of conditionNames) {
    const a = aggs[condition];
    p(
      `  ${condition.padEnd(13)} ${args.langs.map((l) => `${l}=${mean(a.perLang[l])}`).join('  ')}`,
    );
  }
  p(
    `\nJudge cost: ${fmtUsd(judgeCost)}   Spent this run (incl. cache misses only): ${fmtUsd(bench.spentUsd)}`,
  );
  p(
    `Token totals per condition (in/out incl. reasoning + bo3 judges): ` +
      conditionNames
        .map((c) => `${c}=${aggs[c].inputTokens}/${aggs[c].outputTokens}`)
        .join('  '),
  );

  bench.writeReport(lines, {
    args,
    aggs,
    judgeCost,
    spentUsd: bench.spentUsd,
  });
}

main().catch((err) => {
  bench.save();
  console.error(err);
  process.exit(1);
});
