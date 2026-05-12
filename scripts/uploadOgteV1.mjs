#!/usr/bin/env node
/* eslint-env node */
/**
 * Upload the OGTE curated dataset V1 to Convex.
 *
 * Reads `data_preparation/ogte-dataset/data/output/levels_curated/ogte_*.csv`
 * and creates:
 *   - one `datasets` row (slug=ogte-curated, version=passed as arg, isActive=false)
 *   - 20 `collections` rows, one per level, with CEFR tier and order set
 *   - ~20k `texts` rows, with stable externalId from the CSV `id` column
 *
 * Idempotent — re-running with the same version is safe. Activation
 * (flipping isActive=true) is a separate admin step.
 *
 * Usage:
 *   node scripts/uploadOgteV1.mjs --version 1.0.0
 *   node scripts/uploadOgteV1.mjs --version 1.0.1 --slug ogte-curated
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCH_SIZE = 500;
const MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const DEFAULT_SLUG = 'ogte-curated';

const LEVELS_DIR = path.join(
  __dirname,
  '../data_preparation/ogte-dataset/data/output/levels_curated',
);

/**
 * Per-level metadata. The displayName is the human label corresponding to the
 * filename suffix; cefrTier follows the agreed mapping (L02 promoted into A1,
 * L20 folded into C2).
 */
const LEVELS = [
  { order: 1, code: 'L01', cefrTier: 'Pre-A1', displayName: 'Pre-A1', file: 'ogte_01_alphabet.csv' },
  { order: 2, code: 'L02', cefrTier: 'A1', displayName: 'A1.1', file: 'ogte_02_early_beginner.csv' },
  { order: 3, code: 'L03', cefrTier: 'A1', displayName: 'A1.2', file: 'ogte_03_mid_beginner.csv' },
  { order: 4, code: 'L04', cefrTier: 'A1', displayName: 'A1.3', file: 'ogte_04_high_beginner.csv' },
  { order: 5, code: 'L05', cefrTier: 'A2', displayName: 'A2.1', file: 'ogte_05_early_elementary.csv' },
  { order: 6, code: 'L06', cefrTier: 'A2', displayName: 'A2.2', file: 'ogte_06_mid_elementary.csv' },
  { order: 7, code: 'L07', cefrTier: 'A2', displayName: 'A2.3', file: 'ogte_07_high_elementary.csv' },
  { order: 8, code: 'L08', cefrTier: 'B1', displayName: 'B1.1', file: 'ogte_08_early_intermediate.csv' },
  { order: 9, code: 'L09', cefrTier: 'B1', displayName: 'B1.2', file: 'ogte_09_mid_intermediate.csv' },
  { order: 10, code: 'L10', cefrTier: 'B1', displayName: 'B1.3', file: 'ogte_10_high_intermediate.csv' },
  { order: 11, code: 'L11', cefrTier: 'B2', displayName: 'B2.1', file: 'ogte_11_early_upper_intermediate.csv' },
  { order: 12, code: 'L12', cefrTier: 'B2', displayName: 'B2.2', file: 'ogte_12_mid_upper_intermediate.csv' },
  { order: 13, code: 'L13', cefrTier: 'B2', displayName: 'B2.3', file: 'ogte_13_high_upper_intermediate.csv' },
  { order: 14, code: 'L14', cefrTier: 'C1', displayName: 'C1.1', file: 'ogte_14_early_advanced.csv' },
  { order: 15, code: 'L15', cefrTier: 'C1', displayName: 'C1.2', file: 'ogte_15_mid_advanced.csv' },
  { order: 16, code: 'L16', cefrTier: 'C1', displayName: 'C1.3', file: 'ogte_16_high_advanced.csv' },
  { order: 17, code: 'L17', cefrTier: 'C2', displayName: 'C2.1', file: 'ogte_17_early_near_native.csv' },
  { order: 18, code: 'L18', cefrTier: 'C2', displayName: 'C2.2', file: 'ogte_18_mid_near_native.csv' },
  { order: 19, code: 'L19', cefrTier: 'C2', displayName: 'C2.3', file: 'ogte_19_high_near_native.csv' },
  { order: 20, code: 'L20', cefrTier: 'C2', displayName: 'C2.4', file: 'ogte_20_native.csv' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { slug: DEFAULT_SLUG };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      out.version = args[++i];
    } else if (args[i] === '--slug' && args[i + 1]) {
      out.slug = args[++i];
    } else if (args[i] === '--description' && args[i + 1]) {
      out.description = args[++i];
    }
  }
  if (!out.version) {
    console.error('ERROR: --version <semver> is required (e.g. --version 1.0.0)');
    process.exit(1);
  }
  return out;
}

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

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mapRegister(formality) {
  // Dataset's `formality` column is one of: formal, informal, neutral, n/a, ''.
  // texts.register stores formal/informal/neutral; everything else → null.
  if (formality === 'formal' || formality === 'informal' || formality === 'neutral') {
    return formality;
  }
  return undefined;
}

function mapAddresseeNumber(register) {
  // OGTE's `register` column is 'direct-address' or 'descriptive'. The schema's
  // `addresseeNumber` field encodes whether a sentence has an addressee at all:
  //   - descriptive → 'not_applicable' (translations skip T/V pronoun choice)
  //   - direct-address → undefined here, since the CSV doesn't say singular vs
  //     plural. The LLM classifier in convex/features/sentenceMetadata.ts can
  //     fill that in on demand.
  if (register === 'descriptive') return 'not_applicable';
  return undefined;
}

async function main() {
  const args = parseArgs();
  console.log(`Uploading OGTE dataset: slug=${args.slug} version=${args.version}`);

  if (!fs.existsSync(LEVELS_DIR)) {
    console.error(`ERROR: levels_curated directory not found at ${LEVELS_DIR}`);
    process.exit(1);
  }

  // Step 1 — create-or-get the dataset row.
  const datasetId = runConvexMutation('admin/uploadDataset:createOrGetDataset', {
    slug: args.slug,
    version: args.version,
    ...(args.description ? { description: args.description } : {}),
  });
  console.log(`Dataset id: ${datasetId}`);

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const level of LEVELS) {
    const csvPath = path.join(LEVELS_DIR, level.file);
    if (!fs.existsSync(csvPath)) {
      console.warn(`  Missing CSV for ${level.code}: ${csvPath} — skipping`);
      continue;
    }
    console.log(`\n=== ${level.code} (${level.cefrTier}) — ${level.displayName} ===`);

    // Step 2 — upsert the collection.
    const collectionId = runConvexMutation('admin/uploadDataset:upsertDatasetCollection', {
      datasetId,
      code: level.code,
      cefrTier: level.cefrTier,
      order: level.order,
      displayName: level.displayName,
    });
    console.log(`  collectionId: ${collectionId}`);

    // Step 3 — parse CSV.
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // CSV row order = pedagogical rank. Use 1-based ranks so existing
    // "lastRankProcessed > 0 = at least one card added" semantics hold.
    const validTexts = [];
    let skippedCount = 0;
    let rank = 0;
    for (const row of records) {
      rank++;
      const externalId = (row.id ?? '').trim();
      const text = row.text;
      if (!externalId || !text) {
        skippedCount++;
        continue;
      }
      validTexts.push({
        externalId,
        text,
        collectionRank: rank,
        // Always include `register` and `addresseeNumber` so re-uploads can
        // clear a previously-set value. `null` is the sentinel for "clear"
        // (Convex strips `undefined` over the wire, so we can't use that here).
        register: mapRegister(row.formality) ?? null,
        addresseeNumber: mapAddresseeNumber(row.register) ?? null,
      });
    }
    console.log(`  parsed ${validTexts.length} rows (skipped ${skippedCount})`);

    // Step 4 — batch upload.
    const batches = chunkArray(validTexts, BATCH_SIZE);
    let levelInserted = 0;
    let levelUpdated = 0;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const result = runConvexMutation('admin/uploadDataset:batchUpsertDatasetTexts', {
        datasetId,
        collectionId,
        texts: batch,
      });
      levelInserted += result.inserted;
      levelUpdated += result.updated;
      console.log(`  batch ${i + 1}/${batches.length}: +${result.inserted} new, ~${result.updated} updated`);
    }

    totalInserted += levelInserted;
    totalUpdated += levelUpdated;
    totalSkipped += skippedCount;
    console.log(`  ${level.code} done: ${levelInserted} inserted, ${levelUpdated} updated, ${skippedCount} skipped`);
  }

  console.log('\n=== Upload Complete ===');
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total updated:  ${totalUpdated}`);
  console.log(`Total skipped:  ${totalSkipped}`);
  console.log(`Dataset ${datasetId} is INACTIVE — activate it via admin/activateDataset when ready.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Upload failed:', err);
    process.exit(1);
  });
