/**
 * Script to update essentialSentences.ts from Essential.csv
 * Run with: node scripts/updateEssentialSentences.js
 */

const fs = require('fs');
const path = require('path');

// Read the CSV file
const csvPath = path.join(__dirname, '..', 'data_preparation', 'data', 'output', 'sentences_by_difficulty', 'Essential.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

// Parse CSV (skip header, get text column)
const lines = csvContent.trim().split('\n').slice(1); // Skip header
const sentences = lines.map(line => {
  // Simple CSV parsing - handle quoted fields
  const match = line.match(/^\d+,"?([^"]+)"?/);
  if (match) {
    return match[1].replace(/""/g, '"'); // Unescape doubled quotes
  }
  // Fallback for non-quoted
  const parts = line.split(',');
  return parts[1];
}).filter(Boolean);

// Generate TypeScript file content
const today = new Date().toISOString().split('T')[0];
const tsContent = `/**
 * Essential sentences from Essential.csv
 * Auto-generated from data_preparation/data/output/sentences_by_difficulty/Essential.csv
 * Last updated: ${today}
 */

export const essentialSentences = [
${sentences.map(s => `  "${s.replace(/"/g, '\\"')}",`).join('\n')}
];
`;

// Write to convex/essentialSentences.ts
const outputPath = path.join(__dirname, '..', 'convex', 'essentialSentences.ts');
fs.writeFileSync(outputPath, tsContent, 'utf-8');

console.log(`✅ Updated essentialSentences.ts with ${sentences.length} sentences from Essential.csv`);
