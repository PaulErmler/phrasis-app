/**
 * Blind human/LLM re-scoring companion for eval-translation-sol.ts.
 *
 *   pnpm tsx scripts/eval-translation-sol-blind.ts --export
 *   pnpm tsx scripts/eval-translation-sol-blind.ts --aggregate --scores=<file>
 *
 * `--export` reads the benchmark cache and writes two files into
 * .scratch/sol-translation-bench/:
 *   blind-sheet.md   one item per (sentence, lang): source, context,
 *                    FLORES reference, and the deduped candidate
 *                    translations as letters (A, B, C ...) in an order
 *                    shuffled per item with a fixed seed. NO condition
 *                    names anywhere — safe to read while scoring.
 *   blind-mapping.json   letter -> condition list per item. Only read
 *                    AFTER all scores are written down.
 *
 * `--aggregate` joins a scores JSON (`{"<itemId>": {"A": 9, ...}}`) with
 * the mapping and prints per-condition means, W/T/L vs the luna-bo3
 * baseline, and per-item agreement with the Gemini judge's cached scores.
 *
 * No API calls; this script spends nothing.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

const OUT_DIR = resolve(__dirname, '../.scratch/sol-translation-bench');
const CACHE_PATH = resolve(OUT_DIR, 'cache.json');
const FLORES_PATH = resolve(
  __dirname,
  '../data_preparation/translation_eval/data/flores_sample.csv',
);

const CONDITIONS = [
  'luna-bo3',
  'sol-minimal',
  'sol-low',
  'sol-medium',
  'sol-minimal-bo3',
  'sol-low-bo3',
];
const LANGS = ['de', 'ru', 'ja', 'fi'];
const LIMIT = 15;

type FloresRow = {
  src_hash: string;
  src: string;
  speaker_gender: string;
  addressee_gender: string;
  formality: string;
  [k: string]: string;
};

type CacheRecord = { text: string | null; telemetry: unknown };

function seededShuffle<T>(items: T[], seed: string): T[] {
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

function loadAll() {
  const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Record<
    string,
    CacheRecord
  >;
  const rows = (
    parse(readFileSync(FLORES_PATH, 'utf8'), { columns: true }) as FloresRow[]
  ).slice(0, LIMIT);
  return { cache, rows };
}

type MappingItem = {
  id: string;
  lang: string;
  srcHash: string;
  letters: Record<string, string[]>; // letter -> condition names
  judgeScores: Record<string, number> | null; // letter -> Gemini score
};

function doExport() {
  const { cache, rows } = loadAll();
  const sheet: string[] = [
    `# Blind translation scoring sheet`,
    ``,
    `Score every lettered candidate 0-10: (1) accuracy/completeness vs the`,
    `source, (2) natural, idiomatic target-language phrasing, (3) adherence`,
    `to the register/gender context. The reference is one correct human`,
    `rendering; candidates may differ from it and still score 10.`,
    ``,
  ];
  const mapping: MappingItem[] = [];

  for (const lang of LANGS) {
    for (const row of rows) {
      const id = `${lang}-${row.src_hash}`;
      const byText = new Map<string, string[]>();
      for (const c of CONDITIONS) {
        const rec = cache[`${c}|${lang}|${row.src_hash}`];
        if (rec?.text) {
          byText.set(rec.text, [...(byText.get(rec.text) ?? []), c]);
        }
      }
      if (byText.size === 0) continue;
      const shuffledTexts = seededShuffle([...byText.keys()], `blind:${id}`);
      const letters: Record<string, string[]> = {};
      const judgeRaw = cache[`judge|${lang}|${row.src_hash}`]?.text;
      const judgeScores = judgeRaw
        ? (JSON.parse(judgeRaw) as Record<string, number>)
        : null;
      const judgeByLetter: Record<string, number> = {};

      sheet.push(`---`, ``, `## ${id}`, ``);
      sheet.push(`**Source (en):** ${row.src}`);
      const ctx = [
        `speaker=${row.speaker_gender || 'unspecified'}`,
        row.addressee_gender ? `addressee=${row.addressee_gender}` : '',
        row.formality ? `register=${row.formality}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      sheet.push(`**Context:** ${ctx}`);
      sheet.push(`**Reference (${lang}):** ${row[`ref_${lang}`]}`, ``);
      shuffledTexts.forEach((text, i) => {
        const letter = String.fromCharCode(65 + i);
        letters[letter] = byText.get(text)!;
        if (judgeScores && judgeScores[text] !== undefined) {
          judgeByLetter[letter] = judgeScores[text];
        }
        sheet.push(`- **${letter}:** ${text}`);
      });
      sheet.push(``);
      mapping.push({
        id,
        lang,
        srcHash: row.src_hash,
        letters,
        judgeScores: Object.keys(judgeByLetter).length ? judgeByLetter : null,
      });
    }
  }

  writeFileSync(resolve(OUT_DIR, 'blind-sheet.md'), sheet.join('\n'));
  writeFileSync(
    resolve(OUT_DIR, 'blind-mapping.json'),
    JSON.stringify(mapping, null, 1),
  );
  console.log(
    `Wrote ${mapping.length} items to blind-sheet.md (+ blind-mapping.json). ` +
      `Do not open the mapping until scores are recorded.`,
  );
}

function doAggregate(scoresPath: string) {
  const mapping = JSON.parse(
    readFileSync(resolve(OUT_DIR, 'blind-mapping.json'), 'utf8'),
  ) as MappingItem[];
  const scores = JSON.parse(readFileSync(scoresPath, 'utf8')) as Record<
    string,
    Record<string, number>
  >;

  type Agg = {
    sum: number;
    n: number;
    wins: number;
    ties: number;
    losses: number;
    perLang: Record<string, { sum: number; n: number }>;
  };
  const aggs: Record<string, Agg> = {};
  for (const c of CONDITIONS) {
    aggs[c] = { sum: 0, n: 0, wins: 0, ties: 0, losses: 0, perLang: {} };
  }
  // Judge-agreement accumulators over (item, letter) pairs present in both.
  let agreePairs = 0;
  let sumMine = 0;
  let sumJudge = 0;
  const prodMine: number[] = [];
  const prodJudge: number[] = [];
  let missingItems = 0;

  for (const item of mapping) {
    const itemScores = scores[item.id];
    if (!itemScores) {
      missingItems++;
      continue;
    }
    const byCondition: Record<string, number> = {};
    for (const [letter, conds] of Object.entries(item.letters)) {
      const s = itemScores[letter];
      if (s === undefined) continue;
      for (const c of conds) byCondition[c] = s;
      if (item.judgeScores && item.judgeScores[letter] !== undefined) {
        agreePairs++;
        sumMine += s;
        sumJudge += item.judgeScores[letter];
        prodMine.push(s);
        prodJudge.push(item.judgeScores[letter]);
      }
    }
    const base = byCondition['luna-bo3'];
    for (const [c, s] of Object.entries(byCondition)) {
      const a = aggs[c];
      a.sum += s;
      a.n++;
      a.perLang[item.lang] ??= { sum: 0, n: 0 };
      a.perLang[item.lang].sum += s;
      a.perLang[item.lang].n++;
      if (c !== 'luna-bo3' && base !== undefined) {
        if (s > base) a.wins++;
        else if (s < base) a.losses++;
        else a.ties++;
      }
    }
  }

  console.log(`\n=== Blind re-scoring (my scores) ===\n`);
  console.log(`condition        | mean | vs baseline (W/T/L) | per-lang`);
  console.log('-'.repeat(100));
  for (const c of CONDITIONS) {
    const a = aggs[c];
    const mean = a.n ? (a.sum / a.n).toFixed(2) : 'n/a';
    const wtl =
      c === 'luna-bo3' ? '(baseline)' : `${a.wins}/${a.ties}/${a.losses}`;
    const perLang = LANGS.map((l) => {
      const p = a.perLang[l];
      return `${l}=${p?.n ? (p.sum / p.n).toFixed(2) : 'n/a'}`;
    }).join(' ');
    console.log(
      `${c.padEnd(16)} | ${String(mean).padStart(4)} | ${wtl.padStart(19)} | ${perLang}`,
    );
  }
  if (agreePairs > 0) {
    const meanM = sumMine / agreePairs;
    const meanJ = sumJudge / agreePairs;
    let cov = 0;
    let varM = 0;
    let varJ = 0;
    for (let i = 0; i < agreePairs; i++) {
      cov += (prodMine[i] - meanM) * (prodJudge[i] - meanJ);
      varM += (prodMine[i] - meanM) ** 2;
      varJ += (prodJudge[i] - meanJ) ** 2;
    }
    const r = cov / Math.sqrt(varM * varJ);
    console.log(
      `\nAgreement with Gemini judge over ${agreePairs} shared judgments: ` +
        `my mean ${meanM.toFixed(2)} vs judge ${meanJ.toFixed(2)}, Pearson r=${r.toFixed(2)}`,
    );
  }
  if (missingItems > 0) {
    console.log(`(${missingItems} items had no scores and were skipped)`);
  }
}

const argv = process.argv.slice(2);
if (argv.includes('--export')) {
  doExport();
} else if (argv.includes('--aggregate')) {
  const scoresPath = argv.find((a) => a.startsWith('--scores='))?.split('=')[1];
  if (!scoresPath || !existsSync(scoresPath)) {
    console.error('Pass --scores=<path to scores JSON>');
    process.exit(1);
  }
  doAggregate(scoresPath);
} else {
  console.error('Pass --export or --aggregate --scores=<file>');
  process.exit(1);
}
