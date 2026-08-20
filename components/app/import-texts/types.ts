export type ImportDelimiter = ',' | ';' | '\t' | '|' | 'auto';

export interface ParsedSheet {
  rows: string[][];
  columnCount: number;
  detectedDelimiter: string;
  parseErrors: string[];
}

/**
 * Mapping from language code -> column index in the parsed sheet.
 * Unmapped languages are absent from the record.
 */
export type ColumnMapping = Record<string, number>;

export type RowReason =
  | { code: 'EMPTY_CELL'; language: string }
  | { code: 'TOO_LONG'; language: string; length: number }
  | { code: 'DUPLICATE_IN_FILE'; firstSeenRowIndex: number };

export type RowStatus =
  | {
      kind: 'valid';
      translations: { language: string; text: string }[];
    }
  | {
      kind: 'warning';
      translations: { language: string; text: string }[];
      reasons: RowReason[];
    }
  | {
      kind: 'error';
      reasons: RowReason[];
    };

export interface ValidationResult {
  statuses: RowStatus[];
  /** Rows with no issues. */
  validCount: number;
  /** Rows with advisory issues (e.g. duplicates), still importable. */
  warningCount: number;
  /** Rows with blocking issues, not importable. */
  errorCount: number;
  /** validCount + warningCount. Rows that will actually be imported. */
  importableCount: number;
  mappingComplete: boolean;
  quotaSufficient: boolean;
  canImport: boolean;
}
