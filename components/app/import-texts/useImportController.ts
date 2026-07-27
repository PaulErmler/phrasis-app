'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { isPaymentPastDueError } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslations, useLocale } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { useCourseLanguages } from '@/hooks/use-course-languages';
import { getUserTimezone } from '@/lib/timezone';
import { MAX_IMPORT_FILE_BYTES } from '@/lib/constants/learning';
import { useImportParsing } from './useImportParsing';
import { useImportValidation } from './useImportValidation';
import { autoMapColumns, detectHasHeader } from './importHeuristics';
import type { ColumnMapping, ImportDelimiter, RowStatus } from './types';

export interface ImportController {
  // course
  courseLanguages: string[];

  // input state
  input: string;
  setInput: (s: string) => void;
  fileName: string | null;
  setFileName: (n: string | null) => void;
  onFileSelected: (file: File) => Promise<void>;

  // parse options
  delimiter: ImportDelimiter;
  setDelimiter: (d: ImportDelimiter) => void;
  hasHeader: boolean;
  setHasHeader: (v: boolean) => void;

  // parse result
  rows: string[][];
  columnCount: number;
  detectedDelimiter: string;

  // mapping
  mapping: ColumnMapping;
  setMappingForLanguage: (lang: string, colIndex: number | null) => void;
  resetMapping: () => void;

  // validation + derived
  validation: ReturnType<typeof useImportValidation>;
  dataRows: string[][];
  /**
   * For each entry in `dataRows`, its corresponding index in the original
   * parsed rows. Stable across edits; a row's absolute index is its identity.
   */
  dataRowAbsolute: number[];

  /** Edit a single cell (for inline fixes on the Review step). `dataRowIndex`
   * is the index into `dataRows` (i.e. header already skipped if present). */
  updateCell: (dataRowIndex: number, language: string, newText: string) => void;
  /** Drop a row entirely from the import. `dataRowIndex` addresses `dataRows`. */
  deleteRow: (dataRowIndex: number) => void;

  // quota
  quotaBalance: number;
  quotaUnlimited: boolean;
  quotaLoading: boolean;

  // submission
  isSubmitting: boolean;
  submit: () => Promise<void>;
  paywallOpen: boolean;
  setPaywallOpen: (open: boolean) => void;

  // reset whole state
  reset: () => void;
}

/**
 * All state + behavior needed by the import view. Separated from render so
 * the same state machine can be shared between the live view and the preview
 * scenarios.
 */
export function useImportController(onSuccess?: () => void): ImportController {
  const t = useTranslations('ImportTexts');
  const locale = useLocale();
  const { baseLanguages, targetLanguages } = useCourseLanguages();
  const quota = useFeatureQuota(FEATURE_IDS.CUSTOM_SENTENCES);
  const createBatch = useMutation(api.features.customTexts.createCustomTextsBatch);

  const courseLanguages = useMemo(
    () => [
      ...baseLanguages.filter((l) => !targetLanguages.includes(l)),
      ...targetLanguages,
    ],
    [baseLanguages, targetLanguages],
  );
  const courseLangsKey = courseLanguages.join(',');

  const [input, setInput] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState<ImportDelimiter>('auto');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  /** Cell overrides keyed by `${absoluteRowIndex}:${colIndex}`. */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  /** Absolute parsed-row indices that the user has deleted from the import. */
  const [deletedAbsoluteRows, setDeletedAbsoluteRows] = useState<Set<number>>(new Set());

  /** Becomes `true` once the user has manually edited hasHeader. */
  const headerTouchedRef = useRef(false);
  /** Becomes `true` once the user has manually edited mapping. */
  const mappingTouchedRef = useRef(false);

  const parsed = useImportParsing({ input, delimiter });

  // Auto-detect hasHeader and auto-map columns when the input changes, unless
  // the user has manually touched these controls.
  const parsedRowsSignature = parsed.rows.map((r) => r.join('\u0001')).join('\u0002');
  useEffect(() => {
    if (parsed.rows.length === 0) return;
    const wantsHeader = detectHasHeader(parsed.rows[0], locale);
    let effectiveHasHeader = hasHeader;
    if (!headerTouchedRef.current) {
      effectiveHasHeader = wantsHeader;
      if (wantsHeader !== hasHeader) setHasHeader(wantsHeader);
    }
    if (!mappingTouchedRef.current && effectiveHasHeader) {
      const next = autoMapColumns(parsed.rows[0], courseLanguages, locale);
      if (Object.keys(next).length > 0) setMapping(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedRowsSignature, courseLangsKey, locale]);

  /**
   * Rows fed into validation. Overrides are applied; deleted data rows are
   * removed. The header row (if any) is always kept at index 0 so that
   * validation's internal hasHeader slicing still works.
   */
  const effectiveRows = useMemo(() => {
    const withOverrides = parsed.rows.map((row, abs) => {
      let next: string[] | null = null;
      for (let col = 0; col < row.length; col++) {
        const key = `${abs}:${col}`;
        if (key in overrides) {
          if (!next) next = [...row];
          next[col] = overrides[key];
        }
      }
      return next ?? row;
    });
    if (deletedAbsoluteRows.size === 0) return withOverrides;
    return withOverrides.filter((_, abs) => !deletedAbsoluteRows.has(abs));
  }, [parsed.rows, overrides, deletedAbsoluteRows]);

  /** Absolute parsed-row index for each entry in dataRows. */
  const dataRowAbsolute = useMemo(() => {
    const out: number[] = [];
    const start = hasHeader ? 1 : 0;
    for (let abs = start; abs < parsed.rows.length; abs++) {
      if (!deletedAbsoluteRows.has(abs)) out.push(abs);
    }
    return out;
  }, [parsed.rows, hasHeader, deletedAbsoluteRows]);

  const validation = useImportValidation({
    rows: effectiveRows,
    mapping,
    courseLanguages,
    quotaBalance: quota.balance,
    quotaUnlimited: quota.unlimited,
    hasHeader,
  });

  const dataRows = useMemo(
    () => (hasHeader ? effectiveRows.slice(1) : effectiveRows),
    [effectiveRows, hasHeader],
  );

  const setHasHeaderTouched = useCallback((v: boolean) => {
    headerTouchedRef.current = true;
    setHasHeader(v);
  }, []);

  const setMappingForLanguage = useCallback(
    (lang: string, colIndex: number | null) => {
      mappingTouchedRef.current = true;
      setMapping((prev) => {
        const next = { ...prev };
        if (colIndex !== null) {
          for (const key of Object.keys(next)) {
            if (next[key] === colIndex) delete next[key];
          }
        }
        if (colIndex === null) {
          delete next[lang];
        } else {
          next[lang] = colIndex;
        }
        return next;
      });
    },
    [],
  );

  const resetMapping = useCallback(() => {
    mappingTouchedRef.current = true;
    setMapping({});
  }, []);

  const updateCell = useCallback(
    (dataRowIndex: number, language: string, newText: string) => {
      const absolute = dataRowAbsolute[dataRowIndex];
      const colIndex = mapping[language];
      if (absolute === undefined || colIndex === undefined) return;
      setOverrides((prev) => ({ ...prev, [`${absolute}:${colIndex}`]: newText }));
    },
    [dataRowAbsolute, mapping],
  );

  const deleteRow = useCallback(
    (dataRowIndex: number) => {
      const absolute = dataRowAbsolute[dataRowIndex];
      if (absolute === undefined) return;
      setDeletedAbsoluteRows((prev) => {
        if (prev.has(absolute)) return prev;
        const next = new Set(prev);
        next.add(absolute);
        return next;
      });
    },
    [dataRowAbsolute],
  );

  const setInputFresh = useCallback((s: string) => {
    headerTouchedRef.current = false;
    mappingTouchedRef.current = false;
    setMapping({});
    setOverrides({});
    setDeletedAbsoluteRows(new Set());
    setInput(s);
  }, []);

  const onFileSelected = useCallback(async (file: File) => {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      const maxMb = Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024));
      toast.error(t('file.tooLarge', { maxMb }));
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast.error(t('file.readError'));
      return;
    }
    headerTouchedRef.current = false;
    mappingTouchedRef.current = false;
    setMapping({});
    setOverrides({});
    setDeletedAbsoluteRows(new Set());
    setInput(text);
    setFileName(file.name);
  }, [t]);

  const reset = useCallback(() => {
    headerTouchedRef.current = false;
    mappingTouchedRef.current = false;
    setInput('');
    setFileName(null);
    setMapping({});
    setOverrides({});
    setDeletedAbsoluteRows(new Set());
    setDelimiter('auto');
    setHasHeader(true);
  }, []);

  const submit = useCallback(async () => {
    if (!validation.canImport) return;

    const items = validation.statuses
      .filter(
        (
          s,
        ): s is Extract<RowStatus, { kind: 'valid' | 'warning' }> =>
          s.kind === 'valid' || s.kind === 'warning',
      )
      .map((s) => ({ translations: s.translations }));

    if (items.length === 0) return;

    setIsSubmitting(true);
    try {
      const res = await createBatch({
        items,
        timezone: getUserTimezone(),
      });

      const imported = res.createdTextIds.length;
      const total = items.length;
      const skipped = res.skipped.length;

      if (skipped === 0) {
        toast.success(t('success', { count: imported }));
      } else {
        toast.warning(
          t('partialSuccess', { count: imported, total, skipped }),
        );
      }
      if (imported > 0) {
        reset();
        onSuccess?.();
      }
    } catch (err) {
      // Silent: the reactive payment-overdue dialog is the canonical
      // surface for this state (see isPaymentPastDueError).
      if (isPaymentPastDueError(err)) {
        return;
      }
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        'code' in err.data &&
        err.data.code === 'USAGE_LIMIT'
      ) {
        setPaywallOpen(true);
        return;
      }
      console.error('Bulk import failed:', err);
      toast.error(t('failure'));
    } finally {
      setIsSubmitting(false);
    }
  }, [validation, createBatch, t, reset, onSuccess]);

  return {
    courseLanguages,
    input,
    setInput: setInputFresh,
    fileName,
    setFileName,
    onFileSelected,
    delimiter,
    setDelimiter,
    hasHeader,
    setHasHeader: setHasHeaderTouched,
    rows: effectiveRows,
    columnCount: parsed.columnCount,
    detectedDelimiter: parsed.detectedDelimiter,
    mapping,
    setMappingForLanguage,
    resetMapping,
    validation,
    dataRows,
    dataRowAbsolute,
    updateCell,
    deleteRow,
    quotaBalance: quota.balance,
    quotaUnlimited: quota.unlimited,
    quotaLoading: quota.isLoading,
    isSubmitting,
    submit,
    paywallOpen,
    setPaywallOpen,
    reset,
  };
}
