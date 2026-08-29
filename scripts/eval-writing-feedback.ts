import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  buildGraderUserPrompt,
  GRADER_MAX_OUTPUT_TOKENS,
  GRADER_MODEL,
  GRADER_PROVIDER,
  GRADER_REASONING,
  GRADER_RESPONSE_FORMAT,
  GRADER_SYSTEM_PROMPT,
  MAX_NOTES,
  parseFeedbackResponse,
  type ParsedFeedback,
} from '../convex/lib/writingFeedbackPrompt';
import { CASES, type EvalCase } from './eval/writing-feedback-cases';

/**
 * Offline eval for the writing-feedback grader.
 *
 *   pnpm eval:feedback                       one pass over every case
 *   pnpm eval:feedback --repeat=3            verdict stability across reruns
 *   pnpm eval:feedback --variant=both        current prompt vs a candidate
 *   pnpm eval:feedback --models=a,b          two models through one harness
 *   pnpm eval:feedback --sort=throughput     route by throughput, not by slug
 *   pnpm eval:feedback --temperature=0       the action passes none, so this
 *                                            measures what the default costs
 *   pnpm eval:feedback --case=trap-nuance-de-en    one case, full reply printed
 *
 * It builds the request from convex/lib/writingFeedbackPrompt.ts, so it grades
 * through the same prompt, schema, model, and routing the action ships. What
 * it cannot see is the Convex side: quota, the local exact-match gate, and
 * alternative storage all live in the action and have unit tests instead.
 *
 * Checks are deliberately mechanical. They catch rule violations (wrong
 * verdict, note in the wrong language, Markdown in plain-text prose, a BASE
 * word offered as the fix), not whether a note reads well — read the failures
 * to judge that. `--verbose` prints every reply.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

// ---------------------------------------------------------------------- args

type Args = {
  repeat: number;
  variant: 'current' | 'candidate' | 'both';
  concurrency: number;
  caseId?: string;
  lang?: string;
  models: string[];
  sort?: string;
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
  const variant = (get('variant') ?? 'current') as Args['variant'];
  if (!['current', 'candidate', 'both'].includes(variant)) {
    throw new Error(`--variant must be current, candidate, or both`);
  }
  return {
    repeat: Math.max(1, Number(get('repeat') ?? 1)),
    variant,
    concurrency: Math.max(1, Number(get('concurrency') ?? 4)),
    caseId: get('case'),
    lang: get('lang'),
    models: (get('models') ?? GRADER_MODEL).split(',').filter(Boolean),
    sort: get('sort'),
    temperature:
      get('temperature') === undefined ? undefined : Number(get('temperature')),
    verbose: argv.includes('--verbose'),
  };
}

const CANDIDATE_PATH = resolve(
  import.meta.dirname,
  'eval/candidate-prompt.txt',
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
  if (variant === 'current') return [['current', GRADER_SYSTEM_PROMPT]];
  if (variant === 'candidate') return [['candidate', candidate()]];
  return [
    ['current', GRADER_SYSTEM_PROMPT],
    ['candidate', candidate()],
  ];
}

// -------------------------------------------------------------------- checks

/**
 * Script ranges for the languages whose notes or answers we can verify
 * mechanically. A Latin-script language is not listed: `notesLanguage` for
 * those falls back to the English-stopword heuristic below, which only claims
 * "suspect", never "wrong".
 */
const SCRIPTS: Record<string, RegExp> = {
  ja: /[\u3040-\u30FF\u4E00-\u9FFF]/,
  zh: /[\u4E00-\u9FFF]/,
  yue: /[\u4E00-\u9FFF]/,
  ko: /[\uAC00-\uD7AF]/,
  ru: /[\u0400-\u04FF]/,
  uk: /[\u0400-\u04FF]/,
  bg: /[\u0400-\u04FF]/,
  sr: /[\u0400-\u04FF]/,
  el: /[\u0370-\u03FF]/,
  he: /[\u0590-\u05FF]/,
  ar: /[\u0620-\u064A]/,
  fa: /[\u0620-\u06CC]/,
  hi: /[\u0900-\u097F]/,
  bn: /[\u0980-\u09FF]/,
  ta: /[\u0B80-\u0BFF]/,
  te: /[\u0C00-\u0C7F]/,
  th: /[\u0E00-\u0E7F]/,
};

/**
 * Regional and script variants share a script with their base code, except
 * zh_traditional, which is deliberately a different set of characters from
 * zh — so the base code is the right key for everything but that pair.
 */
function scriptFor(code: string): RegExp | undefined {
  return SCRIPTS[code] ?? SCRIPTS[code.split('_')[0]];
}

/** Function words common enough that their absence is meaningful in prose. */
const ENGLISH_MARKERS =
  /\b(the|is|are|which|that|your|means|instead|would|should|word)\b/i;

const MARKUP = [
  { label: 'bold/italic', re: /\*\*|__|(?<!\w)\*\w|(?<!\w)_\w/ },
  { label: 'code fence', re: /`/ },
  { label: 'list bullet', re: /^\s*[-*•]\s/ },
  { label: 'emoji', re: /[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]/u },
  { label: 'brackets', re: /[[\]{}]/ },
];

/** Quoted words are TARGET by design, so they cannot signal the notes language. */
function withoutQuotes(prose: string): string {
  return prose.replace(/["“”„«»「」][^"“”„«»「」]*["“”„«»「」]/g, ' ');
}

/** A note that only reports one word replacing another. */
const BARE_SWAP =
  /^\s*["'“„«]?[^"'”»]{1,25}["'”»']?\s+(instead of|rather than|statt|not)\s+["'“„«]/i;

type Check = { label: string; ok: boolean; detail?: string };

function checkReply(
  c: EvalCase,
  parsed: ParsedFeedback | null,
  raw: string,
): Check[] {
  const checks: Check[] = [];
  const add = (label: string, ok: boolean, detail?: string) =>
    checks.push({ label, ok, detail });

  if (!parsed) {
    add('schema', false, `unparseable: ${raw.slice(0, 120)}`);
    return checks;
  }
  add('schema', true);

  const accepted = [c.expectVerdict, ...(c.alsoAcceptable ?? [])];
  add(
    'verdict',
    accepted.includes(parsed.verdict),
    `got ${parsed.verdict}, wanted ${accepted.join('|')}`,
  );

  add(
    'noteCount',
    parsed.notes.length <= MAX_NOTES &&
      (parsed.verdict !== 'alsoCorrect' || parsed.notes.length >= 1),
    `${parsed.notes.length} notes`,
  );

  if (c.expectNoteType) {
    const wanted = [c.expectNoteType].flat();
    const types = parsed.notes.map((n) => n.type);
    add(
      'noteType',
      types.some((t) => wanted.includes(t)),
      `got ${types.join(',') || 'none'}, wanted ${wanted.join('|')}`,
    );
  }

  if (c.expectAltOk !== undefined) {
    add('altOk', parsed.altOk === c.expectAltOk, `got ${parsed.altOk}`);
  }
  // altOk on any other verdict is meaningless and would store a wrong answer.
  add(
    'altOkVerdict',
    !parsed.altOk || parsed.verdict === 'alsoCorrect',
    `altOk true on ${parsed.verdict}`,
  );

  const prose = parsed.notes.map((n) => n.text).join('\n');

  const notesScript = scriptFor(c.notesLanguage);
  if (notesScript && prose) {
    add(
      'notesLanguage',
      notesScript.test(prose),
      `no ${c.notesLanguage} script in the note prose`,
    );
  } else if (prose && c.notesLanguage !== 'en') {
    // Weak signal, so it only reports. English function words in prose that
    // should be another Latin-script language is the drift we are watching.
    const suspect = ENGLISH_MARKERS.test(withoutQuotes(prose));
    add('notesLanguage?', !suspect, suspect ? 'reads as English' : undefined);
  }

  const targetScript = scriptFor(c.targetLanguage);
  if (targetScript && parsed.corrected) {
    add(
      'correctedScript',
      targetScript.test(parsed.corrected),
      `"${parsed.corrected}" is not in the ${c.targetLanguage} script`,
    );
  }

  for (const { label, re } of MARKUP) {
    const hit = parsed.notes.find((n) => re.test(n.text));
    if (hit) add(`plainText:${label}`, false, hit.text.slice(0, 80));
  }
  if (!MARKUP.some(({ re }) => parsed.notes.some((n) => re.test(n.text)))) {
    add('plainText', true);
  }

  const swap = parsed.notes.find((n) => BARE_SWAP.test(n.text));
  add('bareSwap', !swap, swap?.text);

  if (c.mustNotMention) {
    const leaked = c.mustNotMention.filter((w) =>
      prose.toLowerCase().includes(w.toLowerCase()),
    );
    add('mustNotMention', leaked.length === 0, leaked.join(', '));
  }
  if (c.mustMention) {
    const found = c.mustMention.some((w) =>
      prose.toLowerCase().includes(w.toLowerCase()),
    );
    add('mustMention', found, `none of ${c.mustMention.join(', ')}`);
  }

  // `corrected` drives the diff the learner reads. Rewriting a near-correct
  // answer wholesale turns that diff into noise.
  const fellBackToExpected =
    parsed.corrected?.trim().replace(/\s+/g, ' ') ===
    c.expected.trim().replace(/\s+/g, ' ');
  if (
    parsed.corrected &&
    parsed.verdict === 'minor' &&
    c.answer.length > 12 &&
    !fellBackToExpected
  ) {
    const ratio = changedRatio(c.answer, parsed.corrected);
    add(
      'minimalEdit',
      ratio <= 0.5,
      `${Math.round(ratio * 100)}% of the answer's words changed`,
    );
  }

  return checks;
}

/** Scripts written without spaces, where word-splitting says nothing useful. */
const UNSPACED = /[぀-ヿ一-鿿가-힯฀-๿]/;

/** Share of the answer's words that are not in `corrected`. Order-insensitive. */
function changedRatio(answer: string, corrected: string): number {
  if (UNSPACED.test(answer)) return characterChangedRatio(answer, corrected);
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(Boolean);
  const before = words(answer);
  if (before.length === 0) return 0;
  const after = new Set(words(corrected));
  return before.filter((w) => !after.has(w)).length / before.length;
}

/** Same idea, per character, for scripts that do not separate words. */
function characterChangedRatio(answer: string, corrected: string): number {
  const chars = [...answer.replace(/\s/g, '')];
  if (chars.length === 0) return 0;
  const after = new Set([...corrected.replace(/\s/g, '')]);
  return chars.filter((ch) => !after.has(ch)).length / chars.length;
}

// ---------------------------------------------------------------------- run

type Run = {
  variant: string;
  case: EvalCase;
  attempt: number;
  parsed: ParsedFeedback | null;
  raw: string;
  checks: Check[];
  latencyMs: number;
  finishReason?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
};

async function grade(
  system: string,
  model: string,
  c: EvalCase,
  sort?: string,
  temperature?: number,
): Promise<Omit<Run, 'variant' | 'case' | 'attempt' | 'checks'>> {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY!,
    extraBody: {
      usage: { include: true },
      response_format: GRADER_RESPONSE_FORMAT,
    },
  });
  const startedAt = Date.now();
  try {
    const { text, usage, providerMetadata, finishReason } = await generateText({
      model: openrouter(model),
      system,
      prompt: buildGraderUserPrompt({
        baseLanguage: c.baseLanguage,
        targetLanguage: c.targetLanguage,
        notesLanguage: c.notesLanguage,
        baseText: c.baseText,
        expected: c.expected,
        metadata: c.metadata ?? {},
        userAnswer: c.answer,
      }),
      maxOutputTokens: GRADER_MAX_OUTPUT_TOKENS,
      ...(temperature === undefined ? {} : { temperature }),
      providerOptions: {
        openrouter: {
          reasoning: { effort: GRADER_REASONING },
          provider: providerRouting(sort),
        },
      },
    });
    const or = providerMetadata?.openrouter as
      | { usage?: { cost?: number } }
      | undefined;
    return {
      parsed: parseFeedbackResponse(text),
      raw: text,
      latencyMs: Date.now() - startedAt,
      finishReason,
      costUsd: or?.usage?.cost,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    };
  } catch (error) {
    return {
      parsed: null,
      raw: '',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * `sort` and `order` conflict on OpenRouter, so choosing a sort drops the slug
 * pin. The price ceiling and require_parameters stay either way: a model that
 * cannot honor response_format must not quietly serve prose instead.
 */
function providerRouting(sort?: string) {
  if (!sort) return GRADER_PROVIDER;
  const { order: _order, ...rest } = GRADER_PROVIDER;
  return { ...rest, sort };
}

/** Run `tasks` with at most `limit` in flight, preserving input order. */
async function pooled<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

// ------------------------------------------------------------------- report

function pct(n: number, d: number) {
  return d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(0).padStart(4)}%`;
}

function report(runs: Run[], args: Args) {
  const variants = [...new Set(runs.map((r) => r.variant))];

  for (const variant of variants) {
    const mine = runs.filter((r) => r.variant === variant);
    const failed = mine.filter((r) => r.checks.some((c) => !c.ok));

    console.log(`\n${'═'.repeat(72)}`);
    console.log(`  ${variant}  ·  ${mine.length} runs`);
    console.log('═'.repeat(72));

    const labels = [
      ...new Set(mine.flatMap((r) => r.checks.map((c) => c.label))),
    ];
    for (const label of labels.sort()) {
      const rel = mine.flatMap((r) =>
        r.checks.filter((c) => c.label === label),
      );
      const ok = rel.filter((c) => c.ok).length;
      const bar = ok === rel.length ? '·' : '!';
      console.log(
        `  ${bar} ${label.padEnd(18)} ${pct(ok, rel.length)}  (${ok}/${rel.length})`,
      );
    }

    const clean = mine.filter((r) => r.checks.every((c) => c.ok)).length;
    console.log(
      `\n  clean runs ${pct(clean, mine.length)}  (${clean}/${mine.length})`,
    );

    const latencies = mine.map((r) => r.latencyMs).sort((a, b) => a - b);
    const cost = mine.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const inTok = mine.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
    const outTok = mine.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);
    const per1k = (cost / mine.length) * 1000;
    console.log(
      `  latency p50 ${latencies[Math.floor(latencies.length / 2)]}ms · ` +
        `p95 ${latencies[Math.floor(latencies.length * 0.95)]}ms · ` +
        `tokens ${Math.round(inTok / mine.length)}in/` +
        `${Math.round(outTok / mine.length)}out per grade`,
    );
    console.log(
      `  cost $${cost.toFixed(4)} this run · ` +
        `$${per1k.toFixed(2)} per 1,000 graded answers`,
    );

    const groups: [string, (r: Run) => string][] = [
      ['target language', (r) => r.case.targetLanguage],
      ['notes language', (r) => r.case.notesLanguage],
      ['level', (r) => r.case.cefr],
      ['error class', (r) => r.case.kind],
    ];
    for (const [title, key] of groups) {
      const buckets = new Map<string, Run[]>();
      for (const r of mine) {
        const k = key(r);
        buckets.set(k, [...(buckets.get(k) ?? []), r]);
      }
      if (buckets.size < 2) continue;
      const order = title === 'level' ? ['A1', 'A2', 'B1', 'B2', 'C1'] : null;
      const keys = [...buckets.keys()].sort((a, b) =>
        order ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b),
      );
      console.log(`\n  by ${title}:`);
      console.log(
        '   ' +
          keys
            .map((k) => {
              const runs = buckets.get(k)!;
              const clean = runs.filter((r) =>
                r.checks.every((c) => c.ok),
              ).length;
              return `${k} ${clean}/${runs.length}`;
            })
            .join('  ·  '),
      );
    }

    if (args.repeat > 1) {
      // Same input, same prompt, N times. Anything below 100% is sampling
      // noise the learner sees as a different grade on a rerun.
      const byCase = new Map<string, string[]>();
      for (const r of mine) {
        const list = byCase.get(r.case.id) ?? [];
        list.push(r.parsed?.verdict ?? 'error');
        byCase.set(r.case.id, list);
      }
      const stable = [...byCase.values()].filter(
        (v) => new Set(v).size === 1,
      ).length;
      console.log(
        `  verdict stability ${pct(stable, byCase.size)} ` +
          `(${stable}/${byCase.size} cases identical across ${args.repeat} runs)`,
      );
      for (const [id, verdicts] of byCase) {
        if (new Set(verdicts).size > 1) {
          console.log(`      ${id}: ${verdicts.join(' / ')}`);
        }
      }
    }

    if (failed.length) {
      console.log(`\n  ${failed.length} run(s) with failing checks:\n`);
      for (const r of failed) {
        console.log(
          `  ── ${r.case.id}${args.repeat > 1 ? ` #${r.attempt}` : ''}`,
        );
        console.log(`     ${r.case.why}`);
        if (r.error) console.log(`     transport: ${r.error}`);
        if (!r.raw)
          console.log(
            `     empty reply · finishReason=${r.finishReason} · ` +
              `${r.outputTokens ?? '?'} output tokens`,
          );
        for (const c of r.checks.filter((c) => !c.ok)) {
          console.log(`     ✗ ${c.label}${c.detail ? `: ${c.detail}` : ''}`);
        }
        if (r.parsed) {
          console.log(
            `     → ${r.parsed.verdict}` +
              (r.parsed.altOk ? ' +altOk' : '') +
              (r.parsed.corrected ? ` · "${r.parsed.corrected}"` : ''),
          );
          for (const n of r.parsed.notes) {
            console.log(`       [${n.type}] ${n.text}`);
          }
        }
        console.log();
      }
    }
  }

  if (args.verbose) {
    console.log(`\n${'═'.repeat(72)}\n  every reply\n${'═'.repeat(72)}`);
    for (const r of runs) {
      console.log(`\n  ${r.variant} · ${r.case.id}`);
      console.log(`  ${r.raw || r.error}`);
    }
  }
}

// --------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run via `pnpm eval:feedback`, which ' +
        'loads .env.local, or export it yourself.',
    );
    process.exit(1);
  }

  let cases = CASES;
  if (args.caseId) cases = cases.filter((c) => c.id === args.caseId);
  if (args.lang) {
    cases = cases.filter(
      (c) =>
        c.targetLanguage === args.lang ||
        c.baseLanguage === args.lang ||
        c.notesLanguage === args.lang,
    );
  }
  if (cases.length === 0) {
    console.error(`No case matched --case/--lang.`);
    console.error(`Known ids: ${CASES.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }

  const prompts = loadPrompts(args.variant);
  const plan: {
    variant: string;
    system: string;
    model: string;
    case: EvalCase;
    attempt: number;
  }[] = [];
  for (const [promptName, system] of prompts) {
    for (const model of args.models) {
      // Only disambiguate on an axis that actually varies, so a single-model
      // prompt comparison keeps its short labels.
      const variant =
        [
          prompts.length > 1 ? promptName : null,
          args.models.length > 1 ? model.replace(/^openai\//, '') : null,
        ]
          .filter(Boolean)
          .join(' · ') || promptName;
      for (const c of cases) {
        for (let attempt = 1; attempt <= args.repeat; attempt++) {
          plan.push({ variant, system, model, case: c, attempt });
        }
      }
    }
  }

  console.log(
    `${plan.length} calls · ${cases.length} cases × ${args.repeat} ` +
      `× ${prompts.length} prompt(s) × ${args.models.length} model(s)` +
      (args.sort ? ` · routing by ${args.sort}` : '') +
      (args.temperature === undefined
        ? ''
        : ` · temperature ${args.temperature}`),
  );

  let done = 0;
  const runs = await pooled(
    plan.map((p) => async () => {
      const result = await grade(
        p.system,
        p.model,
        p.case,
        args.sort,
        args.temperature,
      );
      process.stdout.write(`\r  ${++done}/${plan.length}`);
      return {
        ...result,
        variant: p.variant,
        case: p.case,
        attempt: p.attempt,
        checks: checkReply(
          p.case,
          result.parsed,
          result.raw || (result.error ?? ''),
        ),
      };
    }),
    args.concurrency,
  );
  process.stdout.write('\r');

  report(runs, args);

  const anyFailed = runs.some((r) => r.checks.some((c) => !c.ok));
  process.exit(anyFailed ? 1 : 0);
}

void main();
