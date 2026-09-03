/**
 * Shared scaffolding for the translation benches: the OpenRouter client, the
 * JSON result cache with its running budget guard, the cached translate call
 * that mirrors production (`translateTextWithLLM` / `translateBestOfN`), the
 * Gemini judge call, and the small helpers (worker pool, seeded shuffle, CLI
 * flag parsing, report files). The per-bench scripts own only what differs:
 * the dataset, the conditions, the judge prompt and the report layout.
 *
 * Nothing here opens .env.local; the key is read from the environment by name.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  translateTextWithLLM,
  translateBestOfN,
  openrouterCallOptions,
  type TranslationPromptArgs,
  type LlmCallTelemetry,
  type ReasoningEffort,
} from '../../../convex/features/translationLLM';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../../../convex/lib/posthogAi';
import type { ModelStage } from '../../../lib/languages';

// ------------------------------------------------------------------- judge

/** Gemini 3.1 Pro: a different model family than every candidate, to avoid
 *  self-preference. */
export const JUDGE_MODEL = 'google/gemini-3.1-pro-preview';
export const JUDGE_REASONING: ReasoningEffort = 'low';
export const JUDGE_MAX_OUTPUT_TOKENS = 4_000;

// ------------------------------------------------------------------- types

export type CallTelemetry = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  latencyMs: number;
  role?: string;
  generationId?: string;
};

export type CallRecord = {
  text: string | null; // null = the stage failed
  failReason?: string;
  failDetail?: string;
  telemetry: CallTelemetry[];
};

/** Keyed `${condition}|${lang}|${item}` for translations and
 *  `judge|${lang}|${item}` for verdicts (scores JSON in `text`). */
export type Cache = Record<string, CallRecord>;

export type JudgeOutcome = {
  scores: Record<string, number>; // candidate text -> score
  telemetry: CallTelemetry[];
};

export type OpenRouterClient = ReturnType<typeof createOpenRouter>;

// ------------------------------------------------------------------- bench

/**
 * One bench run: its output directory, the result cache under it, and the
 * budget guard. Created at module scope so `main().catch` can still flush
 * the cache after a failure.
 */
export class Bench {
  readonly outDir: string;
  readonly cache: Cache;
  budgetUsd: number;
  spentUsd = 0;
  private readonly cachePath: string;
  private readonly budgetHint: string;

  constructor(opts: { outDir: string; budgetUsd: number; budgetHint: string }) {
    this.outDir = opts.outDir;
    this.cachePath = resolve(opts.outDir, 'cache.json');
    this.budgetUsd = opts.budgetUsd;
    this.budgetHint = opts.budgetHint;
    this.cache = existsSync(this.cachePath)
      ? (JSON.parse(readFileSync(this.cachePath, 'utf8')) as Cache)
      : {};
  }

  save(): void {
    mkdirSync(this.outDir, { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 1));
  }

  /** Add to the running total; abort (cache saved) once it passes the budget. */
  recordSpend(telemetry: { costUsd?: number }[]): void {
    for (const t of telemetry) this.spentUsd += t.costUsd ?? 0;
    if (this.spentUsd > this.budgetUsd) {
      this.save();
      console.error(
        `\nBUDGET GUARD: spent $${this.spentUsd.toFixed(3)} > $${this.budgetUsd}. ` +
          `Cache saved; ${this.budgetHint}.`,
      );
      process.exit(2);
    }
  }

  /** The cached record for `key`, or a fresh production-shaped call. */
  async translateCached(
    key: string,
    stage: ModelStage,
    args: TranslationPromptArgs,
  ): Promise<CallRecord> {
    const hit = this.cache[key];
    if (hit) return hit;
    const record = await translateWithStage(stage, args);
    this.cache[key] = record;
    this.recordSpend(record.telemetry);
    return record;
  }

  /** The judge's cached scores for an item, empty when it was never judged. */
  judgeScores(judgeKey: string): Record<string, number> {
    const raw = this.cache[judgeKey]?.text;
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  }

  /** True when every candidate already has a cached verdict, so the item
   *  need not be re-judged (a new condition's output is what forces one). */
  hasJudgedAll(judgeKey: string, candidates: Iterable<string>): boolean {
    if (!this.cache[judgeKey]) return false;
    const scores = this.judgeScores(judgeKey);
    for (const text of candidates) if (scores[text] === undefined) return false;
    return true;
  }

  storeJudge(judgeKey: string, outcome: JudgeOutcome): void {
    this.cache[judgeKey] = {
      text: JSON.stringify(outcome.scores),
      telemetry: outcome.telemetry,
    };
    this.save();
  }

  /** `report.txt` (what was printed) and `aggregates.json` under the out dir. */
  writeReport(lines: string[], aggregates: unknown): void {
    mkdirSync(this.outDir, { recursive: true });
    writeFileSync(resolve(this.outDir, 'report.txt'), lines.join('\n') + '\n');
    writeFileSync(
      resolve(this.outDir, 'aggregates.json'),
      JSON.stringify(aggregates, null, 2),
    );
    console.log(`\nWrote ${this.outDir}/report.txt and aggregates.json`);
  }
}

// ------------------------------------------------------------- translation

function slimTelemetry(
  list: (LlmCallTelemetry & { role?: string })[],
): CallTelemetry[] {
  return list.map((t) => ({
    model: t.model,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    costUsd: t.costUsd,
    latencyMs: t.latencyMs,
    role: t.role,
  }));
}

/** One translation through the real pipeline: best-of-N when the stage
 *  samples, a single call otherwise. Never throws for a failed stage; the
 *  record says why. */
export async function translateWithStage(
  stage: ModelStage,
  args: TranslationPromptArgs,
): Promise<CallRecord> {
  if (stage.samples) {
    const res = await translateBestOfN({ ...args, stage });
    return {
      text: res.result.ok ? res.result.text : null,
      ...(res.result.ok ? {} : { failReason: res.result.reason }),
      telemetry: slimTelemetry(res.telemetryList),
    };
  }
  const res = await translateTextWithLLM({
    ...args,
    model: stage.model,
    reasoning: stage.reasoning,
    maxOutputTokens: stage.maxOutputTokens,
    provider: stage.provider,
  });
  return {
    text: res.ok ? res.text : null,
    ...(res.ok
      ? {}
      : { failReason: res.reason, failDetail: res.detail?.slice(0, 300) }),
    telemetry: res.telemetry ? slimTelemetry([res.telemetry]) : [],
  };
}

// ------------------------------------------------------------------- judge

/** The `<context>` lines every scoring prompt opens with. */
export function contextLines(args: TranslationPromptArgs): string[] {
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
  return ctx;
}

/**
 * Ask the judge for one integer score per candidate, in the order given
 * (shuffle before calling so the order carries no condition signal). Three
 * attempts; null when none parsed. Spend is recorded on every attempt.
 */
export async function judgeCandidates(
  bench: Bench,
  openrouter: OpenRouterClient,
  prompt: string,
  candidates: string[],
  label?: string,
): Promise<JudgeOutcome | null> {
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
      const telemetry: CallTelemetry[] = [
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
      bench.recordSpend(telemetry);
      const match = res.text.match(/\[[\s\d,.]*\]/);
      if (!match) throw new Error(`unparseable: ${res.text.slice(0, 80)}`);
      const parsed = JSON.parse(match[0]) as number[];
      if (parsed.length !== candidates.length) {
        throw new Error(
          `expected ${candidates.length} scores, got ${parsed.length}`,
        );
      }
      const scores: Record<string, number> = {};
      candidates.forEach((text, i) => (scores[text] = parsed[i]));
      return { scores, telemetry };
    } catch (err) {
      console.warn(
        `  judge attempt ${attempt} failed${label ? ` (${label})` : ''}: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
      );
    }
  }
  return null;
}

// ----------------------------------------------------------------- helpers

/** OpenRouter client with usage accounting on, or exit 1 with the run hint. */
export function createOpenRouterFromEnv(runHint: string): OpenRouterClient {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(`OPENROUTER_API_KEY is not set. Run via: ${runHint}`);
    process.exit(1);
  }
  return createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    extraBody: { usage: { include: true } },
  });
}

/** The value of `--name=value` in argv, or undefined. */
export function argValue(argv: string[], name: string): string | undefined {
  return argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

/** Run `fn` over `items` with at most `concurrency` in flight. */
export async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
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

/** Seeded shuffle (same scheme as translationLLM's) so reruns re-judge identically. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
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

export function fmtUsd(x: number): string {
  return `$${x.toFixed(4)}`;
}
