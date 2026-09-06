/**
 * Benchmark: how well can a cheap model tell what a stored translation's
 * wording IS on the two sentence-form axes (speaker gender in first-person
 * forms, politeness form)? This picks the model behind
 * convex/lib/renderingClassifier.ts, which stamps every translation row for
 * the chips on the card and the "canonical already satisfies the
 * preference" shortcut (the backfill runs it over the whole catalogue).
 *
 *   pnpm eval:rendering --validate-only
 *   pnpm eval:rendering --smoke
 *   pnpm eval:rendering
 *   pnpm eval:rendering --langs=ja,ko,de --models=flash-lite-31,luna
 *   pnpm eval:rendering --wild=.scratch/rendering-bench/translations.jsonl --wild-n=40
 *
 * Gold: data_preparation/gender_eval (508 target-language sentences with a
 * gold speaker gender) and data_preparation/politeness_eval (143 with a
 * gold register), both from the Aug 2026 metadata-classifier work. A gold
 * label maps onto the classifier's categories through lib/languageForms.ts
 * (gold "polite" on German is the du form, reported as "casual"; on French
 * it is vous, reported as "polite"; gold "neutral" is "unmarked").
 *
 * Wild sample: pass `--wild=<translations documents.jsonl>` (a Convex
 * export; `unzip -p .convex-snapshots/<name>.zip translations/documents.jsonl
 * > .scratch/rendering-bench/translations.jsonl` extracts one) and up to
 * `--wild-n` live rows per language are labelled by the JUDGE model
 * (Gemini 3.8 Flash, same prompt) and each candidate is scored on agreement
 * with those labels. Spot-check the judge labels in the report before
 * trusting a small disagreement.
 *
 * Both prompt wordings (product / literature, see `PromptWording`) run for
 * every model unless `--wording` narrows it. Cost is real billed USD;
 * budget guard default $2. Results cache to
 * .scratch/rendering-bench/cache.json keyed by (model, wording, lang,
 * batch hash). The key is read from the environment by name.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { generateText } from 'ai';
import {
  buildRenderingClassifierPrompt,
  buildRenderingClassifierUserPrompt,
  classificationLanguageForRow,
  parseRenderingClassifications,
  renderingAxesFor,
  type PromptWording,
  type RenderedGender,
  type RenderedPoliteness,
} from '../convex/lib/renderingClassifier';
import { getPolitenessConfig, distinctPolitenessForms } from '../lib/languageForms';
import { LUNA_BO3, LUNA_PROVIDER_CONSTRAINTS } from '../lib/languages';
import {
  argValue,
  Bench,
  createOpenRouterFromEnv,
  FLASH_JUDGE_MODEL,
  fmtUsd,
  pool,
  seededShuffle,
  type CallTelemetry,
  type OpenRouterClient,
} from './eval/lib/bench';
import { openrouterCostUsd, openrouterGenerationId } from '../convex/lib/posthogAi';

// ------------------------------------------------------------------- config

const MODELS: Record<string, string> = {
  'flash-lite-31': 'google/gemini-3.1-flash-lite',
  'flash-lite-35': 'google/gemini-3.5-flash-lite',
  'flash-37': 'google/gemini-3.7-flash',
  luna: LUNA_BO3.model,
};
const DEFAULT_MODELS = Object.keys(MODELS);
const WORDINGS: PromptWording[] = ['product', 'literature'];
const BATCH = 25;

const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, '.scratch/rendering-bench');
const bench = new Bench({
  outDir: OUT_DIR,
  budgetUsd: Number(argValue(process.argv, 'budget') ?? 2),
  budgetHint: 're-run with fewer --langs/--models or raise --budget',
});

// -------------------------------------------------------------------- data

type Item = {
  id: string;
  language: string;
  text: string;
  expectedGender?: RenderedGender;
  expectedPoliteness?: RenderedPoliteness;
  source: 'gold' | 'wild';
};

function readJsonl(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Gold register -> the level the classifier reports for that form. */
function politenessLevelFor(
  language: string,
  gold: string,
): RenderedPoliteness | undefined {
  if (gold === 'neutral') return 'unmarked';
  const config = getPolitenessConfig(language);
  if (!config) return undefined;
  if (gold !== 'casual' && gold !== 'polite' && gold !== 'formal') return undefined;
  const form = config.forms[gold];
  const entry = distinctPolitenessForms(language).find(
    (d) => d.form.id === form.id,
  );
  return entry?.levels[0];
}

function loadGold(): Item[] {
  const items: Item[] = [];
  const genderDir = resolve(ROOT, 'data_preparation/gender_eval/data');
  for (const file of readdirSync(genderDir)) {
    if (!file.endsWith('.jsonl')) continue;
    for (const [i, row] of readJsonl(resolve(genderDir, file)).entries()) {
      const language = String(row.language);
      if (!renderingAxesFor(language).gender) continue;
      const expected = String(row.expected);
      items.push({
        id: `g:${language}:${i}`,
        language,
        text: String(row.text),
        expectedGender:
          expected === 'male'
            ? 'masculine'
            : expected === 'female'
              ? 'feminine'
              : 'unmarked',
        source: 'gold',
      });
    }
  }
  const politenessDir = resolve(ROOT, 'data_preparation/politeness_eval/data');
  for (const file of readdirSync(politenessDir)) {
    if (!file.endsWith('.jsonl')) continue;
    for (const [i, row] of readJsonl(resolve(politenessDir, file)).entries()) {
      const language = String(row.language);
      const expected = politenessLevelFor(language, String(row.expected));
      if (!expected) continue;
      items.push({
        id: `p:${language}:${i}`,
        language,
        text: String(row.text),
        expectedPoliteness: expected,
        source: 'gold',
      });
    }
  }
  return items;
}

function loadWild(path: string, perLanguage: number): Item[] {
  const rows = readJsonl(path).filter(
    (row) => typeof row.translatedText === 'string' && !row.supersededAt,
  );
  const byLanguage = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const language = classificationLanguageForRow({
      targetLanguage: String(row.targetLanguage),
      regionVariant:
        typeof row.regionVariant === 'string' ? row.regionVariant : undefined,
    });
    const axes = renderingAxesFor(language);
    if (!axes.gender && !axes.politeness) continue;
    const list = byLanguage.get(language) ?? [];
    list.push(row);
    byLanguage.set(language, list);
  }
  const items: Item[] = [];
  for (const [language, list] of byLanguage) {
    const sample = seededShuffle(list, `wild:${language}`).slice(0, perLanguage);
    sample.forEach((row, i) =>
      items.push({
        id: `w:${language}:${i}`,
        language,
        text: String(row.translatedText),
        source: 'wild',
      }),
    );
  }
  return items;
}

// ------------------------------------------------------------------- calls

type Prediction = { gender: RenderedGender; politeness: RenderedPoliteness } | null;

function batchKey(
  model: string,
  wording: PromptWording,
  language: string,
  texts: string[],
): string {
  const hash = createHash('sha1').update(texts.join('\n')).digest('hex').slice(0, 12);
  return `${model}|${wording}|${language}|${hash}`;
}

async function classifyBatch(
  openrouter: OpenRouterClient,
  model: string,
  wording: PromptWording,
  language: string,
  texts: string[],
): Promise<Prediction[]> {
  const key = batchKey(model, wording, language, texts);
  const hit = bench.cache[key];
  if (hit) {
    return hit.text ? parseRenderingClassifications(language, hit.text, texts.length) : texts.map(() => null);
  }
  const startedAt = Date.now();
  const providerOptions =
    model === LUNA_BO3.model
      ? { openrouter: { reasoning: { enabled: false }, provider: LUNA_PROVIDER_CONSTRAINTS } }
      : undefined;
  let text: string | null = null;
  const telemetry: CallTelemetry[] = [];
  try {
    const res = await generateText({
      model: openrouter(model),
      system: buildRenderingClassifierPrompt(language, wording),
      prompt: buildRenderingClassifierUserPrompt(texts),
      temperature: 0,
      maxOutputTokens: 3_000,
      ...(providerOptions ? { providerOptions } : {}),
    });
    text = res.text;
    telemetry.push({
      model,
      inputTokens: res.usage.inputTokens ?? 0,
      outputTokens: res.usage.outputTokens ?? 0,
      costUsd: openrouterCostUsd(res.providerMetadata),
      latencyMs: Date.now() - startedAt,
      role: 'classifier',
      generationId: openrouterGenerationId(res.providerMetadata),
    });
  } catch (err) {
    console.warn(`  ${model} ${language} failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
  }
  bench.cache[key] = { text, telemetry };
  bench.recordSpend(telemetry);
  bench.save();
  return text ? parseRenderingClassifications(language, text, texts.length) : texts.map(() => null);
}

// -------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const validateOnly = argv.includes('--validate-only');
  const smoke = argv.includes('--smoke');
  const langsArg = argValue(argv, 'langs');
  const modelKeys = (argValue(argv, 'models') ?? DEFAULT_MODELS.join(','))
    .split(',')
    .filter(Boolean);
  const wordings = (argValue(argv, 'wording') ?? 'both') === 'both'
    ? WORDINGS
    : [argValue(argv, 'wording') as PromptWording];
  const wildPath = argValue(argv, 'wild');
  const wildN = Number(argValue(argv, 'wild-n') ?? 40);
  const limit = argValue(argv, 'limit') ? Number(argValue(argv, 'limit')) : undefined;

  for (const key of modelKeys) {
    if (!MODELS[key]) {
      console.error(`Unknown model alias ${key}. Known: ${DEFAULT_MODELS.join(', ')}`);
      process.exit(1);
    }
  }

  let items = loadGold();
  if (wildPath) {
    if (!existsSync(wildPath)) {
      console.error(`--wild file not found: ${wildPath}`);
      process.exit(1);
    }
    items = items.concat(loadWild(wildPath, wildN));
  }
  if (langsArg) {
    const langs = new Set(langsArg.split(','));
    items = items.filter((item) => langs.has(item.language));
  }
  if (smoke) items = items.filter((item) => ['ja', 'de', 'ru'].includes(item.language)).slice(0, 30);
  if (limit) items = items.slice(0, limit);

  const languages = [...new Set(items.map((item) => item.language))].sort();
  console.log(
    `${items.length} items over ${languages.length} languages (${items.filter((i) => i.source === 'gold').length} gold, ${items.filter((i) => i.source === 'wild').length} wild)`,
  );
  if (validateOnly) {
    for (const language of languages) {
      const n = items.filter((i) => i.language === language).length;
      console.log(`  ${language.padEnd(8)} ${n}`);
    }
    return;
  }

  const openrouter = createOpenRouterFromEnv('pnpm eval:rendering');

  // Judge labels for the wild items (gold items already carry labels).
  const wild = items.filter((item) => item.source === 'wild');
  const judgeLabels = new Map<string, Prediction>();
  const wildByLanguage = groupBy(wild, (item) => item.language);
  await pool([...wildByLanguage.entries()], 3, async ([language, list]) => {
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const preds = await classifyBatch(
        openrouter,
        FLASH_JUDGE_MODEL,
        'product',
        language,
        chunk.map((item) => item.text),
      );
      chunk.forEach((item, j) => judgeLabels.set(item.id, preds[j]));
    }
  });
  for (const item of wild) {
    const label = judgeLabels.get(item.id);
    if (label) {
      item.expectedGender = label.gender;
      item.expectedPoliteness = label.politeness;
    }
  }

  // Candidates.
  type Cell = { hits: number; total: number };
  const results = new Map<string, Cell>(); // `${model}|${wording}|${axis}|${lang}|${source}`
  const cost = new Map<string, number>();
  const confusion = new Map<string, number>();
  function bump(key: string, hit: boolean) {
    const cell = results.get(key) ?? { hits: 0, total: 0 };
    cell.total++;
    if (hit) cell.hits++;
    results.set(key, cell);
  }
  const byLanguage = groupBy(items, (item) => item.language);
  const jobs: { model: string; wording: PromptWording; language: string; list: Item[] }[] = [];
  for (const modelKey of modelKeys)
    for (const wording of wordings)
      for (const [language, list] of byLanguage)
        jobs.push({ model: MODELS[modelKey], wording, language, list });

  await pool(jobs, 4, async (job) => {
    const axes = renderingAxesFor(job.language);
    for (let i = 0; i < job.list.length; i += BATCH) {
      const chunk = job.list.slice(i, i + BATCH);
      const before = bench.spentUsd;
      const preds = await classifyBatch(
        openrouter,
        job.model,
        job.wording,
        job.language,
        chunk.map((item) => item.text),
      );
      const costKey = `${job.model}|${job.wording}`;
      cost.set(costKey, (cost.get(costKey) ?? 0) + (bench.spentUsd - before));
      chunk.forEach((item, j) => {
        const pred = preds[j];
        if (axes.gender && item.expectedGender) {
          bump(`${job.model}|${job.wording}|gender|${job.language}|${item.source}`, pred?.gender === item.expectedGender);
          if (pred && pred.gender !== item.expectedGender) {
            const ck = `${job.model}|${job.wording}|gender|${item.expectedGender}->${pred.gender}`;
            confusion.set(ck, (confusion.get(ck) ?? 0) + 1);
          }
        }
        if (axes.politeness && item.expectedPoliteness) {
          bump(`${job.model}|${job.wording}|politeness|${job.language}|${item.source}`, pred?.politeness === item.expectedPoliteness);
          if (pred && pred.politeness !== item.expectedPoliteness) {
            const ck = `${job.model}|${job.wording}|politeness|${item.expectedPoliteness}->${pred.politeness}`;
            confusion.set(ck, (confusion.get(ck) ?? 0) + 1);
          }
        }
      });
    }
  });

  // Report.
  const lines: string[] = [];
  const out = (line = '') => {
    lines.push(line);
    console.log(line);
  };
  out(`\nRendering detection, ${items.length} items, judge ${FLASH_JUDGE_MODEL} for wild labels`);
  for (const axis of ['gender', 'politeness'] as const) {
    out(`\n== ${axis} ==`);
    out(`${'model'.padEnd(28)} ${'wording'.padEnd(11)} ${'gold'.padEnd(9)} ${'wild'.padEnd(9)} per language`);
    for (const modelKey of modelKeys) {
      for (const wording of wordings) {
        const model = MODELS[modelKey];
        const sum = (source: string) => {
          let hits = 0;
          let total = 0;
          for (const [key, cell] of results) {
            const [m, w, a, , s] = key.split('|');
            if (m === model && w === wording && a === axis && s === source) {
              hits += cell.hits;
              total += cell.total;
            }
          }
          return total ? `${((100 * hits) / total).toFixed(1)}% (${total})` : '-';
        };
        const perLanguage = languages
          .map((language) => {
            let hits = 0;
            let total = 0;
            for (const source of ['gold', 'wild']) {
              const cell = results.get(`${model}|${wording}|${axis}|${language}|${source}`);
              if (cell) {
                hits += cell.hits;
                total += cell.total;
              }
            }
            return total ? `${language}:${((100 * hits) / total).toFixed(0)}` : null;
          })
          .filter(Boolean)
          .join(' ');
        out(`${modelKey.padEnd(28)} ${wording.padEnd(11)} ${sum('gold').padEnd(9)} ${sum('wild').padEnd(9)} ${perLanguage}`);
      }
    }
  }
  out('\n== confusions (expected->predicted, count >= 2) ==');
  for (const [key, n] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) {
    if (n >= 2) out(`  ${key}: ${n}`);
  }
  out('\n== cost per 1000 rows ==');
  for (const [key, usd] of cost) {
    const rows = items.length;
    out(`  ${key}: ${fmtUsd((usd / rows) * 1000)}`);
  }
  out(`\nSpent ${fmtUsd(bench.spentUsd)} this run.`);
  bench.writeReport(lines, {
    results: Object.fromEntries(results),
    confusion: Object.fromEntries(confusion),
    cost: Object.fromEntries(cost),
  });
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

main().catch((err) => {
  bench.save();
  console.error(err);
  process.exit(1);
});
