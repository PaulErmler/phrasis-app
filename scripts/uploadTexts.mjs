#!/usr/bin/env node
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BATCH_SIZE = 500;
const MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB
const DIFFICULTY_LEVELS = ["Essential", "A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Run a Convex internal mutation via CLI
 */
function runConvexMutation(functionPath, args) {
  const argsJson = JSON.stringify(args);

  const result = spawnSync("npx", ["convex", "run", functionPath, argsJson], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf-8",
    stdio: "pipe",
    maxBuffer: MAX_BUFFER_BYTES,
  });

  if (result.status !== 0) {
    throw new Error(`Convex mutation failed: ${result.stderr || result.stdout}`);
  }

  const trimmed = (result.stdout || "").trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return null;
}

/**
 * Split array into chunks of specified size
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function uploadTexts() {
  const difficultyDir = path.join(
    __dirname,
    "../data_preparation/data/output/sentences_by_difficulty"
  );

  console.log(`Reading CSV files from: ${difficultyDir}`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  if (!fs.existsSync(difficultyDir)) {
    console.error(`Error: Directory not found at ${difficultyDir}`);
    process.exit(1);
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const level of DIFFICULTY_LEVELS) {
    const csvPath = path.join(difficultyDir, `${level}.csv`);

    if (!fs.existsSync(csvPath)) {
      console.log(`Skipping ${level}: File not found at ${csvPath}`);
      continue;
    }

    console.log(`\n=== Processing ${level} ===`);

    // Step 1: Create/upsert collection for this difficulty level
    let collectionId;
    try {
      collectionId = runConvexMutation(
        "data_uploading/data_management:upsertCollection",
        { name: level }
      );
      console.log(`Collection '${level}' ready (ID: ${collectionId})`);
    } catch (error) {
      console.error(`Error creating collection '${level}': ${error.message}`);
      continue;
    }

    // Step 2: Read and parse CSV
    const fileContent = fs.readFileSync(csvPath, "utf-8");
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`Found ${records.length} rows to process.`);

    // Step 3: Prepare text records (filter invalid ones)
    const validTexts = [];
    let skippedCount = 0;

    for (const row of records) {
      const id = parseInt(row.id, 10);
      const text = row.text;
      const rank = parseInt(row.rank, 10);

      if (isNaN(id) || !text || isNaN(rank)) {
        skippedCount++;
        continue;
      }

      validTexts.push({
        datasetSentenceId: id,
        text: text,
        language: "en",
        collectionId: collectionId,
        collectionRank: rank,
      });
    }

    console.log(`Valid texts: ${validTexts.length}, Skipped: ${skippedCount}`);

    // Step 4: Upload in batches
    const batches = chunkArray(validTexts, BATCH_SIZE);
    let levelInserted = 0;
    let levelUpdated = 0;
    let levelErrors = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNum = i + 1;

      try {
        const result = runConvexMutation(
          "data_uploading/data_management:batchUpsertTexts",
          { texts: batch }
        );

        levelInserted += result.inserted;
        levelUpdated += result.updated;

        console.log(
          `  Batch ${batchNum}/${batches.length}: ${result.inserted} inserted, ${result.updated} updated`
        );
      } catch (error) {
        levelErrors += batch.length;
        console.error(`  Batch ${batchNum}/${batches.length} FAILED: ${error.message}`);
      }
    }

    console.log(
      `${level} complete: ${levelInserted} inserted, ${levelUpdated} updated, ${skippedCount} skipped, ${levelErrors} errors`
    );

    totalInserted += levelInserted;
    totalUpdated += levelUpdated;
    totalSkipped += skippedCount;
    totalErrors += levelErrors;
  }

  console.log("\n=== Upload Complete ===");
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total updated: ${totalUpdated}`);
  console.log(`Total skipped (empty/malformed): ${totalSkipped}`);
  console.log(`Total errors: ${totalErrors}`);
}

uploadTexts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upload script failed:", error);
    process.exit(1);
  });
