/**
 * TEMPORARY — a local prompt bench for the story feature. Draws random words
 * from the real catalogue, sends YOUR prompt to the same model the prototype
 * measured (google/gemini-3.8-flash:floor), and shows the story, the metrics
 * and the billed cost. Companion to scripts/story-prototype.ts.
 *
 *   pnpm tsx --env-file=.env.local scripts/story-tune.ts
 *   → http://127.0.0.1:5599
 *
 * Local-only by design: an artifact cannot reach OpenRouter (its CSP blocks
 * fetch to anything but the allowlisted CDNs), and the key must never leave
 * this process. The page talks only to this server; the key stays here.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { openrouterCostUsd } from '../convex/lib/posthogAi';
import {
  openrouterCallOptions,
  type ReasoningEffort,
} from '../convex/features/translationLLM';
import { LUNA_PROVIDER_CONSTRAINTS } from '../lib/languages';
import { tokenizeText } from '../lib/wordTokenize';
import { normalizeForComparison } from '../lib/textCompare/normalize';

/** Headroom for the answer AFTER thinking. `medium` and `high` spend ~7.7k
 *  tokens thinking about a 30-word dialogue, so the prototype's 8k cap left
 *  nothing for the reply and the call came back truncated. */
const MAX_OUTPUT_TOKENS = 32_000;

/**
 * The models worth putting this prompt in front of, and the thinking levels
 * each one actually accepts.
 *
 *  - Gemini has no "off": it rejects a disabled-reasoning request outright
 *    ("Reasoning is mandatory for this endpoint"), so `minimal` is its floor.
 *    The prototype ran everything at `minimal`, where it reports 0 thinking
 *    tokens.
 *  - Luna DOES take `none`, and that is load-bearing rather than a saving:
 *    it reasons adaptively unless thinking is explicitly disabled, and those
 *    hidden tokens are billed. Its provider constraints are production's
 *    (`LUNA_PROVIDER_CONSTRAINTS`) so routing and price cap match the real
 *    translation stage.
 */
const MODELS = {
  'gemini-3.8-flash': {
    slug: 'google/gemini-3.8-flash:floor',
    label: 'Gemini 3.8 Flash (:floor)',
    levels: ['minimal', 'low', 'medium', 'high'] as ReasoningEffort[],
    defaultLevel: 'minimal' as ReasoningEffort,
    provider: undefined,
  },
  'gpt-5.6-luna': {
    slug: 'openai/gpt-5.6-luna:nitro',
    label: 'GPT-5.6 Luna (:nitro)',
    levels: ['none', 'minimal', 'low', 'medium', 'high'] as ReasoningEffort[],
    defaultLevel: 'none' as ReasoningEffort,
    provider: LUNA_PROVIDER_CONSTRAINTS,
  },
} as const;
type ModelKey = keyof typeof MODELS;
const DEFAULT_MODEL: ModelKey = 'gemini-3.8-flash';

const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 5599);
const DATASET = resolve(
  __dirname,
  '../data_preparation/data/output/sentences_translated.csv',
);
const PAGE = resolve(__dirname, 'story-tune.html');

type Row = { difficulty: string; text: Record<string, string> };

const LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ja', 'zh', 'ar'];
const column = (lang: string) => (lang === 'en' ? 'text' : lang);

console.log('Loading catalogue…');
const rows: Row[] = (
  parse(readFileSync(DATASET, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as Record<string, string>[]
).map((r) => ({
  difficulty: r.difficulty || '?',
  text: Object.fromEntries(
    LANGS.filter((l) => r[column(l)]?.trim()).map((l) => [l, r[column(l)].trim()]),
  ),
}));
const BANDS = [...new Set(rows.map((r) => r.difficulty))].sort();
console.log(`${rows.length} rows, bands ${BANDS.join(', ')}`);

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error(
    'OPENROUTER_API_KEY is not set. Run via: pnpm tsx --env-file=.env.local scripts/story-tune.ts',
  );
  process.exit(1);
}
const openrouter = createOpenRouter({
  apiKey,
  extraBody: { usage: { include: true } },
});

let sessionSpendUsd = 0;

// --------------------------------------------------------------------- draw

function pick<T>(items: T[], n: number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

/**
 * Words come from CARDS, the way they would in the app: draw sentences from
 * one difficulty band, segment them, shuffle, keep `count`. The sentences ride
 * along so the page can show where the words came from — the model never
 * sees them.
 */
function draw(lang: string, band: string, count: number) {
  const pool = rows.filter((r) => r.difficulty === band && r.text[lang]);
  if (pool.length === 0) throw new Error(`no ${lang} rows in band ${band}`);
  const sources = pick(pool, 10).map((r) => ({
    target: r.text[lang],
    en: r.text.en ?? r.text[lang],
  }));
  const seen = new Map<string, string>();
  for (const s of sources) {
    for (const t of tokenizeText(s.target, lang)) {
      if (!seen.has(t.normalized)) seen.set(t.normalized, t.original);
    }
  }
  return { band, sources, words: pick([...seen.values()], count) };
}

// ----------------------------------------------------------------- generate

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in response');
  return JSON.parse(body.slice(start, end + 1));
}

function score(
  lang: string,
  lines: { text: string }[],
  words: string[],
  sources: { target: string }[],
) {
  const storyText = lines.map((l) => l.text).join(' ');
  const known = new Set(words.map((w) => w.toLowerCase()));
  const tokens = tokenizeText(storyText, lang);
  const usedWords = new Set<string>();
  const offCard: string[] = [];
  const seenOff = new Set<string>();
  for (const t of tokens) {
    if (known.has(t.normalized)) usedWords.add(t.normalized);
    else if (!seenOff.has(t.normalized)) {
      seenOff.add(t.normalized);
      offCard.push(t.original);
    }
  }
  const onCard = tokens.filter((t) => known.has(t.normalized)).length;
  const normalizedStory = normalizeForComparison(storyText);
  const verbatim = sources.filter((s) => {
    const needle = normalizeForComparison(s.target);
    return needle && normalizedStory.includes(needle);
  }).length;
  return {
    storyWords: tokens.length,
    wordsUsed: usedWords.size,
    wordsGiven: known.size,
    offCardShare: tokens.length === 0 ? 0 : 1 - onCard / tokens.length,
    offCard,
    verbatim,
  };
}

async function generate(body: {
  prompt: string;
  lang: string;
  words: string[];
  sources: { target: string }[];
  temperature?: number;
  reasoning?: string;
  model?: string;
}) {
  const key: ModelKey =
    body.model && body.model in MODELS ? (body.model as ModelKey) : DEFAULT_MODEL;
  const config = MODELS[key];
  const effort: ReasoningEffort = (
    config.levels as readonly ReasoningEffort[]
  ).includes(body.reasoning as ReasoningEffort)
    ? (body.reasoning as ReasoningEffort)
    : config.defaultLevel;
  const started = Date.now();
  const res = await generateText({
    model: openrouter(config.slug),
    prompt: body.prompt,
    temperature: body.temperature ?? 0.7,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // Production's own wiring, so 'none' means disabled-not-minimal here too.
    ...(() => {
      const opts = openrouterCallOptions(effort, config.provider);
      return opts ? { providerOptions: opts } : {};
    })(),
  });
  const costUsd = openrouterCostUsd(res.providerMetadata);
  sessionSpendUsd += costUsd ?? 0;

  let story: {
    title?: string;
    titleEn?: string;
    lines: { speaker: string; text: string; en: string }[];
  } | null = null;
  let parseError: string | undefined;
  try {
    const parsed = extractJson(res.text) as {
      title?: string;
      titleEn?: string;
      lines?: { speaker?: string; text?: string; en?: string }[];
    };
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      throw new Error('no lines[] in the JSON');
    }
    story = {
      title: parsed.title,
      titleEn: parsed.titleEn,
      lines: parsed.lines.map((l) => ({
        speaker: String(l?.speaker ?? ''),
        text: String(l?.text ?? ''),
        en: String(l?.en ?? ''),
      })),
    };
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }
  // A truncated reply is the usual reason the JSON won't parse at the higher
  // thinking levels; say so instead of leaving a bare syntax error.
  if (parseError && res.finishReason === 'length') {
    parseError = `the reply hit the ${MAX_OUTPUT_TOKENS}-token cap before it finished (${res.usage?.reasoningTokens ?? 0} of those went on thinking)`;
  }

  return {
    story,
    parseError,
    truncated: res.finishReason === 'length',
    raw: res.text,
    costUsd,
    sessionSpendUsd,
    reasoning: effort,
    model: key,
    modelSlug: config.slug,
    latencyMs: Date.now() - started,
    inputTokens: res.usage?.inputTokens ?? 0,
    // Billed inside outputTokens; broken out so the cost of raising the
    // thinking level is visible rather than buried in the total.
    reasoningTokens: res.usage?.reasoningTokens ?? 0,
    outputTokens: res.usage?.outputTokens ?? 0,
    metrics: story ? score(body.lang, story.lines, body.words, body.sources) : null,
  };
}

// -------------------------------------------------------------------- serve

function json(res: import('node:http').ServerResponse, status: number, data: unknown) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (url.pathname === '/') {
      // Re-read per request so editing the page needs no server restart.
      const html = readFileSync(PAGE, 'utf8')
        .replace('__LANGS__', JSON.stringify(LANGS))
        .replace('__BANDS__', JSON.stringify(BANDS))
        .replace('__MODELS__', JSON.stringify(MODELS))
        .replace('__DEFAULT_MODEL__', JSON.stringify(DEFAULT_MODEL));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname === '/api/draw') {
      const lang = url.searchParams.get('lang') ?? 'de';
      const band = url.searchParams.get('band') ?? BANDS[0];
      const count = Number(url.searchParams.get('count') ?? 20);
      json(res, 200, draw(lang, band, count));
      return;
    }
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      json(res, 200, await generate(body));
      return;
    }
    res.writeHead(404).end('not found');
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nStory prompt bench → http://127.0.0.1:${PORT}`);
  console.log(
    `Models: ${Object.values(MODELS)
      .map((m) => m.slug)
      .join(', ')}  ·  ctrl-c to stop`,
  );
});
