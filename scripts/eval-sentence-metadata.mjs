/**
 * Sentence-metadata classifier eval: EVERY field the production prompt emits,
 * scored in one pass over both gold corpora.
 *
 * Replaces the separate speaker-gender and politeness runners. The classifier
 * returns all five fields per call, so scoring register and gender together
 * costs exactly the API calls the gender run alone used to cost.
 *
 * Two nets, because the corpora do not label every field:
 *
 *   1. GOLD SCORING. Each entry is scored on the fields it labels. The
 *      gender corpus labels speakerGender (its `expected`), the politeness
 *      corpus labels register (its `expected`, a learner-facing tier mapped
 *      to the classifier's 3-value enum). Either corpus may additionally
 *      carry `addresseeNumber`, `addresseeGender` and `addressesSomeone`
 *      keys, hand-labeled on the subset where the answer is beyond doubt.
 *   2. SNAPSHOT DIFF. Every run records all five answers for every sentence
 *      to snapshots/<model>.json. A later run diffs against it and reports
 *      what moved. This is the only net under the three sparsely-labeled
 *      fields, and it catches "changed", not "wrong" — read the diff.
 *
 * Sends the EXACT production prompt (imported from
 * convex/lib/sentenceMetadataPrompt.ts) and, by default, the production
 * model (OPENROUTER_MODELS.sentenceMetadata).
 *
 * Run with tsx so the TypeScript prompt module resolves:
 *
 *   pnpm eval:metadata
 *
 * Flags:
 *   --validate-only         validate both corpora and exit (no API calls)
 *   --model a,b             OpenRouter slugs to score (default: production);
 *                           each model gets its own report and snapshot
 *   --corpus gender         restrict to one corpus (gender | politeness)
 *   --language ru,ja        restrict to these language files
 *   --limit N               at most N entries per language (smoke runs)
 *   --concurrency N         parallel API calls (default 4)
 *   --update-snapshot       overwrite the snapshot instead of diffing
 *   --from-snapshot         re-score the recorded answers offline, no API
 *                           calls. Use after editing gold labels: the model's
 *                           answers did not change, only their scoring.
 *   --out path.md           report path (single model only)
 *
 * Each entry is evaluated as a SINGLE rendering (no cross-lingual siblings):
 * this measures per-language classifier strength, the lower bound of what
 * production sees (production usually supplies several renderings, where any
 * one marked language can fix a field).
 *
 * On-demand only (API cost) — not part of CI. Re-run after any classifier
 * prompt or model change and compare reports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMetadataSystemPrompt,
  buildMetadataUserPrompt,
} from '../convex/lib/sentenceMetadataPrompt.ts';
import { OPENROUTER_MODELS } from '../convex/config/aiModels.ts';
import { LUNA_BO3, LUNA_PROVIDER_CONSTRAINTS } from '../lib/languages.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREP_DIR = path.join(__dirname, '..', 'data_preparation');
const EVAL_DIR = path.join(PREP_DIR, 'metadata_eval');
const REPORTS_DIR = path.join(EVAL_DIR, 'reports');
const SNAPSHOT_DIR = path.join(EVAL_DIR, 'snapshots');

// ---------------------------------------------------------------------------
// Field definitions — the five keys the production prompt returns
// ---------------------------------------------------------------------------

const REGISTER_VALUES = ['formal', 'informal', 'neutral'];
const GENDER_VALUES = ['male', 'female', 'neutral'];
const ADDRESSEE_GENDER_VALUES = [...GENDER_VALUES, 'not_applicable'];
const ADDRESSEE_NUMBER_VALUES = ['singular', 'plural', 'not_applicable'];

/** Every field, with the enum the classifier may return for it. `booleanField`
 *  marks addressesSomeone, whose JSON value is a boolean rather than a string;
 *  it is normalized to 'true'/'false' for scoring and snapshotting. */
const FIELDS = [
  { key: 'register', values: REGISTER_VALUES },
  { key: 'addresseeNumber', values: ADDRESSEE_NUMBER_VALUES },
  { key: 'speakerGender', values: GENDER_VALUES },
  { key: 'addresseeGender', values: ADDRESSEE_GENDER_VALUES },
  { key: 'addressesSomeone', values: ['true', 'false'], booleanField: true },
];
const FIELD_KEYS = FIELDS.map((f) => f.key);

/** Gold tier → the register the production classifier must return. The
 *  classifier cannot separate polite from formal; both are "formal". */
const REQUIRED_REGISTER = {
  casual: 'informal',
  polite: 'formal',
  formal: 'formal',
  neutral: 'neutral',
};

// ---------------------------------------------------------------------------
// Corpora
// ---------------------------------------------------------------------------

/**
 * The two gold corpora. `primaryField` is the classifier field their own
 * `expected` column labels; `mapExpected` turns that column into the value
 * the classifier must return.
 */
const CORPORA = [
  {
    id: 'gender',
    dir: path.join(PREP_DIR, 'gender_eval', 'data'),
    primaryField: 'speakerGender',
    expectedValues: GENDER_VALUES,
    mapExpected: (v) => v,
  },
  {
    id: 'politeness',
    dir: path.join(PREP_DIR, 'politeness_eval', 'data'),
    primaryField: 'register',
    expectedValues: Object.keys(REQUIRED_REGISTER),
    mapExpected: (v) => REQUIRED_REGISTER[v],
  },
];

/** Keys every entry must carry. Corpus-specific extras (sourceUrl on the
 *  gender corpus) are permitted but not required here — each corpus keeps its
 *  own README rules; this runner only needs enough to call and score. */
const REQUIRED_FIELDS = ['language', 'text', 'expected', 'phenomenon'];
/** Optional per-entry gold for the fields neither corpus labels by default,
 *  plus the prose keys the runner ignores. */
const EXTRA_GOLD_FIELDS = [
  'addresseeNumber',
  'addresseeGender',
  'addressesSomeone',
];
const IGNORED_FIELDS = new Set(['glossEn', 'sourceUrl', 'notes']);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    validateOnly: false,
    models: [OPENROUTER_MODELS.sentenceMetadata],
    corpora: null,
    languages: null,
    limit: Infinity,
    concurrency: 4,
    updateSnapshot: false,
    fromSnapshot: false,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--validate-only') args.validateOnly = true;
    else if (a === '--update-snapshot') args.updateSnapshot = true;
    else if (a === '--from-snapshot') args.fromSnapshot = true;
    else if (a === '--model')
      args.models = argv[++i].split(',').filter(Boolean);
    else if (a === '--corpus') args.corpora = argv[++i].split(',');
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

function loadDataset(args) {
  const problems = [];
  const entries = [];
  for (const corpus of CORPORA) {
    if (args.corpora && !args.corpora.includes(corpus.id)) continue;
    const files = fs
      .readdirSync(corpus.dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort();
    for (const file of files) {
      const lang = file.replace(/\.jsonl$/, '');
      if (args.languages && !args.languages.includes(lang)) continue;
      const lines = fs
        .readFileSync(path.join(corpus.dir, file), 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      lines.forEach((line, i) => {
        const loc = `${corpus.id}/${file}:${i + 1}`;
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
          if (
            !REQUIRED_FIELDS.includes(key) &&
            !EXTRA_GOLD_FIELDS.includes(key) &&
            !IGNORED_FIELDS.has(key)
          ) {
            problems.push(`${loc}: unexpected field '${key}'`);
          }
        }
        if (obj.language !== lang) {
          problems.push(
            `${loc}: language '${obj.language}' does not match filename`,
          );
        }
        if (!corpus.expectedValues.includes(obj.expected)) {
          problems.push(
            `${loc}: expected '${obj.expected}' not in ${corpus.expectedValues.join('/')}`,
          );
        }

        // Gold for this entry: the corpus's primary field, plus any extras.
        const gold = {
          [corpus.primaryField]: corpus.mapExpected(obj.expected),
        };
        for (const key of EXTRA_GOLD_FIELDS) {
          if (obj[key] === undefined) continue;
          const field = FIELDS.find((f) => f.key === key);
          const value = field.booleanField ? String(obj[key]) : obj[key];
          if (!field.values.includes(value)) {
            problems.push(
              `${loc}: ${key} '${obj[key]}' not in ${field.values.join('/')}`,
            );
            continue;
          }
          if (gold[key] !== undefined && gold[key] !== value) {
            problems.push(`${loc}: ${key} contradicts the corpus label`);
            continue;
          }
          gold[key] = value;
        }
        // A sentence with no addressee cannot mark one. Catches the pairing
        // the prompt itself requires, so a bad hand-label fails validation
        // instead of quietly scoring the classifier against nonsense.
        if (gold.addressesSomeone === 'false') {
          for (const key of ['addresseeNumber', 'addresseeGender']) {
            if (gold[key] !== undefined && gold[key] !== 'not_applicable') {
              problems.push(
                `${loc}: addressesSomeone false but ${key} is '${gold[key]}'`,
              );
            }
          }
        }
        if (
          gold.addressesSomeone === 'true' &&
          gold.addresseeNumber === 'not_applicable'
        ) {
          problems.push(
            `${loc}: addressesSomeone true but addresseeNumber is 'not_applicable'`,
          );
        }

        entries.push({
          corpus: corpus.id,
          language: obj.language,
          text: obj.text,
          phenomenon: obj.phenomenon,
          gold,
          loc,
        });
      });
    }
  }
  const seen = new Set();
  for (const e of entries) {
    const key = snapshotKey(e);
    if (seen.has(key)) problems.push(`${e.loc}: duplicate text within corpus`);
    seen.add(key);
  }
  return { entries, problems };
}

/** Stable identity of an entry across runs. Corpus-scoped, so the same
 *  sentence may legitimately appear in both corpora. */
function snapshotKey(entry) {
  return `${entry.corpus}:${entry.language}:${entry.text}`;
}

// ---------------------------------------------------------------------------
// Classifier call — mirrors fetchSentenceMetadata (single-turn completion)
// ---------------------------------------------------------------------------

/**
 * Per-model wire settings. Production sends neither `reasoning` nor
 * `provider` for the Gemini classifier, so candidates default to the same
 * bare body. Luna is the exception: it reasons adaptively unless thinking is
 * explicitly disabled and bills the hidden tokens, so it is scored with the
 * same `reasoning: {enabled: false}` + Bedrock/price-cap routing every other
 * Luna call in the app uses (see LUNA_BO3).
 */
function wireSettingsFor(model) {
  if (model === LUNA_BO3.model) {
    return {
      reasoning: { enabled: false },
      provider: LUNA_PROVIDER_CONSTRAINTS,
    };
  }
  return {};
}

async function classify(entry, apiKey, model) {
  const body = {
    model,
    // Real USD per request, so the report can state what the run cost.
    usage: { include: true },
    ...wireSettingsFor(model),
    messages: [
      // The production system prompt (static, language-independent).
      { role: 'system', content: buildMetadataSystemPrompt() },
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
    return {
      got: extractFields(raw),
      costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : 0,
    };
  }
  throw new Error('OpenRouter: exhausted retries (rate limit / 5xx)');
}

/** Mirrors the fence-stripping in safeExtractMetadata. Any field that doesn't
 *  yield a value in its enum scores as 'invalid' (always wrong). */
function extractFields(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = null;
  }
  const out = {};
  for (const field of FIELDS) {
    const value =
      parsed !== null && typeof parsed === 'object'
        ? parsed[field.key]
        : undefined;
    const normalized = field.booleanField
      ? typeof value === 'boolean'
        ? String(value)
        : undefined
      : value;
    out[field.key] = field.values.includes(normalized) ? normalized : 'invalid';
  }
  return out;
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
// Snapshot
// ---------------------------------------------------------------------------

function snapshotPath(model) {
  return path.join(SNAPSHOT_DIR, `${modelSlug(model)}.json`);
}

function readSnapshot(model) {
  const p = snapshotPath(model);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeSnapshot(model, entries, got) {
  const data = {};
  entries.forEach((e, i) => {
    data[snapshotKey(e)] = got[i];
  });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(
    snapshotPath(model),
    `${JSON.stringify(sortKeys(data), null, 2)}\n`,
  );
}

/** Stable key order, so a re-recorded snapshot diffs cleanly in git. */
function sortKeys(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

/**
 * Every field whose answer moved since the snapshot. Entries the snapshot
 * doesn't know are reported separately: a partial run (--language, --limit)
 * legitimately covers a subset, so a missing key is news, not an error.
 */
function diffSnapshot(snapshot, entries, got) {
  const changes = [];
  let unseen = 0;
  entries.forEach((e, i) => {
    const before = snapshot[snapshotKey(e)];
    if (before === undefined) {
      unseen++;
      return;
    }
    for (const key of FIELD_KEYS) {
      if (before[key] !== got[i][key]) {
        changes.push({
          entry: e,
          field: key,
          before: before[key],
          after: got[i][key],
          // A gold label makes the direction knowable; without one the diff
          // only says the answer moved.
          gold: e.gold[key],
        });
      }
    }
  });
  return { changes, unseen };
}

// ---------------------------------------------------------------------------
// Scoring + report
// ---------------------------------------------------------------------------

function buildReport(entries, got, model, costUsd, diff, offline) {
  const lines = [];
  lines.push(`# Sentence-metadata classifier eval — ${isoDate()}`);
  lines.push('');
  lines.push(`- Model: \`${model}\``);
  lines.push('- Prompt: `convex/lib/sentenceMetadataPrompt.ts` at this commit');
  lines.push(
    offline
      ? `- Entries: ${entries.length} (re-scored offline from the snapshot, no API calls)`
      : `- Entries: ${entries.length} (one API call each, all five fields)`,
  );
  if (costUsd > 0) lines.push(`- Run cost: $${costUsd.toFixed(4)}`);
  lines.push(
    '- Mode: single rendering per call (per-language lower bound; production may supply several renderings)',
  );
  lines.push(
    '- Register scoring: gold tier to required register, casual to informal, polite and formal to formal, neutral to neutral',
  );
  lines.push('');

  // --- per-field accuracy -------------------------------------------------
  lines.push('## Accuracy by field');
  lines.push('');
  lines.push('| Field | Correct | Labeled | Accuracy |');
  lines.push('|---|---|---|---|');
  const scored = {};
  for (const key of FIELD_KEYS) {
    const labeled = entries
      .map((e, i) => ({ e, g: got[i] }))
      .filter(({ e }) => e.gold[key] !== undefined);
    const correct = labeled.filter(({ e, g }) => g[key] === e.gold[key]).length;
    scored[key] = { labeled: labeled.length, correct };
    lines.push(
      `| ${key} | ${correct} | ${labeled.length} | ${pct(correct, labeled.length)} |`,
    );
  }
  lines.push('');

  // --- per-language, for the two densely-labeled fields --------------------
  for (const key of ['speakerGender', 'register']) {
    if (scored[key].labeled === 0) continue;
    lines.push(`## ${key} by language`);
    lines.push('');
    lines.push('| Language | Correct | Total | Accuracy |');
    lines.push('|---|---|---|---|');
    const byLanguage = new Map();
    entries.forEach((e, i) => {
      if (e.gold[key] === undefined) return;
      const s = byLanguage.get(e.language) ?? { total: 0, correct: 0 };
      s.total++;
      if (got[i][key] === e.gold[key]) s.correct++;
      byLanguage.set(e.language, s);
    });
    for (const [lang, s] of [...byLanguage.entries()].sort()) {
      lines.push(
        `| ${lang} | ${s.correct} | ${s.total} | ${pct(s.correct, s.total)} |`,
      );
    }
    lines.push('');
  }

  // --- confusion, per labeled field ---------------------------------------
  lines.push('## Confusion (expected → got)');
  lines.push('');
  for (const field of FIELDS) {
    if (scored[field.key].labeled === 0) continue;
    lines.push(`**${field.key}**`);
    lines.push('');
    for (const expected of field.values) {
      const row = {};
      entries.forEach((e, i) => {
        if (e.gold[field.key] !== expected) return;
        const g = got[i][field.key];
        row[g] = (row[g] ?? 0) + 1;
      });
      const parts = Object.entries(row)
        .sort()
        .map(([g, n]) => `${g}: ${n}`)
        .join(', ');
      lines.push(`- ${expected} → ${parts || '(none)'}`);
    }
    lines.push('');
  }

  // --- misses -------------------------------------------------------------
  const misses = [];
  entries.forEach((e, i) => {
    for (const key of FIELD_KEYS) {
      if (e.gold[key] !== undefined && got[i][key] !== e.gold[key]) {
        misses.push({ e, field: key, expected: e.gold[key], got: got[i][key] });
      }
    }
  });
  lines.push(`## Misclassified (${misses.length})`);
  lines.push('');
  if (misses.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Field | Language | Sentence | Expected | Got | Phenomenon |');
    lines.push('|---|---|---|---|---|---|');
    for (const m of misses) {
      lines.push(
        `| ${m.field} | ${m.e.language} | ${escapeCell(m.e.text)} | ${m.expected} | ${m.got} | ${m.e.phenomenon} |`,
      );
    }
  }
  lines.push('');

  // --- snapshot diff ------------------------------------------------------
  lines.push('## Snapshot diff');
  lines.push('');
  if (offline) {
    lines.push('Not applicable: this report re-scored the snapshot itself.');
  } else if (diff === null) {
    lines.push('No snapshot recorded for this model yet.');
  } else if (diff.changes.length === 0) {
    lines.push(
      `No field changed against the snapshot${diff.unseen > 0 ? ` (${diff.unseen} entries not in it)` : ''}.`,
    );
  } else {
    lines.push(
      `${diff.changes.length} field answer(s) moved${diff.unseen > 0 ? `; ${diff.unseen} entries not in the snapshot` : ''}. "Gold" is blank where the field is unlabeled — those rows say the answer changed, not that it is wrong.`,
    );
    lines.push('');
    lines.push('| Field | Language | Sentence | Before | After | Gold |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of diff.changes) {
      lines.push(
        `| ${c.field} | ${c.entry.language} | ${escapeCell(c.entry.text)} | ${c.before} | ${c.after} | ${c.gold ?? ''} |`,
      );
    }
  }
  lines.push('');
  return { report: lines.join('\n'), scored, misses };
}

function escapeCell(text) {
  return text.replaceAll('|', '\\|');
}

function pct(n, d) {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Filename-safe form of an OpenRouter slug: `openai/gpt-5.6-luna:nitro` →
 *  `openai-gpt-5.6-luna-nitro`. */
function modelSlug(model) {
  return model.replace(/[^a-zA-Z0-9.]+/g, '-');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const { entries, problems } = loadDataset(args);
  if (problems.length > 0) {
    console.error(`Dataset validation FAILED (${problems.length} problems):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const labeledCounts = FIELD_KEYS.map(
    (k) => `${k} ${entries.filter((e) => e.gold[k] !== undefined).length}`,
  ).join(', ');
  console.log(`Dataset valid: ${entries.length} entries (${labeledCounts}).`);
  if (args.validateOnly) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey && !args.fromSnapshot) {
    console.error(
      'OPENROUTER_API_KEY is not set. Run with: pnpm eval:metadata',
    );
    process.exit(1);
  }
  if (args.out && args.models.length > 1) {
    console.error('--out takes a single --model (each model writes a report).');
    process.exit(2);
  }

  // --limit is per language WITHIN a corpus, so a smoke run keeps both.
  const limited = [];
  const perLang = new Map();
  for (const e of entries) {
    const key = `${e.corpus}:${e.language}`;
    const n = perLang.get(key) ?? 0;
    if (n < args.limit) {
      limited.push(e);
      perLang.set(key, n + 1);
    }
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  for (const model of args.models) {
    let got;
    let costUsd = 0;
    let snapshot = readSnapshot(model);

    if (args.fromSnapshot) {
      if (snapshot === null) {
        console.error(`  no snapshot recorded for ${model}; nothing to score.`);
        process.exit(1);
      }
      const missing = limited.filter(
        (e) => snapshot[snapshotKey(e)] === undefined,
      );
      if (missing.length > 0) {
        console.error(
          `  snapshot is missing ${missing.length} of ${limited.length} entries (first: ${missing[0].loc}). Run live to record them.`,
        );
        process.exit(1);
      }
      console.log(
        `Re-scoring ${limited.length} recorded answers for ${model}…`,
      );
      got = limited.map((e) => snapshot[snapshotKey(e)]);
      // Scoring its own source would diff every row against itself.
      snapshot = null;
    } else {
      console.log(
        `Evaluating ${limited.length} entries with ${model} (concurrency ${args.concurrency})…`,
      );
      let done = 0;
      const results = await runPool(
        limited,
        args.concurrency,
        async (entry) => {
          const result = await classify(entry, apiKey, model);
          done++;
          if (done % 50 === 0) console.log(`  ${done}/${limited.length}`);
          return result;
        },
      );
      got = results.map((r) => r.got);
      costUsd = results.reduce((sum, r) => sum + r.costUsd, 0);
    }

    const diff =
      snapshot === null ? null : diffSnapshot(snapshot, limited, got);

    const { report, scored, misses } = buildReport(
      limited,
      got,
      model,
      costUsd,
      diff,
      args.fromSnapshot,
    );
    // A partial run must not clobber the full report, so it lands under its
    // own name. Same reason the snapshot is only written by a full run.
    const partial = limited.length < entries.length;
    const outPath =
      args.out ??
      path.join(
        REPORTS_DIR,
        `${isoDate()}-${modelSlug(model)}${partial ? '-partial' : ''}.md`,
      );
    fs.writeFileSync(outPath, report);

    if (!args.fromSnapshot && (args.updateSnapshot || snapshot === null)) {
      // A partial run would record a partial snapshot, so refuse unless the
      // run covered the whole corpus.
      if (partial) {
        console.log(
          `  snapshot NOT written: partial run (${limited.length}/${entries.length} entries)`,
        );
      } else {
        writeSnapshot(model, limited, got);
        console.log(
          `  snapshot ${snapshot === null ? 'created' : 'updated'}: ${path.relative(process.cwd(), snapshotPath(model))}`,
        );
      }
    }

    const headline = FIELD_KEYS.filter((k) => scored[k].labeled > 0)
      .map((k) => `${k} ${scored[k].correct}/${scored[k].labeled}`)
      .join(', ');
    console.log(
      `  ${model}: ${headline}; ${misses.length} miss(es)` +
        (diff === null ? '' : `, ${diff.changes.length} snapshot change(s)`) +
        `, $${costUsd.toFixed(4)} → ${path.relative(process.cwd(), outPath)}`,
    );
  }
}

await main();
