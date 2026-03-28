#!/usr/bin/env node
/* eslint-env node */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCH_SIZE = 50;
const MAX_BUFFER_BYTES = 50 * 1024 * 1024;

const LANGUAGE_COLUMNS = [
  'es',
  'es_latam',
  'fr',
  'de',
  'it',
  'pt',
  'ru',
  'hi',
  'zh',
  'ja',
  'ko',
  'vi',
  'sv',
  'fi',
  'nl',
  'el',
  'ar',
];

const METADATA_CSV_TO_DB = {
  register: 'register',
  addressee_number: 'addresseeNumber',
  speaker_gender: 'speakerGender',
  addressee_gender: 'addresseeGender',
  tense_aspect: 'tenseAspect',
  sentence_type: 'sentenceType',
  literal_figurative: 'literalFigurative',
};

function runConvexMutation(functionPath, args) {
  const argsJson = JSON.stringify(args);

  const result = spawnSync('npx', ['convex', 'run', functionPath, argsJson], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: MAX_BUFFER_BYTES,
  });

  if (result.status !== 0) {
    const parts = [result.stderr, result.stdout, result.error?.message].filter(
      (s) => typeof s === 'string' && s.trim().length > 0,
    );
    const detail =
      parts.join('\n').trim() ||
      (result.error ? String(result.error) : '(no stderr/stdout/error message)');
    throw new Error(`Convex mutation failed: ${detail}`);
  }

  const trimmed = (result.stdout || '').trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return null;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function updateTranslations() {
  const csvPath = path.join(
    __dirname,
    '../data_preparation/data/output/sentences_translated.csv',
  );

  console.log('=== Update Translations ===');
  console.log(`CSV: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV not found at ${csvPath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });

  console.log(`Parsed ${records.length} rows from CSV`);

  const items = [];
  let skipped = 0;

  for (const row of records) {
    const datasetSentenceId = parseInt(row.id, 10);
    const textEn = (row.text_en || '').trim();

    if (isNaN(datasetSentenceId) || !textEn) {
      skipped++;
      continue;
    }

    const metadata = {};
    for (const [csvKey, dbKey] of Object.entries(METADATA_CSV_TO_DB)) {
      const val = (row[csvKey] || '').trim();
      if (val) {
        metadata[dbKey] = val;
      }
    }

    const translations = [];
    for (const lang of LANGUAGE_COLUMNS) {
      const text = (row[lang] || '').trim();
      if (text) {
        translations.push({ language: lang, text });
      }
    }

    if (translations.length === 0) {
      skipped++;
      continue;
    }

    items.push({
      datasetSentenceId,
      textEn,
      ...metadata,
      translations,
    });
  }

  console.log(`Valid items: ${items.length}, Skipped: ${skipped}`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  const batches = chunkArray(items, BATCH_SIZE);
  console.log(`Total batches: ${batches.length}\n`);

  const totals = {
    textsUpdated: 0,
    textsNotFound: 0,
    translationsInserted: 0,
    translationsUpdated: 0,
    translationsUnchanged: 0,
    audioInvalidated: 0,
  };

  /** @type {Set<number>} */
  const allNotFoundDatasetSentenceIds = new Set();

  const startTime = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    const pct = ((batchNum / batches.length) * 100).toFixed(1);

    try {
      const result = runConvexMutation('db/translationSeed:batchUpsertTranslations', {
        items: batch,
      });

      if (result) {
        for (const key of Object.keys(totals)) {
          totals[key] += result[key] || 0;
        }
        const nf = result.notFoundDatasetSentenceIds;
        if (Array.isArray(nf)) {
          for (const id of nf) {
            allNotFoundDatasetSentenceIds.add(id);
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (batchNum / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(
        `  Batch ${batchNum}/${batches.length} (${pct}%) — ` +
          `texts: ${result?.textsUpdated ?? 0} updated, ${result?.textsNotFound ?? 0} not found | ` +
          `translations: +${result?.translationsInserted ?? 0} =${result?.translationsUnchanged ?? 0} ~${result?.translationsUpdated ?? 0} | ` +
          `audio invalidated: ${result?.audioInvalidated ?? 0} | ` +
          `${elapsed}s elapsed, ${rate} batches/s`,
      );

      const nfIds = result?.notFoundDatasetSentenceIds;
      if (Array.isArray(nfIds) && nfIds.length > 0) {
        console.warn(
          `  [texts NOT FOUND] batch ${batchNum}/${batches.length}: ${nfIds.length} row(s) — no texts document for datasetSentenceId: ${nfIds.join(', ')}`,
        );
        const items = result?.notFoundItems;
        if (Array.isArray(items)) {
          for (const row of items) {
            console.warn(
              `    datasetSentenceId=${row.datasetSentenceId}  text_en preview: ${row.textEnPreview}`,
            );
          }
        }
      }
    } catch (error) {
      console.error(`  Batch ${batchNum}/${batches.length} FAILED: ${error.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=== Summary ===');
  console.log(`Time: ${elapsed}s`);
  console.log(`Texts updated: ${totals.textsUpdated}`);
  console.log(`Texts not found (count): ${totals.textsNotFound}`);
  console.log(`Translations inserted: ${totals.translationsInserted}`);
  console.log(`Translations updated (text changed): ${totals.translationsUpdated}`);
  console.log(`Translations unchanged: ${totals.translationsUnchanged}`);
  console.log(`Audio recordings invalidated: ${totals.audioInvalidated}`);

  const sortedUniqueNotFound = [...allNotFoundDatasetSentenceIds].sort((a, b) => a - b);
  console.log(
    `\nDataset sentence IDs with no matching texts row (unique, sorted): ${sortedUniqueNotFound.length}`,
  );
  if (sortedUniqueNotFound.length > 0) {
    console.log(sortedUniqueNotFound.join(', '));
  }
}

updateTranslations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Update translations failed:', error);
    process.exit(1);
  });
