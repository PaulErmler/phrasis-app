/**
 * TEMPORARY prototype — can a cheap model launder a DailyDialog exchange into
 * an original one at the same level? DailyDialog is CC BY-NC-SA, so the corpus
 * cannot ship; a loosely-related rewrite that cannot be traced back to its
 * source can. This measures whether the rewrite survives the vocabulary rule.
 *
 *   pnpm tsx --env-file=.env.local scripts/dialogue-rewrite-prototype.ts
 *
 * Reads the 1,556 vocabulary-legal candidates prepared for the placement
 * explorer, samples 100 with a fixed seed, and rewrites each one.
 * Writes .scratch/story-curriculum/rewrites.json.
 *
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';
import { openrouterCallOptions } from '../convex/features/translationLLM';

const MODEL = 'openai/gpt-oss-120b';
const REASONING = 'low' as const;
const MAX_OUTPUT_TOKENS = 4_000;
const SAMPLE = 100;
/**
 * `plain` is the prompt as first dictated. `capped` adds the one sentence that
 * names the failure it produced: the rewrites came back about a full CEFR band
 * harder than their sources, and only 29 of 100 stayed inside the learner's
 * vocabulary.
 */
const VARIANT = process.argv.includes('--variant=capped')
  ? 'capped'
  : process.argv.includes('--variant=easy')
    ? 'easy'
    : 'plain';
const CONCURRENCY = 16;

const SOURCE =
  '/private/tmp/claude-501/-Users-paulermler-Documents-Phrasis-new-phrasis-app/ec8851fd-5d43-489e-9508-7e59bd7eb732/scratchpad/dd_final.json';
const OUT_DIR = resolve(__dirname, '../.scratch/story-curriculum');

type Candidate = {
  id: number;
  turns: string[];
  nTurns: number;
  nWords: number;
  unlock: number;
  cefrMean: number;
  cefrTop10: number;
  cefrMax: number;
  zipfMean: number;
  zipfMin: number;
  ttr: number;
  rep: boolean;
};

/** Fixed seed, so the sample is the same on every run. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(items: T[], n: number, seed = 20260909): T[] {
  const rnd = mulberry32(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const prompt = (turns: string[]) =>
  [
    'Take this dialogue and write a new dialogue at a similar level, with',
    'similar vocabulary and difficulty, but that is only loosely related and',
    'cannot be traced back to the original dialogue.',
    ...(VARIANT === 'capped'
      ? [
          'Do not make the text more difficult and do not make it contain',
          'harder vocabulary.',
        ]
      : []),
    ...(VARIANT === 'easy' ? ['Use easy vocabulary.'] : []),
    '',
    ...turns.map((t, i) => `${i % 2 === 0 ? 'A' : 'B'}: ${t}`),
    '',
    'Answer with JSON and nothing else:',
    '{"turns": ["...", "..."]}',
  ].join('\n');

function parseTurns(raw: string): string[] {
  const body = raw.trim().replace(/^```(?:json)?/i, '');
  const obj = JSON.parse(
    body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1),
  ) as { turns: unknown };
  if (!Array.isArray(obj.turns)) throw new Error('no turns array');
  return obj.turns.map((t) =>
    String(t)
      .replace(/^[AB]\s*:\s*/, '')
      .trim(),
  );
}

async function pool<T>(jobs: (() => Promise<T>)[], limit: number) {
  const out = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, () =>
      (async () => {
        for (;;) {
          const i = next++;
          if (i >= jobs.length) return;
          out[i] = await jobs[i]();
        }
      })(),
    ),
  );
  return out;
}

async function main() {
  const all = (
    JSON.parse(readFileSync(SOURCE, 'utf8')) as {
      candidates: Candidate[];
    }
  ).candidates;
  const picked = sample(all, SAMPLE);
  console.log(`${all.length} candidates, sampling ${picked.length}`);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const openrouter = createOpenRouter({
    apiKey,
    extraBody: { usage: { include: true } },
  });
  const providerOptions = openrouterCallOptions(REASONING);

  let spendUsd = 0;
  let done = 0;
  const results = await pool(
    picked.map((c) => async () => {
      try {
        const res = await generateText({
          model: openrouter(MODEL),
          prompt: prompt(c.turns),
          temperature: 0.9,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...(providerOptions ? { providerOptions } : {}),
        });
        spendUsd += openrouterCostUsd(res.providerMetadata) ?? 0;
        const turns = parseTurns(res.text);
        if (++done % 20 === 0) console.log(`  ${done}/${picked.length}`);
        return {
          source: c,
          rewrite: turns,
          costUsd: openrouterCostUsd(res.providerMetadata),
          generationId: openrouterGenerationId(res.providerMetadata),
        };
      } catch (err) {
        console.log(
          `  id ${c.id} FAILED — ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
        return undefined;
      }
    }),
    CONCURRENCY,
  );

  const ok = results.filter((r) => r !== undefined);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(
      OUT_DIR,
      VARIANT === 'plain' ? 'rewrites.json' : `rewrites-${VARIANT}.json`,
    ),
    JSON.stringify({ model: MODEL, spendUsd, results: ok }, null, 1),
  );
  console.log(
    `\n${ok.length}/${picked.length} rewritten · $${spendUsd.toFixed(5)}`,
  );
  console.log(
    'wrote',
    resolve(
      OUT_DIR,
      VARIANT === 'plain' ? 'rewrites.json' : `rewrites-${VARIANT}.json`,
    ),
  );
}

void main();
