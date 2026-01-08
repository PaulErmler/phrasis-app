/**
 * CSV Parser utility for parsing sentence data from Convex storage
 * Used by seedCards to load sentences for card import
 */

import { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import Papa from "papaparse";

export interface DefaultSentenceRow {
  id: string;
  text: string;
  difficulty: string;
  max_rank: string;
  rank: string;
  topics: string;
}

export interface ParsedSentence {
  datasetSentenceId: number;
  text: string;
  language: string;
  deck: string;
  deckRank: number;
  difficulty: string;
  topic1?: string;
  topic2?: string;
}

/**
 * Parse CSV file from Convex storage by name
 * Returns array of parsed sentences mapped to schema
 */
export async function parseCSVFromStorage(
  ctx: ActionCtx,
  csvName: string
): Promise<ParsedSentence[]> {
  try {
    // Get CSV file metadata from database
    const csvFile = await ctx.runQuery(api.fileUpload.getCSVFile, {
      name: csvName,
    });

    if (!csvFile) {
      console.error(`CSV file "${csvName}" not found in storage. Upload it first.`);
      return [];
    }

    // Read the CSV file from Convex storage
    const blob = await ctx.storage.get(csvFile.fileId);
    if (!blob) {
      throw new Error(`Failed to read CSV "${csvName}" from storage`);
    }

    // Convert Blob to ArrayBuffer, then to string
    const arrayBuffer = await blob.arrayBuffer();
    const fileContent = new TextDecoder().decode(arrayBuffer);

    // Parse CSV using papaparse
    const { data, errors } = Papa.parse<DefaultSentenceRow>(fileContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      transform: (value: string) => value.trim(),
    });

    if (errors.length > 0) {
      console.error("CSV parsing errors:", errors);
    }

    // Map CSV data to schema structure
    const sentences: ParsedSentence[] = data
      .map((row, index) => {
        // Parse topics if present (comma-separated)
        let topic1: string | undefined;
        let topic2: string | undefined;

        if (row.topics?.trim()) {
            const [topic1, topic2] = row.topics
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t);
        }

        // Determine deck: use id column if available, otherwise use index
        let deckValue = row.id?.trim() || String(index + 1);

        const parsed = {
        datasetSentenceId: parseInt(row.id, 10),
        text: row.text,
        language: "en",
        deck: deckValue,
        deckRank: parseInt(row.rank, 10),
        difficulty: row.difficulty,
        ...(topic1 && { topic1 }),
        ...(topic2 && { topic2 }),
        };
        return parsed.text ? parsed : null;
      })
      .filter((sentence): sentence is ParsedSentence => sentence !== null);

    console.log(`Parsed ${sentences.length} sentences from "${csvName}" CSV`);
    return sentences;
  } catch (error) {
    console.error(`Error parsing CSV "${csvName}":`, error);
    return [];
  }
}

/**
 * Get new sentences excluding those the user already has
 */
export function getNewSentences(
  sentences: ParsedSentence[],
  existingTexts: Set<string>,
  count: number
): ParsedSentence[] {
  return sentences
    .filter((sentence) => !existingTexts.has(sentence.text))
    .slice(0, count);
}
