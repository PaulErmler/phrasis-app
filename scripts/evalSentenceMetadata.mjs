/**
 * Speaker-gender classifier accuracy eval against the gold dataset in
 * data_preparation/gender_eval/data/.
 *
 * Sends each gold sentence through the EXACT production classifier prompt
 * (imported from convex/features/sentenceMetadataPrompt.ts — single source of
 * truth) and the production model (OPENROUTER_MODELS.sentenceMetadata),
 * then scores the returned `speakerGender` against the entry's `expected`.
 *
 * Run with tsx so the TypeScript prompt module resolves:
 *
 *   pnpm tsx --env-file=.env.local scripts/evalSentenceMetadata.mjs
 *
 * Flags:
 *   --validate-only         validate the dataset files and exit (no API calls)
 *   --language ru,he        restrict to these language files
 *   --limit N               at most N entries per language (smoke runs)
 *   --concurrency N         parallel API calls (default 4)
 *   --out path.md           report path (default reports/<YYYY-MM-DD>.md)
 *
 * Each entry is evaluated as a SINGLE rendering (no cross-lingual siblings):
 * this measures per-language classifier strength, the lower bound of what
 * production sees (production usually supplies several renderings, where any
 * one marked language can fix the gender).
 *
 * On-demand only (API cost) — not part of CI. Re-run after any classifier
 * prompt or model change and compare reports.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  buildMetadataSystemPrompt,
  buildMetadataUserPrompt,
} from '../convex/features/sentenceMetadataPrompt.ts';
import { OPENROUTER_MODELS } from '../convex/config/aiModels.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.join(__dirname, '..', 'data_preparation', 'gender_eval');
const DATA_DIR = path.join(EVAL_DIR, 'data');
const REPORTS_DIR = path.join(EVAL_DIR, 'reports');

const ALLOWED_EXPECTED = new Set(['male', 'female', 'neutral']);
// Unmarked-language negative controls: entries must expect 'neutral' —
// except lexical gender markers (role nouns like German "Lehrerin", gendered
// self-reference pronouns), which fix the speaker's gender even in languages
// whose grammar is otherwise unmarked. Those carry their phenomenon tag.
const CONTROL_LANGUAGES = new Set(['en', 'de', 'zh', 'tr', 'fi', 'id']);
const LEXICAL_PHENOMENA = new Set(['role-noun', 'pronoun']);
const REQUIRED_FIELDS = [
  'language',
  'text',
  'expected',
  'phenomenon',
  'glossEn',
  'sourceUrl',
];
const OPTIONAL_FIELDS = new Set(['notes']);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    validateOnly: false,
    languages: null,
    limit: Infinity,
    concurrency: 4,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--validate-only') args.validateOnly = true;
    else if (a === '--language') args.languages = argv[++i].split(',');
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Dataset loading + validation
// ---------------------------------------------------------------------------

function loadDataset(languages) {
  const problems = [];
  const entries = [];
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  for (const file of files) {
    const lang = file.replace(/\.jsonl$/, '');
    if (languages && !languages.includes(lang)) continue;
    const lines = fs
      .readFileSync(path.join(DATA_DIR, file), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const seenTexts = new Set();
    lines.forEach((line, i) => {
      const loc = `${file}:${i + 1}`;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        problems.push(`${loc}: invalid JSON (${e.message})`);
        return;
      }
      for (const key of REQUIRED_FIELDS) {
        if (typeof obj[key] !== 'string' || obj[key].trim() === '') {
          problems.push(`${loc}: missing/empty required field '${key}'`);
        }
      }
      for (const key of Object.keys(obj)) {
        if (!REQUIRED_FIELDS.includes(key) && !OPTIONAL_FIELDS.has(key)) {
          problems.push(`${loc}: unexpected field '${key}'`);
        }
      }
      if (obj.language !== lang) {
        problems.push(
          `${loc}: language '${obj.language}' does not match filename`,
        );
      }
      if (!ALLOWED_EXPECTED.has(obj.expected)) {
        problems.push(`${loc}: expected '${obj.expected}' not in male/female/neutral`);
      }
      if (obj.sourceUrl && !/^https?:\/\//.test(obj.sourceUrl)) {
        problems.push(`${loc}: sourceUrl is not an http(s) URL`);
      }
      if (seenTexts.has(obj.text)) {
        problems.push(`${loc}: duplicate text within file`);
      }
      seenTexts.add(obj.text);
      if (
        CONTROL_LANGUAGES.has(lang) &&
        obj.expected !== 'neutral' &&
        !LEXICAL_PHENOMENA.has(obj.phenomenon)
      ) {
        problems.push(
          `${loc}: control-language entry expects '${obj.expected}' without a lexical phenomenon tag`,
        );
      }
      entries.push({ ...obj, loc });
    });
  }
  return { entries, problems };
}

// ---------------------------------------------------------------------------
// Classifier call — mirrors fetchSentenceMetadata (single-turn completion)
// ---------------------------------------------------------------------------

async function classify(entry, apiKey) {
  const body = {
    model: OPENROUTER_MODELS.sentenceMetadata,
    messages: [
      // Per-request system prompt, exactly as production builds it for a
      // request whose only rendering is this entry's language.
      { role: 'system', content: buildMetadataSystemPrompt([entry.language]) },
      {
        role: 'user',
        content: buildMetadataUserPrompt([
          { language: entry.language, text: entry.text },
        ]),
      },
    ],
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? '';
    return extractSpeakerGender(raw);
  }
  throw new Error('OpenRouter: exhausted retries (rate limit / 5xx)');
}

/** Mirrors the fence-stripping in safeExtractMetadata; anything that doesn't
 * yield a valid speakerGender scores as 'invalid' (always wrong). */
function extractSpeakerGender(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    const value = parsed?.speakerGender;
    return ALLOWED_EXPECTED.has(value) ? value : 'invalid';
  } catch {
    return 'invalid';
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Scoring + report
// ---------------------------------------------------------------------------

function buildReport(entries, got, model) {
  const byLanguage = new Map();
  const classes = ['male', 'female', 'neutral'];
  const confusion = {}; // expected -> got -> count
  const misses = [];
  entries.forEach((e, i) => {
    const g = got[i];
    const correct = g === e.expected;
    const langStats = byLanguage.get(e.language) ?? { total: 0, correct: 0 };
    langStats.total++;
    if (correct) langStats.correct++;
    byLanguage.set(e.language, langStats);
    confusion[e.expected] ??= {};
    confusion[e.expected][g] = (confusion[e.expected][g] ?? 0) + 1;
    if (!correct) {
      misses.push({ ...e, got: g });
    }
  });

  const total = entries.length;
  const correct = total - misses.length;
  const lines = [];
  lines.push(`# Speaker-gender classifier eval — ${isoDate()}`);
  lines.push('');
  lines.push(`- Model: \`${model}\``);
  lines.push(
    '- Prompt: `convex/features/sentenceMetadataPrompt.ts` at this commit',
  );
  lines.push(
    '- Mode: single rendering per call (per-language lower bound; production may supply several renderings)',
  );
  lines.push(
    `- Overall: **${correct}/${total} (${pct(correct, total)})** correct on \`speakerGender\``,
  );
  lines.push('');
  lines.push('## Per-language accuracy');
  lines.push('');
  lines.push('| Language | Correct | Total | Accuracy |');
  lines.push('|---|---|---|---|');
  for (const [lang, s] of [...byLanguage.entries()].sort()) {
    lines.push(`| ${lang} | ${s.correct} | ${s.total} | ${pct(s.correct, s.total)} |`);
  }
  lines.push('');
  lines.push('## Per-class precision / recall');
  lines.push('');
  lines.push('| Class | Precision | Recall |');
  lines.push('|---|---|---|');
  for (const cls of classes) {
    let tp = 0;
    let predicted = 0;
    let actual = 0;
    entries.forEach((e, i) => {
      if (got[i] === cls) predicted++;
      if (e.expected === cls) actual++;
      if (got[i] === cls && e.expected === cls) tp++;
    });
    lines.push(
      `| ${cls} | ${pct(tp, predicted)} (${tp}/${predicted}) | ${pct(tp, actual)} (${tp}/${actual}) |`,
    );
  }
  lines.push('');
  lines.push('## Confusion (expected → got)');
  lines.push('');
  for (const exp of classes) {
    const row = confusion[exp] ?? {};
    const parts = Object.entries(row)
      .sort()
      .map(([g, n]) => `${g}: ${n}`)
      .join(', ');
    lines.push(`- ${exp} → ${parts || '(none)'}`);
  }
  lines.push('');
  lines.push(`## Misclassified (${misses.length})`);
  lines.push('');
  if (misses.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Language | Sentence | Expected | Got | Phenomenon |');
    lines.push('|---|---|---|---|---|');
    for (const m of misses) {
      lines.push(
        `| ${m.language} | ${m.text.replaceAll('|', '\\|')} | ${m.expected} | ${m.got} | ${m.phenomenon} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function pct(n, d) {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const { entries, problems } = loadDataset(args.languages);
  if (problems.length > 0) {
    console.error(`Dataset validation FAILED (${problems.length} problems):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`Dataset valid: ${entries.length} entries.`);
  if (args.validateOnly) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run with: pnpm tsx --env-file=.env.local scripts/evalSentenceMetadata.mjs',
    );
    process.exit(1);
  }

  const limited = [];
  const perLang = new Map();
  for (const e of entries) {
    const n = perLang.get(e.language) ?? 0;
    if (n < args.limit) {
      limited.push(e);
      perLang.set(e.language, n + 1);
    }
  }

  console.log(
    `Evaluating ${limited.length} entries with ${OPENROUTER_MODELS.sentenceMetadata} (concurrency ${args.concurrency})…`,
  );
  let done = 0;
  const got = await runPool(limited, args.concurrency, async (entry) => {
    const result = await classify(entry, apiKey);
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${limited.length}`);
    return result;
  });

  const report = buildReport(limited, got, OPENROUTER_MODELS.sentenceMetadata);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = args.out ?? path.join(REPORTS_DIR, `${isoDate()}.md`);
  fs.writeFileSync(outPath, report);
  console.log(`Report written to ${path.relative(process.cwd(), outPath)}`);
}

await main();
