/**
 * Romanization benchmark: is the shipped engine for each language good
 * enough to be the pronunciation line a learner reads?
 *
 *   pnpm eval:rom                                  # every gold language, default model
 *   pnpm eval:rom --langs=th,he --limit=20
 *   pnpm eval:rom --models=google/gemini-3.8-flash@google-ai-studio/flex
 *   pnpm eval:rom --tier=sentence                  # connected speech only
 *   pnpm eval:rom --budget=2                       # USD cap, default 2
 *
 * Background. Seven languages lost their espeak IPA in Sep 2026 because the
 * transcriptions were wrong (a user reported Thai rendering as "sˈa5wmsaɜds").
 * They show romanization instead, from three different engines depending on
 * what exists for the language — a local library for Mandarin, Cantonese and
 * Korean, Google v3 for Arabic, the model for Thai and Hebrew. This bench is
 * how that routing was chosen and how it stays honest.
 *
 * Gold data lives in data_preparation/romanization_eval/data/<lang>.json with
 * a `sourceUrl` on every row. It is NOT model-generated: an LLM-written gold
 * set would measure nothing but self-agreement.
 *
 * Reuses the production prompt verbatim (convex/lib/romanizationPrompt.ts) and
 * the production local romanizers (convex/lib/localRomanization.ts), so what
 * scores here is what ships. Results cache to .scratch/rom-eval/cache.json
 * keyed by (model, prompt, language, text); a re-run only buys what it lacks.
 * The key is read from the environment by name; nothing here opens .env.local.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText } from 'ai';
import {
  buildRomanizationSystemPrompt,
  getRomanizationConvention,
  parseRomanization,
} from '../convex/lib/romanizationPrompt';
import {
  openrouterCallOptions,
  type ReasoningEffort,
} from '../convex/features/translationLLM';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';
import { romanizeLocal } from '../convex/lib/localRomanization';
import {
  Bench,
  argValue,
  createOpenRouterFromEnv,
  fmtUsd,
  pool,
  type CallTelemetry,
} from './eval/lib/bench';
import {
  scoreRomanization,
  type RomanizationScore,
} from './eval/lib/romanizationScoring';

const GOLD_DIR = resolve('data_preparation/romanization_eval/data');
const OUT_DIR = resolve('.scratch/rom-eval');
const RUN_HINT = 'pnpm eval:rom';

/** Production's choice. See OPENROUTER_MODELS.romanization. */
const DEFAULT_MODELS = ['google/gemini-3.8-flash@google-ai-studio/flex'];
const MAX_OUTPUT_TOKENS = 1_000;
const CONCURRENCY = 6;

/**
 * Reasoning effort per model. Off wherever possible: romanization is a
 * transcription task, not a reasoning one, and thinking is billed. Gemini 3.x
 * rejects a disabled-reasoning request outright ("Reasoning is mandatory for
 * this endpoint"), and muse-spark answers with an EMPTY string rather than an
 * error, so both get their floor.
 */
const REASONING_BY_MODEL: ReadonlyArray<readonly [RegExp, ReasoningEffort]> = [
  [/^google\/gemini-3\./, 'minimal'],
  [/^meta\/muse-spark/, 'minimal'],
];

function reasoningFor(model: string): ReasoningEffort {
  return (
    REASONING_BY_MODEL.find(([pattern]) => pattern.test(model))?.[1] ?? 'none'
  );
}

/**
 * A `--models` entry, optionally pinned to one OpenRouter provider endpoint
 * with `model@provider-tag`.
 *
 * Google serves the same model at three price tiers, which are ENDPOINTS of
 * one model rather than separate slugs, so a tier is only reachable through
 * `provider.order`: `google-ai-studio/flex` at half the standard rate, plain
 * `google-ai-studio`, and `/priority` at double. Fallbacks are off —
 * benchmarking a cheap tier and being silently served by the standard one
 * would report the wrong price for the thing measured.
 */
type ModelSpec = {
  model: string;
  /** The --models entry as written; names the condition and keys the cache. */
  label: string;
  provider?: { order: string[]; allow_fallbacks: boolean };
};

function parseModelSpec(spec: string): ModelSpec {
  const at = spec.indexOf('@');
  if (at === -1) return { model: spec, label: spec };
  return {
    model: spec.slice(0, at),
    label: spec,
    provider: { order: [spec.slice(at + 1)], allow_fallbacks: false },
  };
}

type GoldItem = {
  tier: 'word' | 'sentence';
  text: string;
  romanization?: string | null;
  /** Further attested readings of an ambiguous headword. */
  romanizationAlternatives?: readonly string[];
  /** The source's own scholarly form; equally correct, so equally accepted. */
  romanizationAcademic?: string | null;
  romanizationStressed?: string | null;
  romanizationSandhi?: string | null;
  gloss?: string;
  sourceUrl?: string;
};

type GoldFile = { language: string; notes?: string; items: GoldItem[] };

/** Every romanization of this row that a correct engine might produce. */
function acceptedRomanizations(item: GoldItem): string[] {
  return [
    item.romanization,
    ...(item.romanizationAlternatives ?? []),
    item.romanizationAcademic,
    item.romanizationStressed,
    item.romanizationSandhi,
  ]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0);
}

// --------------------------------------------------------------------- call

const fingerprints = new Map<string, string>();
/**
 * Short stable digest of a language's system prompt, for the cache key.
 * Without it, editing a rule and re-running returns the old output and reports
 * the change as having done nothing — the most expensive kind of wrong number.
 */
function promptFingerprint(language: string): string {
  const cached = fingerprints.get(language);
  if (cached !== undefined) return cached;
  const prompt = buildRomanizationSystemPrompt(language);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < prompt.length; i++) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const digest = hash.toString(36);
  fingerprints.set(language, digest);
  return digest;
}

async function romanizeCached(
  bench: Bench,
  openrouter: ReturnType<typeof createOpenRouterFromEnv>,
  spec: ModelSpec,
  language: string,
  text: string,
): Promise<string | null> {
  const { model, label, provider } = spec;
  // Keyed on the label, not the model, so one model at two price tiers does
  // not read back the other tier's results.
  const key = `${label}|${language}|${promptFingerprint(language)}|${text}`;
  const hit = bench.cache[key];
  if (hit) return hit.text;

  const startedAt = Date.now();
  let record: { text: string; telemetry: CallTelemetry[] };
  try {
    const providerOptions = openrouterCallOptions(
      reasoningFor(model),
      provider,
    );
    const result = await generateText({
      model: openrouter(model),
      system: buildRomanizationSystemPrompt(language),
      prompt: text,
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(providerOptions ? { providerOptions } : {}),
    });
    record = {
      text: result.text,
      telemetry: [
        {
          model: label,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          costUsd: openrouterCostUsd(result.providerMetadata),
          latencyMs: Date.now() - startedAt,
          generationId: openrouterGenerationId(result.providerMetadata),
        },
      ],
    };
  } catch (err) {
    // Deliberately NOT cached. A cached null is permanent, so one bad run —
    // a rate limit, a model needing an account setting changed — would poison
    // every re-run with no way to retry short of deleting the cache.
    console.warn(
      `  call failed (${label} ${language}): ${
        err instanceof Error ? err.message.slice(0, 160) : String(err)
      }`,
    );
    return null;
  }
  bench.cache[key] = record;
  bench.recordSpend(record.telemetry);
  return record.text;
}

// ---------------------------------------------------------------- reporting

type Row = {
  condition: string;
  language: string;
  tier: string;
  /** null when the reply could not be parsed as the requested JSON. */
  score: RomanizationScore | null;
};

const LOCAL_CONDITION = 'local library [shipped]';

function mean(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(0)}%`;
}

const HEADERS = [
  'condition',
  'lang',
  'tier',
  'n',
  'rom',
  'base',
  'exact',
  'unparsed',
] as const;

function summaryCells(rows: Row[]): string[] {
  const scored = rows
    .map((r) => r.score)
    .filter((s): s is RomanizationScore => s !== null);
  return [
    String(rows.length),
    pct(mean(scored.map((s) => s.similarity))),
    pct(mean(scored.map((s) => s.baseSimilarity))),
    pct(
      scored.length === 0
        ? null
        : scored.filter((s) => s.exact).length / scored.length,
    ),
    String(rows.length - scored.length),
  ];
}

function tableLines(rows: Row[], groupBy: (r: Row) => string[]): string[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = groupBy(row).join(' ');
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const body = [...groups].map(([key, groupRows]) => [
    ...key.split(' '),
    ...summaryCells(groupRows),
  ]);
  const widths = HEADERS.map((h, i) =>
    Math.max(h.length, ...body.map((cells) => (cells[i] ?? '').length)),
  );
  return [
    HEADERS.map((h, i) => h.padEnd(widths[i])).join('  '),
    ...body.map((cells) =>
      cells
        .map((c, i) => c.padEnd(widths[i]))
        .join('  ')
        .trimEnd(),
    ),
  ];
}

// --------------------------------------------------------------------- main

const bench = new Bench({
  outDir: OUT_DIR,
  budgetUsd: Number(argValue(process.argv, 'budget') ?? '2'),
  budgetHint: 'raise it with --budget=<usd> if the run is worth more',
});

function loadGold(): GoldFile[] {
  const requested = argValue(process.argv, 'langs')?.split(',');
  const limit = Number(argValue(process.argv, 'limit') ?? '0');
  const tierFilter = argValue(process.argv, 'tier');

  const golds: GoldFile[] = [];
  for (const file of readdirSync(GOLD_DIR).filter((f) => f.endsWith('.json'))) {
    const gold = JSON.parse(
      readFileSync(resolve(GOLD_DIR, file), 'utf8'),
    ) as GoldFile;
    if (requested && !requested.includes(gold.language)) continue;
    let items = gold.items.filter(
      (i) =>
        (!tierFilter || i.tier === tierFilter) &&
        acceptedRomanizations(i).length > 0,
    );
    if (items.length === 0) continue; // Vietnamese: Latin script, no romanization
    if (limit > 0) {
      // Keep both tiers represented: a limit that silently dropped the
      // sentence tier would hide the failures that matter most.
      items = [
        ...items.filter((i) => i.tier === 'word').slice(0, limit),
        ...items.filter((i) => i.tier === 'sentence').slice(0, limit),
      ];
    }
    golds.push({ ...gold, items });
  }
  return golds;
}

async function main(): Promise<void> {
  if (!existsSync(GOLD_DIR)) {
    console.error(
      `No gold data at ${GOLD_DIR}.\n` +
        'See data_preparation/romanization_eval/README.md. Gold rows must come ' +
        'from a cited human source; a model-written gold set measures nothing ' +
        'but self-agreement.',
    );
    process.exit(1);
  }

  const golds = loadGold();
  if (golds.length === 0) {
    console.error('No gold files matched.');
    process.exit(1);
  }

  const models = argValue(process.argv, 'models')?.split(',') ?? DEFAULT_MODELS;
  const rows: Row[] = [];

  // The shipped local libraries first: free, instant, no budget impact. They
  // are the floor a paid engine has to clear, and printing them beside it is
  // the only way to read a score as good or bad rather than merely high.
  for (const gold of golds) {
    for (const item of gold.items) {
      const romanization = romanizeLocal(item.text, gold.language);
      if (romanization === null) continue;
      rows.push({
        condition: LOCAL_CONDITION,
        language: gold.language,
        tier: item.tier,
        score: scoreRomanization(acceptedRomanizations(item), romanization),
      });
    }
  }

  const modelGolds = golds.filter(
    (gold) => getRomanizationConvention(gold.language) !== null,
  );
  const skipped = golds
    .filter((gold) => !modelGolds.includes(gold))
    .map((gold) => gold.language);
  if (skipped.length > 0) {
    // Scoring the model on a language it will never serve would report a
    // number nobody can act on.
    console.log(
      `Model conditions cover ${modelGolds.map((g) => g.language).join(', ')}; ` +
        `${skipped.join(', ')} ship a deterministic engine and are shown as the local rows only.`,
    );
  }

  const openrouter =
    modelGolds.length > 0 ? createOpenRouterFromEnv(RUN_HINT) : null;
  if (openrouter !== null) {
    for (const spec of models.map(parseModelSpec)) {
      for (const gold of modelGolds) {
        process.stdout.write(
          `${spec.label} ${gold.language} (${gold.items.length} items)\n`,
        );
        await pool(gold.items, CONCURRENCY, async (item) => {
          const raw = await romanizeCached(
            bench,
            openrouter,
            spec,
            gold.language,
            item.text,
          );
          const parsed = raw === null ? null : parseRomanization(raw);
          rows.push({
            condition: spec.label,
            language: gold.language,
            tier: item.tier,
            score:
              parsed === null
                ? null
                : scoreRomanization(acceptedRomanizations(item), parsed),
          });
        });
        bench.save();
      }
    }
  }

  const lines: string[] = [
    'Romanization benchmark',
    '',
    'rom   = 1 - edit distance, case-folded, separators and punctuation',
    '        normalized, scored best-of every accepted reading',
    'base  = the same with tone and length diacritics stripped, so the gap',
    '        between rom and base is tone error alone',
    'exact = matched an accepted reading outright after normalization',
    '',
    'By condition and language:',
    ...tableLines(rows, (r) => [r.condition, r.language, 'all']),
    '',
    'By tier:',
    ...tableLines(rows, (r) => [r.condition, r.language, r.tier]),
    '',
    'Overall:',
    ...tableLines(rows, (r) => [r.condition, 'all', 'all']),
    '',
    `Spent ${fmtUsd(bench.spentUsd)} of $${bench.budgetUsd}.`,
  ];

  console.log(`\n${lines.join('\n')}`);
  bench.writeReport(lines, { rows: rows.length, spentUsd: bench.spentUsd });
}

main().catch((err) => {
  bench.save();
  console.error(err);
  process.exit(1);
});
