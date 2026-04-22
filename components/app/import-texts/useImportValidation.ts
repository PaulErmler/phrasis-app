'use client';

import { useMemo } from 'react';
import { MAX_CARD_TEXT_LENGTH } from '@/lib/constants/learning';
import type {
  ColumnMapping,
  RowReason,
  RowStatus,
  ValidationResult,
} from './types';

export interface UseImportValidationOptions {
  rows: string[][];
  mapping: ColumnMapping;
  courseLanguages: string[];
  quotaBalance: number;
  quotaUnlimited: boolean;
  hasHeader: boolean;
}

function normalizeForDupKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isBlocking(reason: RowReason): boolean {
  return reason.code === 'EMPTY_CELL' || reason.code === 'TOO_LONG';
}

export function validateRows({
  rows,
  mapping,
  courseLanguages,
  quotaBalance,
  quotaUnlimited,
  hasHeader,
}: UseImportValidationOptions): ValidationResult {
  const mappedLanguages = Object.keys(mapping);
  const mappingComplete =
    courseLanguages.length > 0 &&
    courseLanguages.every((lang) => typeof mapping[lang] === 'number');

  const dataRows = hasHeader ? rows.slice(1) : rows;

  const statuses: RowStatus[] = [];
  const firstSeenByKey = new Map<string, number>();
  let validCount = 0;
  let warningCount = 0;
  let errorCount = 0;

  // Duplicate key: first course language. A row's "identity" is its source.
  const dupKeyLang = courseLanguages[0];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];

    if (!mappingComplete) {
      statuses.push({ kind: 'error', reasons: [] });
      errorCount++;
      continue;
    }

    const reasons: RowReason[] = [];
    const translations: { language: string; text: string }[] = [];
    for (const lang of courseLanguages) {
      const colIdx = mapping[lang];
      const raw = row[colIdx] ?? '';
      const text = raw.trim();
      if (text.length === 0) {
        reasons.push({ code: 'EMPTY_CELL', language: lang });
      } else if (text.length > MAX_CARD_TEXT_LENGTH) {
        reasons.push({ code: 'TOO_LONG', language: lang, length: text.length });
      }
      translations.push({ language: lang, text });
    }

    if (dupKeyLang && mapping[dupKeyLang] !== undefined) {
      const dupKey = normalizeForDupKey(row[mapping[dupKeyLang]] ?? '');
      if (dupKey.length > 0) {
        if (firstSeenByKey.has(dupKey)) {
          reasons.push({
            code: 'DUPLICATE_IN_FILE',
            firstSeenRowIndex: firstSeenByKey.get(dupKey)!,
          });
        } else {
          firstSeenByKey.set(dupKey, i);
        }
      }
    }

    if (reasons.length === 0) {
      statuses.push({ kind: 'valid', translations });
      validCount++;
    } else if (reasons.some(isBlocking)) {
      statuses.push({ kind: 'error', reasons });
      errorCount++;
    } else {
      // Only advisory issues (e.g. duplicate) — still importable.
      statuses.push({ kind: 'warning', translations, reasons });
      warningCount++;
    }
  }

  const importableCount = validCount + warningCount;
  const quotaSufficient = quotaUnlimited || importableCount <= quotaBalance;
  const canImport =
    mappingComplete &&
    errorCount === 0 &&
    importableCount > 0 &&
    quotaSufficient &&
    mappedLanguages.every((lang) => courseLanguages.includes(lang));

  return {
    statuses,
    validCount,
    warningCount,
    errorCount,
    importableCount,
    mappingComplete,
    quotaSufficient,
    canImport,
  };
}

export function useImportValidation(
  options: UseImportValidationOptions,
): ValidationResult {
  const courseLangsKey = options.courseLanguages.join(',');
  return useMemo(
    () => validateRows(options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      options.rows,
      options.mapping,
      courseLangsKey,
      options.quotaBalance,
      options.quotaUnlimited,
      options.hasHeader,
    ],
  );
}
