import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "../data_preparation/data/output/sentences.csv");
const cleanCsvPath = path.join(__dirname, "../data_preparation/data/output/sentences_cleaned.csv");

console.log(`Cleaning CSV: ${csvPath}`);

function cleanCSV() {
  const content = fs.readFileSync(csvPath, "utf-8");
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
        i++; 
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentRow.push(currentField.trim());
      if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      // If we are inside quotes, we replace newlines/tabs/extra spaces with a single space
      if (inQuotes && (char === "\n" || char === "\r" || char === "\t")) {
        if (currentField[currentField.length - 1] !== " ") {
          currentField += " ";
        }
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Write back to a clean CSV
  const cleanContent = rows
    .map(row => 
      row.map(field => {
        // Re-quote if it contains commas or was originally quoted
        if (field.includes(",") || field.includes('"')) {
          return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
      }).join(",")
    )
    .join("\n");

  fs.writeFileSync(cleanCsvPath, cleanContent);
  console.log(`Cleaned CSV saved to: ${cleanCsvPath}`);
  console.log(`Processed ${rows.length} rows.`);
}

cleanCSV();

