import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText, type JSONValue } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  AUTOFILL_MODEL,
  AUTOFILL_PROVIDER,
  AUTOFILL_REASONING,
  AUTOFILL_SYSTEM_PROMPT,
  autofillMaxOutputTokens,
  buildAutofillUserPrompt,
  parseAutofillResponse,
} from '../convex/lib/translationAutofillPrompt';
import { postProcessTranslation } from '../lib/languages';
import { CASES, type EvalCase } from './eval/translation-autofill-cases';

/**
 * Offline eval for the translation autofill (custom-card auto-translate).
 *
 *   pnpm eval:autofill                        one pass over every case
 *   pnpm eval:autofill --repeat=3             stability across reruns
 *   pnpm eval:autofill --variant=both         current prompt vs a candidate
 *   pnpm eval:autofill --models=a,b           two models through one harness
 *   pnpm eval:autofill --reasoning=minimal    reasoning effort override
 *   pnpm eval:autofill --case=idiom-cats-and-dogs   one case, reply printed
 *   pnpm eval:autofill --kind=register        one phenomenon class
 *
 * It builds the request from convex/lib/translationAutofillPrompt.ts, so it
 * grades through the same prompt, model, reasoning, and routing the action
 * ships. What it cannot see is the Convex side: auth, quota, mixed-dialect
 * resolution, and persistence live in the action and have unit tests instead.
 *
 * Checks are deliberately mechanical (exact JSON shape, script ranges,
 * per-case regexes, exact metadata match). They catch rule violations, not
 * whether a translation reads well — read the failures to judge that.
 * `--verbose` prints every reply.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

// ---------------------------------------------------------------------- args

type Args = {
  repeat: number;
  variant: 'current' | 'candidate' | 'both';
  concurrency: number;
  caseId?: string;
  kind?: string;
  models: string[];
  reasoning: string;
  temperature?: number;
  verbose: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) =>
    argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  const variantRaw = get('variant') ?? 'current';
  if (!['current', 'candidate', 'both'].includes(variantRaw)) {
    throw new Error(`--variant must be current, candidate, or both`);
  }
  const variant: Args['variant'] =
    variantRaw === 'candidate'
      ? 'candidate'
      : variantRaw === 'both'
        ? 'both'
        : 'current';
  return {
    repeat: Math.max(1, Number(get('repeat') ?? 1)),
    variant,
    concurrency: Math.max(1, Number(get('concurrency') ?? 4)),
    caseId: get('case'),
    kind: get('kind'),
    models: (get('models') ?? AUTOFILL_MODEL).split(',').filter(Boolean),
    reasoning: get('reasoning') ?? AUTOFILL_REASONING,
    temperature:
      get('temperature') === undefined ? undefined : Number(get('temperature')),
    verbose: argv.includes('--verbose'),
  };
}

const CANDIDATE_PATH = resolve(
  import.meta.dirname,
  'eval/autofill-candidate-prompt.txt',
);

function loadPrompts(variant: Args['variant']): [string, string][] {
  const candidate = () => {
    if (!existsSync(CANDIDATE_PATH)) {
      throw new Error(
        `No candidate prompt at ${CANDIDATE_PATH}. Write the prompt you want ` +
          `to compare there, or drop --variant.`,
      );
    }
    return readFileSync(CANDIDATE_PATH, 'utf8').trim();
  };
  if (variant === 'current') return [['current', AUTOFILL_SYSTEM_PROMPT]];
  if (variant === 'candidate') return [['candidate', candidate()]];
  return [
    ['current', AUTOFILL_SYSTEM_PROMPT],
    ['candidate', candidate()],
  ];
}

// -------------------------------------------------------------------- checks

/**
 * Script ranges auto-checked for every target that has an entry: the
 * translation must contain at least one character of its language's script.
 * A wrong-script (or English-echo) reply fails without needing a per-case
 * regex. Latin-script languages are not listed.
 */
const SCRIPTS: Record<string, RegExp> = {
  ja: /[぀-ヿ一-鿿]/,
  zh: /[一-鿿]/,
  zh_traditional: /[一-鿿]/,
  yue: /[一-鿿]/,
  yue_traditional: /[一-鿿]/,
  ko: /[가-힯]/,
  ru: /[Ѐ-ӿ]/,
  uk: /[Ѐ-ӿ]/,
  sr: /[Ѐ-ӿ]/,
  bg: /[Ѐ-ӿ]/,
  el: /[Ͱ-Ͽ]/,
  ar: /[؀-ۿ]/,
  ar_sa: /[؀-ۿ]/,
  ar_eg: /[؀-ۿ]/,
  ar_iq: /[؀-ۿ]/,
  ar_lev: /[؀-ۿ]/,
  fa: /[؀-ۿ]/,
  he: /[֐-׿]/,
  hi: /[ऀ-ॿ]/,
  bn: /[ঀ-৿]/,
  ta: /[஀-௿]/,
  te: /[ఀ-౿]/,
  th: /[฀-๿]/,
};

const METADATA_FIELDS = [
  'register',
  'addresseeNumber',
  'speakerGender',
  'addresseeGender',
  'addressesSomeone',
] as const;
type MetadataField = (typeof METADATA_FIELDS)[number];

type Failure = {
  caseId: string;
  kind: string;
  category: 'shape' | 'keys' | 'script' | 'check' | MetadataField;
  detail: string;
  why: string;
};

type CaseRun = {
  caseId: string;
  kind: string;
  pass: boolean;
  failures: Failure[];
  /** [checks passed, checks total] over keys+script+regex checks. */
  translationChecks: [number, number];
  /** Per scored metadata field: did it match. */
  metadata: Partial<Record<MetadataField, boolean>>;
  latencyMs: number;
  costUsd?: number;
  raw: string;
};

function gradeCase(
  c: EvalCase,
  raw: string,
  latencyMs: number,
  costUsd?: number,
): CaseRun {
  const failures: Failure[] = [];
  let checksPassed = 0;
  let checksTotal = 0;
  const metadataResults: Partial<Record<MetadataField, boolean>> = {};
  const fail = (category: Failure['category'], detail: string) =>
    failures.push({ caseId: c.id, kind: c.kind, category, detail, why: c.why });

  let parsed: ReturnType<typeof parseAutofillResponse>;
  try {
    parsed = parseAutofillResponse(raw);
  } catch (err) {
    fail('shape', err instanceof Error ? err.message : String(err));
    return {
      caseId: c.id,
      kind: c.kind,
      pass: false,
      failures,
      translationChecks: [0, 1],
      metadata: metadataResults,
      latencyMs,
      costUsd,
      raw,
    };
  }

  // Key set: exactly the requested targets, each non-empty.
  checksTotal += 1;
  const gotKeys = Object.keys(parsed.translations);
  const missing = c.targets.filter((t) => {
    const value = parsed.translations[t];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  const extra = gotKeys.filter((k) => !c.targets.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    fail('keys', `missing=[${missing.join(',')}] extra=[${extra.join(',')}]`);
  } else {
    checksPassed += 1;
  }

  for (const target of c.targets) {
    const rawText = parsed.translations[target];
    if (typeof rawText !== 'string' || rawText.trim().length === 0) continue;
    const text = postProcessTranslation(target, rawText.trim());

    const script = SCRIPTS[target];
    if (script) {
      checksTotal += 1;
      if (script.test(text)) {
        checksPassed += 1;
      } else {
        fail(
          'script',
          `${target}: no ${target}-script character in ${JSON.stringify(text)}`,
        );
      }
    }

    const check = c.checks?.[target];
    if (!check) continue;
    for (const re of check.mustMatch ?? []) {
      checksTotal += 1;
      if (re.test(text)) {
        checksPassed += 1;
      } else {
        fail('check', `${target}: expected ${re} in ${JSON.stringify(text)}`);
      }
    }
    for (const re of check.mustNotMatch ?? []) {
      checksTotal += 1;
      if (re.test(text)) {
        fail('check', `${target}: forbidden ${re} in ${JSON.stringify(text)}`);
      } else {
        checksPassed += 1;
      }
    }
  }

  for (const field of METADATA_FIELDS) {
    const expectation = c.expectMetadata?.[field];
    if (expectation === undefined) continue;
    const got = parsed.metadata[field];
    const allowed: (string | boolean)[] = Array.isArray(expectation)
      ? expectation
      : [expectation];
    const ok = allowed.includes(got);
    metadataResults[field] = ok;
    if (!ok) {
      fail(
        field,
        `expected ${JSON.stringify(allowed)}, got ${JSON.stringify(got)}`,
      );
    }
  }

  return {
    caseId: c.id,
    kind: c.kind,
    pass: failures.length === 0,
    failures,
    translationChecks: [checksPassed, checksTotal],
    metadata: metadataResults,
    latencyMs,
    costUsd,
    raw,
  };
}

// ---------------------------------------------------------------------- call

function providerOptionsFor(
  model: string,
  reasoning: string,
): Record<string, Record<string, JSONValue>> {
  const openrouterBody: Record<string, JSONValue> = {
    reasoning:
      reasoning === 'none' ? { enabled: false } : { effort: reasoning },
  };
  // The provider constraints (Luna price cap + Bedrock ordering) only make
  // sense for the production model; a Gemini candidate priced above the $2/M
  // completion cap would otherwise have every endpoint filtered away.
  if (model === AUTOFILL_MODEL && AUTOFILL_PROVIDER) {
    openrouterBody.provider = AUTOFILL_PROVIDER as JSONValue;
  }
  return { openrouter: openrouterBody };
}

function openrouterCostUsd(meta: unknown): number | undefined {
  if (meta === null || typeof meta !== 'object') return undefined;
  const or = (meta as Record<string, unknown>).openrouter;
  if (or === null || typeof or !== 'object') return undefined;
  const usage = (or as Record<string, unknown>).usage;
  if (usage === null || typeof usage !== 'object') return undefined;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === 'number' ? cost : undefined;
}

async function runCase(args: {
  c: EvalCase;
  systemPrompt: string;
  model: string;
  reasoning: string;
  temperature?: number;
  openrouter: ReturnType<typeof createOpenRouter>;
}): Promise<CaseRun> {
  const userPrompt = buildAutofillUserPrompt({
    texts: args.c.texts,
    resolvedTargets: args.c.targets,
  });
  const startedAt = Date.now();
  try {
    const { text, providerMetadata } = await generateText({
      model: args.openrouter(args.model),
      system: args.systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: autofillMaxOutputTokens(args.c.targets.length),
      providerOptions: providerOptionsFor(args.model, args.reasoning),
      ...(args.temperature === undefined
        ? {}
        : { temperature: args.temperature }),
    });
    return gradeCase(
      args.c,
      text,
      Date.now() - startedAt,
      openrouterCostUsd(providerMetadata),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      caseId: args.c.id,
      kind: args.c.kind,
      pass: false,
      failures: [
        {
          caseId: args.c.id,
          kind: args.c.kind,
          category: 'shape',
          detail: `request failed: ${message}`,
          why: args.c.why,
        },
      ],
      translationChecks: [0, 1],
      metadata: {},
      latencyMs: Date.now() - startedAt,
      raw: '',
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// -------------------------------------------------------------------- report

function pct(passed: number, total: number): string {
  if (total === 0) return '   —';
  return `${((100 * passed) / total).toFixed(0).padStart(3)}%`;
}

function report(label: string, runs: CaseRun[], verbose: boolean): void {
  const passed = runs.filter((r) => r.pass).length;
  const checks = runs.reduce(
    (acc, r) => [
      acc[0] + r.translationChecks[0],
      acc[1] + r.translationChecks[1],
    ],
    [0, 0],
  );
  console.log(`\n=== ${label}`);
  console.log(
    `cases ${passed}/${runs.length} (${pct(passed, runs.length)})  ` +
      `translation checks ${checks[0]}/${checks[1]} (${pct(checks[0], checks[1])})`,
  );

  const fieldLine = METADATA_FIELDS.map((field) => {
    const scored = runs.filter((r) => r.metadata[field] !== undefined);
    const ok = scored.filter((r) => r.metadata[field]).length;
    return `${field} ${ok}/${scored.length}`;
  }).join('  ');
  console.log(`metadata: ${fieldLine}`);

  const byKind = new Map<string, [number, number]>();
  for (const r of runs) {
    const entry = byKind.get(r.kind) ?? [0, 0];
    entry[1] += 1;
    if (r.pass) entry[0] += 1;
    byKind.set(r.kind, entry);
  }
  console.log(
    'by kind: ' +
      [...byKind.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, [ok, total]]) => `${kind} ${ok}/${total}`)
        .join('  '),
  );

  const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  const meanLatency =
    latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length);
  const costs = runs
    .map((r) => r.costUsd)
    .filter((c): c is number => c !== undefined);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  console.log(
    `latency mean ${Math.round(meanLatency)}ms  p90 ${latencies[Math.floor(latencies.length * 0.9)] ?? 0}ms  ` +
      `cost total $${totalCost.toFixed(4)} (${costs.length}/${runs.length} reported)`,
  );

  for (const r of runs) {
    if (r.pass && !verbose) continue;
    if (!r.pass) {
      console.log(`\n✗ ${r.caseId}`);
      for (const f of r.failures) {
        console.log(`    [${f.category}] ${f.detail}`);
      }
      console.log(`    why: ${r.failures[0]?.why}`);
    }
    if (verbose) {
      console.log(`  reply: ${r.raw}`);
    }
  }
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run via `pnpm eval:autofill` so tsx ' +
        'loads .env.local, or export the variable.',
    );
    process.exit(1);
  }
  const openrouter = createOpenRouter({
    apiKey,
    extraBody: { usage: { include: true } },
  });

  let cases = CASES;
  if (args.caseId) {
    cases = cases.filter((c) => c.id === args.caseId);
    if (cases.length === 0) throw new Error(`No case with id ${args.caseId}`);
  }
  if (args.kind) {
    cases = cases.filter((c) => c.kind === args.kind);
    if (cases.length === 0) throw new Error(`No cases of kind ${args.kind}`);
  }

  const prompts = loadPrompts(args.variant);
  console.log(
    `${cases.length} case(s) × ${prompts.length} prompt(s) × ` +
      `${args.models.length} model(s) × ${args.repeat} repeat(s), ` +
      `reasoning=${args.reasoning}` +
      (args.temperature === undefined
        ? ''
        : `, temperature=${args.temperature}`),
  );

  for (const [promptLabel, systemPrompt] of prompts) {
    for (const model of args.models) {
      const work: EvalCase[] = [];
      for (let i = 0; i < args.repeat; i++) work.push(...cases);
      const runs = await mapWithConcurrency(work, args.concurrency, (c) =>
        runCase({
          c,
          systemPrompt,
          model,
          reasoning: args.reasoning,
          temperature: args.temperature,
          openrouter,
        }),
      );
      report(`${promptLabel} · ${model}`, runs, args.verbose);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
