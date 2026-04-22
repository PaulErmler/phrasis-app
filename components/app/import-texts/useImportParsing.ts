'use client';

import { useMemo } from 'react';
import Papa from 'papaparse';
import type { ImportDelimiter, ParsedSheet } from './types';

const EMPTY: ParsedSheet = {
  rows: [],
  columnCount: 0,
  detectedDelimiter: '',
  parseErrors: [],
};

export interface UseImportParsingOptions {
  input: string;
  delimiter?: ImportDelimiter;
}

export function parseSheet({ input, delimiter = 'auto' }: UseImportParsingOptions): ParsedSheet {
  if (!input || input.trim().length === 0) return EMPTY;

  // Strip BOM so the first cell is clean.
  const cleanInput = input.replace(/^\uFEFF/, '');

  const papaDelimiter = delimiter === 'auto' ? '' : delimiter;

  const result = Papa.parse<string[]>(cleanInput, {
    delimiter: papaDelimiter,
    // Tell Papa which candidates to consider when auto-detecting.
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: 'greedy',
    transform: (value) => value.trim(),
  });

  const rows = (result.data ?? []).filter(
    (row): row is string[] => Array.isArray(row) && row.some((cell) => cell.length > 0),
  );

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  // Normalize ragged rows to the widest column count with empty strings.
  const normalized = rows.map((row) => {
    if (row.length >= columnCount) return row;
    const padded = [...row];
    while (padded.length < columnCount) padded.push('');
    return padded;
  });

  return {
    rows: normalized,
    columnCount,
    detectedDelimiter: result.meta?.delimiter ?? papaDelimiter,
    parseErrors: (result.errors ?? []).map((e) => e.message),
  };
}

export function useImportParsing(options: UseImportParsingOptions): ParsedSheet {
  const { input, delimiter } = options;
  return useMemo(() => parseSheet({ input, delimiter }), [input, delimiter]);
}
