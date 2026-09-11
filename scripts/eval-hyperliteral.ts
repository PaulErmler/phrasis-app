/**
 * Hyperliteral gloss benchmark: does the model produce a word-for-word gloss
 * a learner can read — every source word glossed, in the source's own order,
 * with nothing smoothed into idiomatic English?
 *
 *   pnpm eval:hyperliteral                       # every gold language
 *   pnpm eval:hyperliteral --smoke               # 5 rows per language
 *   pnpm eval:hyperliteral --langs=ja,tr --limit=40
 *   pnpm eval:hyperliteral --conditions=luna-floor
 *   pnpm eval:hyperliteral --gloss=de            # gloss INTO German
 *   pnpm eval:hyperliteral --no-judge --budget=1 # USD cap, default 1
 *
 * Gold data lives in data_preparation/hyperliteral_eval/data/<lang>.json, is
 * scraped from English Wikipedia's {{interlinear}} templates and the GlossLM
 * corpus, and carries a `sourceUrl` on every row. It is NOT model-generated.
 * Those sources gloss in the Leipzig style, which the app deliberately does
 * not, so each row also carries the LEXICAL SKELETON of its gloss and the
 * scorer compares against that (see scripts/eval/lib/hyperliteralScoring.ts).
 *
 * Reuses the production prompt verbatim (convex/lib/hyperliteralPrompt.ts), so
 * what scores here is what ships. Results cache to
 * .scratch/hyperliteral-bench/cache.json keyed by (condition, language, gloss
 * language, prompt digest, text); a re-run only buys what it lacks. The key is
 * read from the environment by name; nothing here opens .env.local.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText } from 'ai';
import {
  buildHyperliteralSystemPrompt,
  parseHyperliteral,
} from '../convex/lib/hyperliteralPrompt';
import {
  openrouterCallOptions,
  type ReasoningEffort,
} from '../convex/features/translationLLM';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';
import {
  Bench,
  argValue,
  createOpenRouterFromEnv,
  fmtUsd,
  pool,
  seededShuffle,
  type CallTelemetry,
} from './eval/lib/bench';
import {
  NO_WORD_BOUNDARIES,
  scoreGloss,
  type GlossScore,
  type Skeleton,
} from './eval/lib/hyperliteralScoring';

const GOLD_DIR = resolve('data_preparation/hyperliteral_eval/data');
const OUT_DIR = resolve('.scratch/hyperliteral-bench');
const RUN_HINT = 'pnpm eval:hyperliteral';
const MAX_OUTPUT_TOKENS = 700;
const CONCURRENCY = 6;

type Condition = {
  id: string;
  model: string;
  reasoning: ReasoningEffort;
  provider?: { max_price?: { completion: number }; order?: string[] };
  note: string;
};

/**
 * The three conditions the 2026-09-11 run compared. `luna-floor` was the
 * PROPOSED model and lost: `flash-floor` beat it on every axis (86% vs 83%
 * lexical, 100% vs 90% unit count, 7.7 vs 6.9 on the judge) and ships, which
 * is why `OPENROUTER_MODELS.hyperliteral` is Gemini Flash. The losers stay
 * here so the bench keeps measuring exactly what was rejected, the way
 * `TERRA_SINGLE` does in lib/languages.ts.
 *
 * `luna` is the same model on default routing: `:floor` opts into the flex
 * tier, and Sol returned 2 unrouted HTTP errors in 40 calls on that routing
 * (see SOL_MINIMAL). Luna returned none in 200, so the worry did not
 * reproduce.
 */
const CONDITIONS: Condition[] = [
  {
    id: 'luna-floor',
    model: 'openai/gpt-5.6-luna:floor',
    reasoning: 'none',
    provider: { max_price: { completion: 2 } },
    note: 'proposed, rejected on quality',
  },
  {
    id: 'luna',
    model: 'openai/gpt-5.6-luna',
    reasoning: 'none',
    provider: { max_price: { completion: 2 } },
    note: 'same model, default routing',
  },
  {
    id: 'flash-floor',
    model: 'google/gemini-3.8-flash:floor',
    reasoning: 'minimal',
    note: "SHIPPED; also romanization's model",
  },
];

type GoldItem = {
  text: string;
  lexical: Skeleton;
  glossRaw: string;
  free: string;
  source: string;
  sourceUrl: string;
};
type GoldFile = { language: string; notes?: string; items: GoldItem[] };

function loadGold(langs: string[] | null): Map<string, GoldFile> {
  const out = new Map<string, GoldFile>();
  if (!existsSync(GOLD_DIR)) {
    console.error(
      `No gold data at ${GOLD_DIR}. Build it first:\n` +
        `  python3 data_preparation/hyperliteral_eval/scripts/build_gold.py`,
    );
    process.exit(1);
  }
  for (const file of readdirSync(GOLD_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const lang = file.replace(/\.json$/, '');
    if (langs && !langs.includes(lang)) continue;
    out.set(
      lang,
      JSON.parse(readFileSync(resolve(GOLD_DIR, file), 'utf8')) as GoldFile,
    );
  }
  return out;
}

// --------------------------------------------------------------------- call

/** Calls that actually reached the API this run. `$/1k sentences` divides by
 *  this, not by the item count: a re-run reads most items from cache, and
 *  dividing by all of them reported a fifth of the real price. */
const billedCalls = new Map<string, number>();

const fingerprints = new Map<string, string>();
/** Short stable digest of a prompt, for the cache key. Without it, editing a
 *  rule and re-running returns the old output and reports the change as having
 *  done nothing — the most expensive kind of wrong number. */
function promptFingerprint(language: string, glossLanguage: string): string {
  const memo = `${language}|${glossLanguage}`;
  const cached = fingerprints.get(memo);
  if (cached !== undefined) return cached;
  const prompt = buildHyperliteralSystemPrompt(language, glossLanguage);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < prompt.length; i++) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const digest = hash.toString(36);
  fingerprints.set(memo, digest);
  return digest;
}

async function glossCached(
  bench: Bench,
  openrouter: ReturnType<typeof createOpenRouterFromEnv>,
  condition: Condition,
  language: string,
  glossLanguage: string,
  text: string,
): Promise<string | null> {
  const key = `${condition.id}|${language}|${glossLanguage}|${promptFingerprint(
    language,
    glossLanguage,
  )}|${text}`;
  const hit = bench.cache[key];
  if (hit) return hit.text;
  billedCalls.set(condition.id, (billedCalls.get(condition.id) ?? 0) + 1);

  const startedAt = Date.now();
  let record: { text: string; telemetry: CallTelemetry[] };
  try {
    const providerOptions = openrouterCallOptions(
      condition.reasoning,
      condition.provider,
    );
    const result = await generateText({
      model: openrouter(condition.model),
      system: buildHyperliteralSystemPrompt(language, glossLanguage),
      prompt: text,
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(providerOptions ? { providerOptions } : {}),
    });
    record = {
      text: result.text,
      telemetry: [
        {
          model: condition.id,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          costUsd: openrouterCostUsd(result.providerMetadata),
          latencyMs: Date.now() - startedAt,
          generationId: openrouterGenerationId(result.providerMetadata),
        },
      ],
    };
  } catch (err) {
    // Deliberately NOT cached. A cached failure is permanent, so one rate
    // limit would poison every re-run short of deleting the cache.
    console.warn(
      `  call failed (${condition.id} ${language}): ${
        err instanceof Error ? err.message.slice(0, 160) : String(err)
      }`,
    );
    return null;
  }
  bench.cache[key] = record;
  bench.recordSpend(record.telemetry);
  return record.text;
}

/**
 * How many units the gloss should have, or null where the question has no
 * answer. A language written without spaces has no word count to hit: the gold
 * source split `太陽が東の空に昇る` however its author chose, the app displays
 * the sentence unsplit, and the prompt asks for particles as their own units.
 * Scoring a count against any of those three would grade a style choice.
 */
function expectedUnits(lang: string, item: GoldItem): number | null {
  return NO_WORD_BOUNDARIES.has(lang)
    ? null
    : item.text.trim().split(/\s+/).length;
}

// -------------------------------------------------------------------- judge

const JUDGE_MAX_TOKENS = 3_000;

/**
 * Claude Sonnet 5: a third family, neither OpenAI (Luna) nor Google (Flash).
 *
 * The first run of this bench judged with Gemini 3.8 Flash while Gemini 3.8
 * Flash was also a candidate, and it scored itself 9.6 against Luna's 8.2 —
 * exactly the self-preference `scripts/eval/lib/bench.ts` keeps its own judge
 * out of. Those numbers were discarded. A judge must not be related to any
 * candidate it grades.
 */
const GLOSS_JUDGE_MODEL = 'anthropic/claude-sonnet-5';

/**
 * One judge call per item, scoring every condition's gloss together so they
 * are rated against each other on the same reading. Candidates are shuffled
 * per item so their order carries no condition signal. The judge never sees
 * the Leipzig reference: it would anchor on that surface and mark down a
 * correctly readable gloss for not looking like a linguist's.
 */
async function judgeItem(
  bench: Bench,
  openrouter: ReturnType<typeof createOpenRouterFromEnv>,
  language: string,
  glossLanguage: string,
  item: GoldItem,
  candidates: string[],
): Promise<Record<string, number> | null> {
  const key = `judge|${GLOSS_JUDGE_MODEL}|${language}|${glossLanguage}|${item.text}`;
  const cachedRaw = bench.cache[key]?.text;
  if (cachedRaw) {
    const scores = JSON.parse(cachedRaw) as Record<string, number>;
    if (candidates.every((c) => scores[c] !== undefined)) return scores;
  }
  const shuffled = seededShuffle(candidates, item.text);
  const prompt = [
    `You are grading HYPERLITERAL GLOSSES of one ${language} sentence.`,
    '',
    "A hyperliteral gloss shows what each word is doing, in the sentence's own",
    'order. It is not a translation and is allowed to read as broken English.',
    '',
    `Sentence: ${item.text}`,
    `Its actual meaning: ${item.free}`,
    '',
    'Score each candidate 0-10 on these four checks, equally weighted:',
    "1. Word order is the SENTENCE's, not the gloss language's.",
    '2. One gloss unit per source word, multi-word glosses hyphen-joined.',
    '3. Nothing smoothed into idiomatic English; function words stay literal;',
    '   no word added that the sentence lacks, none dropped that it has.',
    "4. Each word's gloss is semantically right for this sentence.",
    '',
    'Candidates:',
    ...shuffled.map((c, i) => `${i + 1}. ${c}`),
    '',
    `Reply with ONLY a JSON array of ${shuffled.length} integers, in order.`,
  ].join('\n');

  const providerOptions = openrouterCallOptions('low');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await generateText({
        model: openrouter(GLOSS_JUDGE_MODEL),
        prompt,
        temperature: 0,
        maxOutputTokens: JUDGE_MAX_TOKENS,
        ...(providerOptions ? { providerOptions } : {}),
      });
      bench.recordSpend([
        {
          model: GLOSS_JUDGE_MODEL,
          inputTokens: res.usage.inputTokens ?? 0,
          outputTokens: res.usage.outputTokens ?? 0,
          costUsd: openrouterCostUsd(res.providerMetadata),
          latencyMs: Date.now() - startedAt,
          role: 'gloss-judge',
          generationId: openrouterGenerationId(res.providerMetadata),
        },
      ]);
      const match = res.text.match(/\[[\s\d,.]*\]/);
      if (!match) throw new Error(`unparseable: ${res.text.slice(0, 80)}`);
      const parsed = JSON.parse(match[0]) as number[];
      if (parsed.length !== shuffled.length) {
        throw new Error(`expected ${shuffled.length}, got ${parsed.length}`);
      }
      const scores: Record<string, number> = {};
      shuffled.forEach((text, i) => (scores[text] = parsed[i]));
      bench.cache[key] = { text: JSON.stringify(scores), telemetry: [] };
      return scores;
    } catch (err) {
      console.warn(
        `  judge attempt ${attempt} failed (${language}): ${
          err instanceof Error ? err.message.slice(0, 120) : err
        }`,
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------- reporting

type Row = {
  condition: string;
  language: string;
  text: string;
  gloss: string | null;
  score: GlossScore | null;
  judge?: number;
};

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number | null): string =>
  x === null ? '   -' : `${(x * 100).toFixed(0)}%`.padStart(4);
const num = (x: number | null, d = 2): string =>
  x === null ? '   -' : x.toFixed(d).padStart(4);

function report(
  rows: Row[],
  conditions: Condition[],
  spent: Map<string, number>,
): string[] {
  const lines: string[] = [];
  const langs = [...new Set(rows.map((r) => r.language))].sort();

  lines.push('');
  lines.push(
    'PER LANGUAGE  (lex = share of reference lexemes glossed, in order)',
  );
  lines.push('');
  const head = 'lang  n    ' + conditions.map((c) => c.id.padEnd(11)).join(' ');
  lines.push(head);
  for (const metric of ['lex', 'units', 'judge'] as const) {
    lines.push(`--- ${metric}`);
    for (const lang of langs) {
      const cells = conditions.map((c) => {
        const sub = rows.filter(
          (r) => r.language === lang && r.condition === c.id,
        );
        const ok = sub.filter((r) => r.score !== null);
        if (metric === 'lex')
          return pct(mean(ok.map((r) => r.score!.lexical))).padEnd(11);
        if (metric === 'units') {
          const scored = ok.filter((r) => r.score!.unitsOk !== null);
          return (
            scored.length === 0
              ? ' n/a'
              : pct(mean(scored.map((r) => (r.score!.unitsOk ? 1 : 0))))
          ).padEnd(11);
        }
        const j = sub.filter((r) => r.judge !== undefined).map((r) => r.judge!);
        return num(mean(j), 1).padEnd(11);
      });
      const n = rows.filter(
        (r) => r.language === lang && r.condition === conditions[0].id,
      ).length;
      lines.push(`${lang.padEnd(5)} ${String(n).padEnd(4)} ${cells.join(' ')}`);
    }
  }

  lines.push('');
  lines.push('OVERALL');
  lines.push('');
  lines.push('condition    lex  units noLeip judge  fail   $/1k sent   note');
  lines.push(
    '                                              (uncached calls only; "-" = all cached)',
  );
  for (const c of conditions) {
    const sub = rows.filter((r) => r.condition === c.id);
    const ok = sub.filter((r) => r.score !== null);
    const fails = sub.length - ok.length;
    const n = billedCalls.get(c.id) ?? 0;
    const per1k = n === 0 ? null : ((spent.get(c.id) ?? 0) / n) * 1000;
    const j = sub.filter((r) => r.judge !== undefined).map((r) => r.judge!);
    lines.push(
      [
        c.id.padEnd(12),
        pct(mean(ok.map((r) => r.score!.lexical))),
        pct(
          mean(
            ok
              .filter((r) => r.score!.unitsOk !== null)
              .map((r) => (r.score!.unitsOk ? 1 : 0)),
          ),
        ),
        pct(mean(ok.map((r) => (r.score!.noLeipzig ? 1 : 0)))),
        num(mean(j), 1),
        `${fails}/${sub.length}`.padStart(6),
        (per1k === null ? '-' : `$${per1k.toFixed(3)}`).padStart(9),
        '   ' + c.note,
      ].join(' '),
    );
  }
  return lines;
}

/** A few glosses side by side, so a number that looks wrong can be read. */
function samples(
  rows: Row[],
  conditions: Condition[],
  gold: Map<string, GoldFile>,
): string[] {
  const lines = ['', 'SAMPLES', ''];
  for (const [lang, file] of gold) {
    const seen = new Set<string>();
    for (const r of rows.filter(
      (x) => x.language === lang && x.condition === conditions[0].id,
    )) {
      if (seen.size >= 3) break;
      if (seen.has(r.text)) continue;
      seen.add(r.text);
      const item = file.items.find((i) => i.text === r.text);
      lines.push(`[${lang}] ${r.text}`);
      lines.push(`      free   ${item?.free ?? ''}`);
      lines.push(`      ref    ${item?.glossRaw ?? ''}`);
      for (const c of conditions) {
        const got = rows.find(
          (x) =>
            x.language === lang && x.condition === c.id && x.text === r.text,
        );
        lines.push(`      ${c.id.padEnd(11)} ${got?.gloss ?? '<no parse>'}`);
      }
      lines.push('');
    }
  }
  return lines;
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const smoke = argv.includes('--smoke');
  const noJudge = argv.includes('--no-judge');
  const glossLanguage = argValue(argv, 'gloss') ?? 'en';
  const langFilter = argValue(argv, 'langs')
    ?.split(',')
    .map((s) => s.trim());
  const conditionFilter = argValue(argv, 'conditions')
    ?.split(',')
    .map((s) => s.trim());
  const limit = Number(argValue(argv, 'limit') ?? (smoke ? 5 : 40));
  const budgetUsd = Number(argValue(argv, 'budget') ?? 1);

  const conditions = conditionFilter
    ? CONDITIONS.filter((c) => conditionFilter.includes(c.id))
    : CONDITIONS;
  if (conditions.length === 0) {
    console.error(
      `No condition matched. Known: ${CONDITIONS.map((c) => c.id).join(', ')}`,
    );
    process.exit(1);
  }

  const gold = loadGold(langFilter ?? null);
  if (gold.size === 0) {
    console.error('No gold language matched --langs.');
    process.exit(1);
  }
  const openrouter = createOpenRouterFromEnv(RUN_HINT);
  const bench = new Bench({
    outDir: OUT_DIR,
    budgetUsd,
    budgetHint: `re-run ${RUN_HINT} to continue, or raise --budget`,
  });

  // A deterministic slice, so a re-run with the same --limit re-reads the
  // cache instead of buying a different sample.
  const work: { lang: string; item: GoldItem }[] = [];
  for (const [lang, file] of gold) {
    for (const item of seededShuffle(file.items, `hyperliteral|${lang}`).slice(
      0,
      limit,
    )) {
      work.push({ lang, item });
    }
  }
  console.log(
    `${work.length} items x ${conditions.length} conditions ` +
      `(gloss language ${glossLanguage}, budget ${fmtUsd(budgetUsd)})`,
  );

  const rows: Row[] = [];
  const spent = new Map<string, number>();
  const calls = new Map<string, number>();
  const before = new Map(conditions.map((c) => [c.id, 0]));

  for (const condition of conditions) {
    const startSpend = bench.spentUsd;
    let n = 0;
    await pool(work, CONCURRENCY, async ({ lang, item }) => {
      const raw = await glossCached(
        bench,
        openrouter,
        condition,
        lang,
        glossLanguage,
        item.text,
      );
      n += 1;
      const gloss = raw === null ? null : parseHyperliteral(raw);
      rows.push({
        condition: condition.id,
        language: lang,
        text: item.text,
        gloss,
        score:
          gloss === null
            ? null
            : scoreGloss(gloss, expectedUnits(lang, item), item.lexical),
      });
    });
    spent.set(condition.id, bench.spentUsd - startSpend);
    calls.set(condition.id, n);
    bench.save();
    console.log(
      `  ${condition.id}: ${n} calls, ${fmtUsd(bench.spentUsd - startSpend)}`,
    );
  }
  void before;

  if (!noJudge && glossLanguage === 'en') {
    console.log('judging...');
    await pool(work, CONCURRENCY, async ({ lang, item }) => {
      const candidates = [
        ...new Set(
          rows
            .filter(
              (r) => r.language === lang && r.text === item.text && r.gloss,
            )
            .map((r) => r.gloss!),
        ),
      ];
      if (candidates.length === 0) return;
      const scores = await judgeItem(
        bench,
        openrouter,
        lang,
        glossLanguage,
        item,
        candidates,
      );
      if (scores === null) return;
      for (const r of rows) {
        if (
          r.language === lang &&
          r.text === item.text &&
          r.gloss &&
          scores[r.gloss] !== undefined
        ) {
          r.judge = scores[r.gloss];
        }
      }
    });
    bench.save();
  }

  const lines = [
    `hyperliteral gloss bench — ${new Date().toISOString().slice(0, 10)}`,
    `gloss language: ${glossLanguage}   items/lang: ${limit}   total spend: ${fmtUsd(bench.spentUsd)}`,
    ...report(rows, conditions, spent),
    ...samples(rows, conditions, gold),
  ];
  console.log(lines.join('\n'));
  bench.writeReport(lines, {
    glossLanguage,
    spentUsd: bench.spentUsd,
    perCondition: Object.fromEntries(
      conditions.map((c) => {
        const sub = rows.filter((r) => r.condition === c.id);
        const ok = sub.filter((r) => r.score !== null);
        return [
          c.id,
          {
            model: c.model,
            n: sub.length,
            parseFailures: sub.length - ok.length,
            lexical: mean(ok.map((r) => r.score!.lexical)),
            unitsOk: mean(
              ok
                .filter((r) => r.score!.unitsOk !== null)
                .map((r) => (r.score!.unitsOk ? 1 : 0)),
            ),
            noLeipzig: mean(ok.map((r) => (r.score!.noLeipzig ? 1 : 0))),
            judge: mean(
              sub.filter((r) => r.judge !== undefined).map((r) => r.judge!),
            ),
            spentUsd: spent.get(c.id) ?? 0,
          },
        ];
      }),
    ),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
