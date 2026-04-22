'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Upload, AlertTriangle, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import type { ImportDelimiter, RowStatus } from './types';
import { MAX_CARD_TEXT_LENGTH, MAX_IMPORT_BATCH } from '@/lib/constants/learning';

interface FileDropzoneProps {
  fileName: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
  compact?: boolean;
  /** When provided, an info checklist is shown inside the empty dropzone. */
  courseLanguages?: string[];
}

export function FileDropzone({
  fileName,
  onFile,
  onClear,
  compact,
  courseLanguages,
}: FileDropzoneProps) {
  const t = useTranslations('ImportTexts');
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  const languageList = courseLanguages
    ?.map((l) => getLocalizedLanguageNameByCode(l, locale))
    .join(', ');

  const showInfo = !fileName && !compact && courseLanguages && courseLanguages.length > 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={0}
      data-testid="import-dropzone"
      className={cn(
        'rounded-lg border-2 border-dashed bg-muted/30 transition-colors cursor-pointer',
        isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        compact ? 'p-3' : 'p-6',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        className="hidden"
        data-testid="import-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      {fileName ? (
        <div className="flex items-center gap-2 text-sm">
          <Upload className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate font-medium">{fileName}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Upload className={cn('text-muted-foreground', compact ? 'h-5 w-5' : 'h-6 w-6')} />
          <p className="text-sm font-medium">{t('dropzone.title')}</p>
          {!compact && (
            <p className="text-xs text-muted-foreground">{t('dropzone.subtitle')}</p>
          )}
          {showInfo && (
            <ul
              className="mt-3 text-xs text-muted-foreground text-left space-y-1 w-full max-w-sm mx-auto"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600" />
                <span>
                  {t('dropzone.info.columns', { languages: languageList ?? '' })}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600" />
                <span>{t('dropzone.info.separators')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600" />
                <span>
                  {t('dropzone.info.maxLength', { max: MAX_CARD_TEXT_LENGTH })}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600" />
                <span>
                  {t('dropzone.info.maxRows', { max: MAX_IMPORT_BATCH })}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600" />
                <span>{t('dropzone.info.headerOptional')}</span>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface DelimiterSelectProps {
  value: ImportDelimiter;
  onChange: (v: ImportDelimiter) => void;
  detected?: string;
}

export function DelimiterSelect({ value, onChange, detected }: DelimiterSelectProps) {
  const t = useTranslations('ImportTexts');
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="import-delimiter">{t('delimiter.label')}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as ImportDelimiter)}>
        <SelectTrigger id="import-delimiter" data-testid="import-delimiter" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">
            {t('delimiter.auto')}
            {detected ? ` (${displayDelimiter(detected)})` : ''}
          </SelectItem>
          <SelectItem value=",">{t('delimiter.comma')}</SelectItem>
          <SelectItem value=";">{t('delimiter.semicolon')}</SelectItem>
          <SelectItem value={'\t'}>{t('delimiter.tab')}</SelectItem>
          <SelectItem value="|">{t('delimiter.pipe')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function displayDelimiter(d: string): string {
  if (d === '\t') return '⇥';
  if (d === ' ') return '␣';
  return d;
}

interface ColumnMappingSelectProps {
  language: string;
  columnCount: number;
  selectedColumn: number | undefined;
  sampleRow?: string[];
  hasHeader: boolean;
  headerRow?: string[];
  onChange: (colIndex: number | null) => void;
}

export function ColumnMappingSelect({
  language,
  columnCount,
  selectedColumn,
  sampleRow,
  headerRow,
  hasHeader,
  onChange,
}: ColumnMappingSelectProps) {
  const t = useTranslations('ImportTexts');
  const locale = useLocale();
  const langName = getLocalizedLanguageNameByCode(language, locale);
  const currentValue = typeof selectedColumn === 'number' ? String(selectedColumn) : 'none';
  const columnLabel = (i: number) =>
    hasHeader && headerRow?.[i]?.trim().length
      ? headerRow[i]
      : t('mapping.columnLabel', { index: i + 1 });

  const triggerLabel =
    typeof selectedColumn === 'number' ? columnLabel(selectedColumn) : null;

  return (
    <div className="space-y-1">
      <Label>{langName}</Label>
      <Select
        value={currentValue}
        onValueChange={(v) => onChange(v === 'none' ? null : parseInt(v, 10))}
      >
        <SelectTrigger data-testid={`import-mapping-${language}`} className="w-full">
          {triggerLabel !== null ? (
            <span className="truncate">{triggerLabel}</span>
          ) : (
            <SelectValue placeholder={t('mapping.notMapped')} />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('mapping.notMapped')}</SelectItem>
          {Array.from({ length: columnCount }, (_, i) => {
            const sample = sampleRow?.[i];
            return (
              <SelectItem key={i} value={String(i)}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{columnLabel(i)}</span>
                  {sample ? (
                    <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                      {sample}
                    </span>
                  ) : null}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

interface HeaderToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

export function HeaderToggle({ value, onChange }: HeaderToggleProps) {
  const t = useTranslations('ImportTexts');
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <Checkbox
        checked={value}
        onCheckedChange={(v) => onChange(v === true)}
        data-testid="import-has-header"
      />
      <span>{t('hasHeader')}</span>
    </label>
  );
}

interface SummaryBarProps {
  importableCount: number;
  warningCount: number;
  errorCount: number;
  quotaBalance: number;
  quotaUnlimited: boolean;
  quotaLoading: boolean;
  isSubmitting: boolean;
  canImport: boolean;
  onImport: () => void;
  extra?: ReactNode;
}

export function SummaryBar({
  importableCount,
  warningCount,
  errorCount,
  quotaBalance,
  quotaUnlimited,
  quotaLoading,
  isSubmitting,
  canImport,
  onImport,
  extra,
}: SummaryBarProps) {
  const t = useTranslations('ImportTexts');
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm w-full">
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{importableCount}</span>
          <span>{t('summary.valid')}</span>
        </span>
        {warningCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-medium tabular-nums">{warningCount}</span>
            <span>{t('summary.warnings')}</span>
          </span>
        )}
        {errorCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 text-destructive px-2 py-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-medium tabular-nums">{errorCount}</span>
            <span>{t('summary.errors')}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
          {quotaUnlimited ? (
            t('summary.quotaUnlimited')
          ) : quotaLoading ? (
            '…'
          ) : (
            <>
              <span className="font-medium tabular-nums text-foreground">{quotaBalance}</span>
              <span>{t('summary.quotaRemaining')}</span>
            </>
          )}
        </span>
        {extra}
      </div>
      <Button
        className="w-full sm:w-auto sm:ms-auto gap-2 shrink-0"
        onClick={onImport}
        disabled={!canImport || isSubmitting}
        data-testid="import-submit"
      >
        {isSubmitting
          ? t('importing')
          : importableCount > 0
            ? t('importButton', { count: importableCount })
            : t('importButtonEmpty')}
      </Button>
    </div>
  );
}

/**
 * Renders short human-readable badges for a row's validation issues.
 */
export function RowErrorBadges({ status }: { status: RowStatus }) {
  const t = useTranslations('ImportTexts');
  const locale = useLocale();
  if (status.kind === 'valid') return null;
  if (status.kind === 'error' && status.reasons.length === 0) {
    return (
      <span className="text-xs text-destructive">{t('errors.mappingIncomplete')}</span>
    );
  }
  // Dedup reasons that would render to the same badge.
  const seen = new Set<string>();
  const unique = status.reasons.filter((r) => {
    let key: string;
    if (r.code === 'DUPLICATE_IN_FILE') key = `dup:${r.firstSeenRowIndex}`;
    else if (r.code === 'TOO_LONG') key = `too:${r.language}`;
    else if (r.code === 'EMPTY_CELL') key = `empty:${r.language}`;
    else key = 'other';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="flex flex-wrap gap-1">
      {unique.map((r, i) => {
        if (r.code === 'TOO_LONG') {
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-sm bg-destructive/10 text-destructive px-1.5 py-0.5 text-xs"
            >
              {t('errors.tooLong', {
                language: getLocalizedLanguageNameByCode(r.language, locale),
                length: r.length,
                max: MAX_CARD_TEXT_LENGTH,
              })}
            </span>
          );
        }
        if (r.code === 'EMPTY_CELL') {
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-sm bg-destructive/10 text-destructive px-1.5 py-0.5 text-xs"
            >
              {t('errors.emptyCell', {
                language: getLocalizedLanguageNameByCode(r.language, locale),
              })}
            </span>
          );
        }
        if (r.code === 'DUPLICATE_IN_FILE') {
          const displayRow = r.firstSeenRowIndex + 1;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-xs"
            >
              {t('errors.duplicate', { row: displayRow })}
            </span>
          );
        }
        return null;
      })}
    </div>
  );
}
