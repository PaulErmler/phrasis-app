/**
 * TEMPORARY prototype — "story after N drilled cards" (Pierre Boralevi's
 * suggestion, Jul 2026). Not wired into the app; delete when the question is
 * answered.
 *
 *   pnpm tsx --env-file=.env.local scripts/story-prototype.ts --dry
 *   pnpm tsx --env-file=.env.local scripts/story-prototype.ts
 *   pnpm tsx --env-file=.env.local scripts/story-prototype.ts --langs=en,de,fr
 *   pnpm tsx --env-file=.env.local scripts/story-prototype.ts --skip-llm   # re-price TTS only
 *
 * What it does
 *  - Samples `--stories` × `--sentences` rows from the real content dataset
 *    (data_preparation/data/output/sentences_translated.csv), each story's set
 *    drawn from ONE difficulty band so it looks like a real deck slice. Rows
 *    are filtered to ones translated into EVERY `--langs` language, so the same
 *    ten source sentences drive the story in each language and the results are
 *    directly comparable.
 *  - Generates each story TWICE per language on google/gemini-3.8-flash:floor:
 *      `sentences` — the model gets the drilled sentences and must re-use them
 *      `words`     — the model gets only the segmented word forms of those
 *                    sentences (what `userWords` actually tracks) and must
 *                    build a story out of them
 *  - Scores each story mechanically: verbatim sentence re-use, word coverage,
 *    and the share of story tokens the learner has NOT met (new-vocab load).
 *  - Prices every LLM call from OpenRouter's usage accounting (real billed USD).
 *  - TTS: synthesizes `--tts` stories per language two ways (one-voice
 *    whole-story, and per-line stitched with two alternating voices, which is
 *    what a real two-speaker dialogue would cost) and reads the real billed
 *    cost back from OpenRouter's generation endpoint.
 *
 * Writes .scratch/story-prototype/results.json.
 * The key is read from the environment by name. Nothing here opens .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  openrouterCostUsd,
  openrouterGenerationId,
} from '../convex/lib/posthogAi';
import { ttsDeliveryInstruction } from '../convex/lib/tts/deliveryInstruction';
import { toGeminiBcp47 } from '../convex/lib/tts/languageCodes';
import { languageName, resolveTtsPrompt } from '../lib/languages';
import { tokenizeText } from '../lib/wordTokenize';
import { normalizeForComparison } from '../lib/textCompare/normalize';
import { damerauLevenshtein } from '../lib/textCompare/editDistance';

// ------------------------------------------------------------------ config

const MODEL = 'google/gemini-3.8-flash:floor';
/** Gemini 3.x rejects a disabled-reasoning request; `minimal` is its floor. */
const REASONING = 'minimal' as const;
const MAX_OUTPUT_TOKENS = 8_000;

const TTS_MODEL = 'google/gemini-3.1-flash-tts-preview';
const TTS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
/** Gemini PCM: 24 kHz, 16-bit, mono. Bytes → seconds. */
const PCM_BYTES_PER_SECOND = 24_000 * 2;
/** One female + one male from the production Gemini pool (lib/voices.ts). */
const VOICES = ['Leda', 'Achird'] as const;

const DATASET = resolve(
  __dirname,
  '../data_preparation/data/output/sentences_translated.csv',
);
const OUT_DIR = resolve(__dirname, '../.scratch/story-prototype');

const argv = process.argv.slice(2);
const arg = (name: string) =>
  argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const num = (name: string, fallback: number) => Number(arg(name) ?? fallback);

/** English is the dataset's `text` column, not a translation column. */
const LANGS = (arg('langs') ?? 'en,de').split(',').map((l) => l.trim());
const STORIES = num('stories', 5);
const PER_STORY = num('sentences', 10);
const TTS_COUNT = num('tts', 2);
const SEED = num('seed', 20260909);
const DRY = argv.includes('--dry');
/** Re-run only the TTS measurement against the stories already in
 *  results.json, so a TTS fix doesn't re-buy the story generation. */
const SKIP_LLM = argv.includes('--skip-llm');
/** Keep the TTS numbers already in results.json. Cost tracks audio seconds,
 *  so a new prompt variant of the same length needs no fresh measurement. */
const SKIP_TTS = argv.includes('--skip-tts');
/** Start from the stories already in results.json and add to them, instead of
 *  regenerating everything. Pair with `--modes` to price only what is new. */
const APPEND = argv.includes('--append');
const BUDGET_USD = num('budget', 3);

const ALL_MODES = ['sentences', 'words'] as const;
type Mode = (typeof ALL_MODES)[number];
const MODES = (arg('modes')
  ?.split(',')
  .map((m) => m.trim()) ?? ALL_MODES) as Mode[];

// ------------------------------------------------------------------- types

type Row = {
  id: string;
  difficulty: string;
  topics: string;
  /** Language code → sentence. `en` is the dataset's English source. */
  text: Record<string, string>;
};

type StoryLine = { speaker: string; text: string; en: string };

type Story = {
  title: string;
  titleEn: string;
  lines: StoryLine[];
  used: number[];
};

type Telemetry = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  latencyMs: number;
  generationId?: string;
};

type Metrics = {
  storyWords: number;
  /** Drilled sentences reproduced word-for-word (normalized). */
  verbatim: number;
  /** …plus ones within a 15% edit distance of a story line. */
  nearVerbatim: number;
  /** Share of the drilled word forms that show up in the story. */
  wordCoverage: number;
  /** Share of story tokens the learner has NOT seen in the drilled set. */
  newWordShare: number;
  newWords: string[];
};

type Result = {
  index: number;
  lang: string;
  mode: 'sentences' | 'words';
  difficulty: string;
  /** The drilled sentences as this language renders them. */
  sources: { target: string; en: string }[];
  knownWords: string[];
  story: Story | null;
  raw?: string;
  error?: string;
  metrics?: Metrics;
  telemetry: Telemetry;
};

// -------------------------------------------------------------- dataset io

/** Deterministic 32-bit PRNG so a re-run samples the same sentences. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Rows translated into EVERY requested language. Filtering once, for all
 * languages, is what makes the per-language stories comparable: the same ten
 * source sentences go into each.
 */
function loadRows(langs: string[]): Row[] {
  const records = parse(readFileSync(DATASET, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as Record<string, string>[];
  const column = (lang: string) => (lang === 'en' ? 'text' : lang);
  for (const lang of langs) {
    if (records.length > 0 && !(column(lang) in records[0])) {
      throw new Error(
        `Dataset has no "${column(lang)}" column. Available: ${Object.keys(records[0]).join(', ')}`,
      );
    }
  }
  return records
    .filter((r) => langs.every((l) => r[column(l)]?.trim()))
    .map((r) => ({
      id: r.id,
      difficulty: r.difficulty || '?',
      topics: r.topics || '',
      text: Object.fromEntries(
        langs.map((l) => [l, r[column(l)].trim()]),
      ) as Record<string, string>,
    }));
}

/**
 * `--stories` sets of `--sentences` rows, each set inside ONE difficulty band.
 * A real study session draws from one collection at one level, so sampling
 * across the whole 17k-row catalogue would make the task harder than it is in
 * the app (and flatter the "unrelated sentences" failure mode).
 */
function sampleSets(rows: Row[], rand: () => number): Row[][] {
  const byDifficulty = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = byDifficulty.get(row.difficulty) ?? [];
    bucket.push(row);
    byDifficulty.set(row.difficulty, bucket);
  }
  const bands = [...byDifficulty.keys()]
    .filter((d) => (byDifficulty.get(d)?.length ?? 0) >= PER_STORY)
    .sort();
  const sets: Row[][] = [];
  for (let i = 0; i < STORIES; i++) {
    const band = bands[i % bands.length];
    sets.push(shuffled(byDifficulty.get(band) ?? [], rand).slice(0, PER_STORY));
  }
  return sets;
}

// -------------------------------------------------------------- generation

const SYSTEM = `You write short, natural texts for language learners, in the style of a graded reader.
You never explain, never add notes, never wrap the JSON in prose. You output ONE JSON object and nothing else.`;

function jsonContract(lang: string): string {
  const name = languageName(lang);
  return `Return ONE JSON object, no markdown fence:
{
  "title": "<title in ${name}>",
  "titleEn": "<the title in English>",
  "lines": [{ "speaker": "<name, or \\"Narrator\\">", "text": "<one line in ${name}>", "en": "<its English translation>" }],
  "used": [<the 1-based numbers of the items you actually used>]
}`;
}

function sentencesPrompt(lang: string, rows: Row[]): string {
  const name = languageName(lang);
  const list = rows
    .map((r, i) =>
      lang === 'en'
        ? `${i + 1}. ${r.text[lang]}`
        : `${i + 1}. ${r.text[lang]}  —  ${r.text.en ?? ''}`,
    )
    .join('\n');
  return `A learner of ${name} has just drilled these ${rows.length} flashcards:

${list}

Write a short dialogue between two named speakers that puts these sentences into one coherent situation.

Rules:
- Re-use as many of the ${rows.length} sentences as you can WORD FOR WORD, unchanged, as lines of the dialogue. Do not paraphrase them, do not re-conjugate them, do not merge two of them into one line. Aim for at least 7.
- Glue them together with your own short lines so the conversation makes sense. Those connective lines must stay simpler than the drilled sentences: everyday, high-frequency words only, no new idioms.
- 150-220 words of ${name} in total.
- It has to read like something two people would actually say, not like a list. If two drilled sentences cannot sit next to each other, put a line of your own in between or let the scene move on.
- Every line gets a natural English translation.

${jsonContract(lang)}`;
}

/**
 * The words the learner just drilled — NOT their whole vocabulary. An earlier
 * version told the model this list was everything the learner knew and banned
 * every content word outside it; that premise is false (a learner meeting
 * these ten cards knows thousands of other words) and it squeezed the stories
 * into a word-drill. So: a shuffled list, three plain sentences, no coverage
 * target, and a difficulty ceiling instead of a vocabulary fence. The shuffle
 * matters — in sentence order the list leaks the sentences themselves, so the
 * model can just reassemble them.
 */
function wordsPrompt(lang: string, words: string[]): string {
  return `Here are some words a learner of ${languageName(lang)} knows:

${words.join(', ')}

Write a short conversation between two people. Use some of these words. Do not use any word that is harder than the words in this list.

${jsonContract(lang)}`;
}

/** Tolerant JSON extraction: models sometimes fence the object or chat first. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in response');
  return JSON.parse(body.slice(start, end + 1));
}

function asStory(parsed: unknown): Story {
  const o = parsed as Partial<Story>;
  if (!Array.isArray(o.lines) || o.lines.length === 0) {
    throw new Error('response has no lines[]');
  }
  return {
    title: String(o.title ?? ''),
    titleEn: String(o.titleEn ?? ''),
    lines: o.lines.map((l) => ({
      speaker: String(l?.speaker ?? ''),
      text: String(l?.text ?? ''),
      en: String(l?.en ?? ''),
    })),
    used: Array.isArray(o.used)
      ? o.used.map(Number).filter(Number.isFinite)
      : [],
  };
}

// ----------------------------------------------------------------- scoring

/** Unique normalized word forms of a set of sentences — the shape `userWords`
 *  stores, and what the `words` condition is allowed to use. */
function wordForms(texts: string[], lang: string): string[] {
  const seen = new Map<string, string>();
  for (const text of texts) {
    for (const token of tokenizeText(text, lang)) {
      if (!seen.has(token.normalized))
        seen.set(token.normalized, token.original);
    }
  }
  return [...seen.values()];
}

function scoreStory(
  lang: string,
  story: Story,
  sources: { target: string }[],
  known: string[],
): Metrics {
  const storyText = story.lines.map((l) => l.text).join(' ');
  const normalizedStory = normalizeForComparison(storyText);
  const normalizedLines = story.lines.map((l) => normalizeForComparison(l.text));

  let verbatim = 0;
  let nearVerbatim = 0;
  for (const row of sources) {
    const needle = normalizeForComparison(row.target);
    if (!needle) continue;
    if (normalizedStory.includes(needle)) {
      verbatim++;
      nearVerbatim++;
      continue;
    }
    const close = normalizedLines.some((line) => {
      const distance = damerauLevenshtein(needle, line);
      return distance / Math.max(needle.length, line.length, 1) <= 0.15;
    });
    if (close) nearVerbatim++;
  }

  const knownSet = new Set(known.map((w) => w.toLowerCase()));
  const storyTokens = tokenizeText(storyText, lang);
  const usedKnown = new Set<string>();
  const newWords: string[] = [];
  const seenNew = new Set<string>();
  for (const token of storyTokens) {
    if (knownSet.has(token.normalized)) {
      usedKnown.add(token.normalized);
    } else if (!seenNew.has(token.normalized)) {
      seenNew.add(token.normalized);
      newWords.push(token.original);
    }
  }
  const knownHits = storyTokens.filter((t) => knownSet.has(t.normalized)).length;

  return {
    storyWords: storyTokens.length,
    verbatim,
    nearVerbatim,
    wordCoverage: knownSet.size === 0 ? 0 : usedKnown.size / knownSet.size,
    newWordShare:
      storyTokens.length === 0 ? 0 : 1 - knownHits / storyTokens.length,
    newWords,
  };
}

// --------------------------------------------------------------------- tts

/** Real billed USD for one OpenRouter generation. The stats row lands a
 *  moment after the response, so retry with backoff (same as the pipeline).
 *  Called AFTER all synthesis, so the row has usually already landed and the
 *  first attempt hits — the backoff is a fallback, not the common path. */
async function generationCost(
  apiKey: string,
  id: string,
): Promise<number | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    const res = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) continue;
    const json = (await res.json()) as { data?: { total_cost?: number } };
    const cost = json.data?.total_cost;
    if (typeof cost === 'number' && Number.isFinite(cost)) return cost;
  }
  return undefined;
}

/** Run `fn` over `items` with at most `concurrency` in flight. */
async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** One synthesis request, built exactly like convex/lib/tts/gemini.ts does.
 *  Returns the generation id; pricing happens in a later pass. */
async function synthesize(
  lang: string,
  apiKey: string,
  text: string,
  voice: string,
): Promise<{ bytes: number; seconds: number; generationId: string | null }> {
  const { name, notes } = resolveTtsPrompt(lang, undefined);
  const instruction = notes
    ? `${ttsDeliveryInstruction(name)} ${notes}`
    : ttsDeliveryInstruction(name);
  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: `## Instruction: ${instruction}\n\n## Transcript: ${text}`,
      voice,
      response_format: 'pcm',
      speed: 1,
      provider: { options: { google: { language_code: toGeminiBcp47(lang) } } },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini TTS ${res.status}: ${await res.text()}`);
  }
  const pcm = new Uint8Array(await res.arrayBuffer());
  return {
    bytes: pcm.byteLength,
    seconds: pcm.byteLength / PCM_BYTES_PER_SECOND,
    generationId: res.headers.get('x-generation-id'),
  };
}

type TtsRun = {
  index: number;
  lang: string;
  mode: string;
  condition: 'one-voice-whole' | 'two-voice-stitched';
  calls: number;
  /** Calls whose billed cost the generation endpoint actually returned. */
  pricedCalls: number;
  chars: number;
  seconds: number;
  /** Billed USD over `pricedCalls`, scaled to all `calls` when some
   *  generation rows never appeared. */
  costUsd?: number;
  costKnown: boolean;
};

/** One synthesis job: which run it belongs to, and what to say. */
type TtsJob = {
  result: Result;
  condition: 'one-voice-whole' | 'two-voice-stitched';
  text: string;
  voice: string;
};

function ttsJobs(result: Result): TtsJob[] {
  const story = result.story;
  if (!story) return [];
  const spoken = story.lines.filter((l) => l.text);
  const speakers = [...new Set(story.lines.map((l) => l.speaker))];
  return [
    {
      result,
      condition: 'one-voice-whole',
      text: spoken.map((l) => l.text).join('\n'),
      voice: VOICES[0],
    },
    // Two speakers = one call per line with the voice alternating by speaker,
    // stitched client-side. OpenRouter drops Gemini's multi_speaker config, so
    // this is the only real two-voice path today.
    ...spoken.map((line) => ({
      result,
      condition: 'two-voice-stitched' as const,
      text: line.text,
      voice: VOICES[Math.max(0, speakers.indexOf(line.speaker)) % VOICES.length],
    })),
  ];
}

/**
 * Synthesize every job in parallel, then price them all in a second parallel
 * pass. Splitting the two matters: by the time the last clip is back, the
 * earlier generation rows have long since landed, so the cost lookups return
 * on their first attempt instead of sleeping through a backoff each.
 */
async function measureTts(apiKey: string, targets: Result[]): Promise<TtsRun[]> {
  const jobs = targets.flatMap(ttsJobs);
  const clips = await pool(jobs, 8, async (job) => ({
    job,
    ...(await synthesize(job.result.lang, apiKey, job.text, job.voice)),
  }));
  const costs = await pool(clips, 8, (clip) =>
    clip.generationId
      ? generationCost(apiKey, clip.generationId)
      : Promise.resolve(undefined),
  );

  const runs = new Map<string, TtsRun>();
  clips.forEach((clip, i) => {
    const { result, condition } = clip.job;
    const key = `${result.index}|${result.lang}|${result.mode}|${condition}`;
    const run =
      runs.get(key) ??
      ({
        index: result.index,
        lang: result.lang,
        mode: result.mode,
        condition,
        calls: 0,
        pricedCalls: 0,
        chars: 0,
        seconds: 0,
        costUsd: 0,
        costKnown: true,
      } satisfies TtsRun);
    run.calls++;
    run.chars += clip.job.text.length;
    run.seconds += clip.seconds;
    // A generation row occasionally never lands within the backoff. Price the
    // run off the calls that did report and scale, rather than dropping it.
    if (costs[i] != null) {
      run.pricedCalls++;
      run.costUsd = (run.costUsd ?? 0) + (costs[i] as number);
    }
    runs.set(key, run);
  });

  return [...runs.values()].map((run) => ({
    ...run,
    costKnown: run.pricedCalls === run.calls,
    costUsd:
      run.pricedCalls > 0
        ? ((run.costUsd ?? 0) / run.pricedCalls) * run.calls
        : undefined,
  }));
}

// -------------------------------------------------------------------- main

async function main() {
  const rows = loadRows(LANGS);
  const rand = mulberry32(SEED);
  const sets = sampleSets(rows, rand);

  console.log(
    `${rows.length} rows translated into all of [${LANGS.join(', ')}]; ` +
      `${sets.length} sets of ${PER_STORY} (bands: ${sets.map((s) => s[0].difficulty).join(', ')})`,
  );

  if (DRY) {
    sets.forEach((set, i) => {
      console.log(`\n--- set ${i + 1} (${set[0].difficulty}) ---`);
      for (const lang of LANGS) {
        console.log(` [${lang}]`);
        set.forEach((r, j) => console.log(`  ${j + 1}. ${r.text[lang]}`));
      }
    });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run via: pnpm tsx --env-file=.env.local scripts/story-prototype.ts',
    );
    process.exit(1);
  }
  const openrouter = createOpenRouter({
    apiKey,
    extraBody: { usage: { include: true } },
  });

  const prior =
    SKIP_LLM || APPEND || SKIP_TTS
      ? (JSON.parse(readFileSync(resolve(OUT_DIR, 'results.json'), 'utf8')) as {
          results: Result[];
          ttsRuns: TtsRun[];
          llmSpendUsd: number;
        })
      : undefined;
  // Regenerating a mode replaces that mode's prior stories; everything else
  // in the file is carried through untouched.
  const results: Result[] = SKIP_LLM
    ? (prior?.results ?? [])
    : (prior?.results ?? []).filter(
        (r) => !MODES.includes(r.mode as Mode) || !LANGS.includes(r.lang),
      );
  let spent = prior?.llmSpendUsd ?? 0;

  outer: for (const [i, set] of (SKIP_LLM ? [] : sets).entries()) {
    for (const lang of LANGS) {
      const known = wordForms(
        set.map((r) => r.text[lang]),
        lang,
      );
      // Shuffled for the prompt (sentence order would leak the sentences),
      // but `knownWords` keeps source order for the scorer and the report.
      const shuffledKnown = shuffled(known, mulberry32(SEED + i * 31 + lang.length));
      for (const mode of MODES) {
        const prompt =
          mode === 'sentences'
            ? sentencesPrompt(lang, set)
            : wordsPrompt(lang, shuffledKnown);
        const started = Date.now();
        const res = await generateText({
          model: openrouter(MODEL),
          system: SYSTEM,
          prompt,
          temperature: 0.7,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          providerOptions: { openrouter: { reasoning: { effort: REASONING } } },
        });
        const telemetry: Telemetry = {
          model: MODEL,
          inputTokens: res.usage?.inputTokens ?? 0,
          outputTokens: res.usage?.outputTokens ?? 0,
          costUsd: openrouterCostUsd(res.providerMetadata),
          latencyMs: Date.now() - started,
          generationId: openrouterGenerationId(res.providerMetadata),
        };
        spent += telemetry.costUsd ?? 0;

        const sources = set.map((r) => ({
          target: r.text[lang],
          en: r.text.en ?? r.text[lang],
        }));
        const result: Result = {
          index: i + 1,
          lang,
          mode,
          difficulty: set[0].difficulty,
          sources,
          knownWords: known,
          story: null,
          telemetry,
        };
        try {
          const story = asStory(extractJson(res.text));
          result.story = story;
          result.metrics = scoreStory(lang, story, sources, known);
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
          result.raw = res.text.slice(0, 2000);
        }
        results.push(result);

        const m = result.metrics;
        console.log(
          `story ${i + 1} [${lang}/${mode}] ${result.error ? `FAILED: ${result.error}` : ''}` +
            (m
              ? `${m.verbatim}/${set.length} verbatim, ${m.storyWords} words, ` +
                `${(m.newWordShare * 100).toFixed(0)}% new tokens`
              : '') +
            ` — $${(telemetry.costUsd ?? 0).toFixed(5)}, ${(telemetry.latencyMs / 1000).toFixed(1)}s`,
        );

        if (spent > BUDGET_USD) {
          console.error(`BUDGET GUARD: $${spent.toFixed(3)} > $${BUDGET_USD}`);
          break outer;
        }
      }
    }
  }

  // Persist the stories before the (slower, chattier) TTS pass, so an
  // interrupted TTS measurement never costs the generations again.
  const flush = (ttsRuns: TtsRun[]) => {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      resolve(OUT_DIR, 'results.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          langs: LANGS,
          model: MODEL,
          reasoning: REASONING,
          ttsModel: TTS_MODEL,
          seed: SEED,
          perStory: PER_STORY,
          results,
          ttsRuns,
          llmSpendUsd: spent,
        },
        null,
        2,
      ),
    );
  };
  flush(prior?.ttsRuns ?? []);

  if (SKIP_TTS) {
    console.log(
      `\nLLM spend: $${spent.toFixed(4)} over ${results.length} stories`,
    );
    console.log(`Kept ${prior?.ttsRuns.length ?? 0} prior TTS runs.`);
    console.log(`Wrote ${OUT_DIR}/results.json`);
    return;
  }

  // TTS `--tts` successful stories per language (cost only tracks length, so
  // the sample just needs to be representative in words).
  const ttsTargets = LANGS.flatMap((lang) =>
    results.filter((r) => r.story && r.lang === lang).slice(0, TTS_COUNT),
  );
  console.log(`tts: ${ttsTargets.length} stories…`);
  const ttsRuns = await measureTts(apiKey, ttsTargets);
  for (const run of ttsRuns) {
    console.log(
      `  story ${run.index} [${run.lang}/${run.mode}] ${run.condition}: ` +
        `${run.calls} call(s), ${run.seconds.toFixed(1)}s audio, ` +
        (run.costUsd != null
          ? `$${run.costUsd.toFixed(5)}${run.costKnown ? '' : ` (scaled from ${run.pricedCalls}/${run.calls})`}`
          : 'cost unavailable'),
    );
  }

  flush(ttsRuns);
  console.log(`\nLLM spend: $${spent.toFixed(4)} over ${results.length} stories`);
  console.log(`Wrote ${OUT_DIR}/results.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
