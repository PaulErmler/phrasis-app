import { ConvexHttpClient } from "convex/browser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, "../.env.local") });

// Initialize Convex client
let CONVEX_URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const ADMIN_KEY = process.env.CONVEX_ADMIN_KEY;
const SELF_HOST_URL = process.env.CONVEX_SELF_HOST_URL;

if (!CONVEX_URL && SELF_HOST_URL && ADMIN_KEY) {
  CONVEX_URL = SELF_HOST_URL.replace(/\/$/, "") + "?adminKey=" + ADMIN_KEY;
  console.log("Using self-hosted Convex deployment");
}

if (!CONVEX_URL) {
  console.error("Error: CONVEX_URL environment variable is not set.");
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);

/**
 * Robust CSV parser that handles:
 * - Quoted fields
 * - Escaped quotes ("")
 * - Newlines within quotes
 */
function parseCSV(content) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++; // Handle CRLF
      currentRow.push(currentField);
      if (currentRow.length > 1 || currentRow[0] !== "") {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      currentField += char;
    }
  }
  
  // Add last field/row if exists
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function parseTopics(topicsString) {
  if (!topicsString || topicsString.trim() === "") return [];
  return topicsString.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

async function uploadSentences() {
  const csvPath = path.join(__dirname, "../data_preparation/data/output/sentences.csv");
  console.log(`Reading CSV file from: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV file not found at ${csvPath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const allRows = parseCSV(fileContent);
  
  // First row is header
  const dataRows = allRows.slice(1);
  
  console.log(`Found ${dataRows.length} potential rows to process.`);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const fields = dataRows[i];

    // Basic validation: row should have enough fields
    if (fields.length < 5) {
      skippedCount++;
      continue;
    }

    const id = parseInt(fields[0], 10);
    const text = fields[1];
    const difficulty = fields[2];
    const rank = parseInt(fields[4], 10);
    const topicsString = fields[5] || "";

    // Skip if ID or rank is not a number, or if required text/deck is missing
    if (isNaN(id) || !text || !difficulty || isNaN(rank)) {
      skippedCount++;
      continue;
    }

    try {
      const topics = parseTopics(topicsString);
      
      await client.mutation("data_uploading/data_management:upsertSentence", {
        datasetSentenceId: id,
        text: text,
        language: "en",
        deck: difficulty,
        deckRank: rank,
        difficulty: difficulty,
        topic1: topics[0] || undefined,
        topic2: topics[1] || undefined,
      });

      successCount++;
      if (successCount % 100 === 0) {
        console.log(`Processed ${successCount} sentences... (Skipped: ${skippedCount}, Errors: ${errorCount})`);
      }
    } catch (error) {
      errorCount++;
      console.error(`Error processing sentence ID ${id}: ${error.message}`);
    }
  }

  console.log("\n=== Upload Complete ===");
  console.log(`Successfully uploaded: ${successCount}`);
  console.log(`Skipped (empty/malformed): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
}

uploadSentences()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Upload script failed:", error);
    process.exit(1);
  });
