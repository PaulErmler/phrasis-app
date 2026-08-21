'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Upload,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  getLocalizedLanguageNameByCode,
  getTextDirection,
} from '@/lib/languages';
import { MAX_CARD_TEXT_LENGTH } from '@/lib/constants/learning';
import { useImeSafeEnter } from '@/hooks/use-ime-safe-enter';
import {
  FileDropzone,
  DelimiterSelect,
  ColumnMappingSelect,
  HeaderToggle,
  SummaryBar,
  RowErrorBadges,
} from './ImportPrimitives';
import type { ImportController } from './useImportController';
import type { RowStatus } from './types';

type Step = 0 | 1 | 2;

const SEVERITY_ORDER: Record<RowStatus['kind'], number> = {
  error: 0,
  warning: 1,
  valid: 2,
};

interface ReviewRowProps {
  status: RowStatus;
  dataRowIndex: number;
  row: string[];
  courseLanguages: string[];
  mapping: Record<string, number>;
  onEdit: (dataRowIndex: number, language: string, newText: string) => void;
  onDelete: (dataRowIndex: number) => void;
}

function ReviewRow({
  status,
  dataRowIndex,
  row,
  courseLanguages,
  mapping,
  onEdit,
  onDelete,
}: ReviewRowProps) {
  const t = useTranslations('ImportTexts');
  const locale = useLocale();
  const [editingLang, setEditingLang] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { compositionProps, isComposingEvent } = useImeSafeEnter();

  useEffect(() => {
    if (editingLang) {
      const el = inputRef.current;
      el?.focus();
      // Place caret at the end instead of selecting all.
      const len = el?.value.length ?? 0;
      el?.setSelectionRange(len, len);
    }
  }, [editingLang]);

  const rowColor =
    status.kind === 'error'
      ? 'bg-destructive/10 border-l-2 border-l-destructive'
      : status.kind === 'warning'
        ? 'bg-amber-500/15 border-l-2 border-l-amber-500'
        : 'border-l-2 border-l-transparent';

  const startEdit = (lang: string, current: string) => {
    setEditingLang(lang);
    setDraft(current);
  };
  const commitEdit = () => {
    if (editingLang) onEdit(dataRowIndex, editingLang, draft);
    setEditingLang(null);
  };
  const cancelEdit = () => {
    setEditingLang(null);
  };

  return (
    <div
      className={cn('flex gap-3 px-3 py-2 text-sm', rowColor)}
      data-testid={`import-review-row-${dataRowIndex}`}
    >
      <span className="w-6 shrink-0 text-xs text-muted-foreground font-mono pt-1">
        {dataRowIndex + 1}
      </span>
      <div className="flex-1 min-w-0 space-y-1.5">
        {courseLanguages.map((lang) => {
          const col = mapping[lang];
          if (col === undefined) return null;
          const cell = row?.[col] ?? '';
          const isEditing = editingLang === lang;
          return (
            <div key={lang}>
              <div className="flex items-center justify-between gap-2">
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
                  {getLocalizedLanguageNameByCode(lang, locale)}
                </span>
                {!isEditing && (
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
                    aria-label={t('review.editAria', {
                      language: getLocalizedLanguageNameByCode(lang, locale),
                    })}
                    onClick={() => startEdit(lang, cell)}
                    data-testid={`import-review-edit-${dataRowIndex}-${lang}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {isEditing ? (
                <div className="flex items-start gap-1.5">
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter saves; Shift+Enter inserts a newline; Esc cancels.
                      // isComposingEvent guards both: this text is in the target
                      // language, where Enter confirms an IME conversion and
                      // Escape cancels it, neither may hit the cell edit. See
                      // `useImeSafeEnter`.
                      if (
                        e.key === 'Enter' &&
                        !e.shiftKey &&
                        !isComposingEvent(e)
                      ) {
                        e.preventDefault();
                        commitEdit();
                      } else if (
                        e.key === 'Escape' &&
                        !isComposingEvent(e)
                      ) {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    {...compositionProps}
                    rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 50)))}
                    dir={getTextDirection(lang)}
                    className={cn(
                      'flex-1 min-w-0 rounded-md border bg-background px-2 py-1 text-sm text-left resize-y focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                      draft.length > MAX_CARD_TEXT_LENGTH
                        ? 'border-destructive'
                        : '',
                    )}
                    data-testid={`import-review-edit-input-${dataRowIndex}-${lang}`}
                  />
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <span
                      className={cn(
                        'text-[10px] tabular-nums shrink-0',
                        draft.length > MAX_CARD_TEXT_LENGTH
                          ? 'text-destructive font-medium'
                          : 'text-muted-foreground',
                      )}
                    >
                      {draft.length}/{MAX_CARD_TEXT_LENGTH}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-emerald-700 hover:bg-emerald-500/10 transition-colors"
                      aria-label={t('review.saveAria')}
                      onClick={commitEdit}
                      data-testid={`import-review-save-${dataRowIndex}-${lang}`}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
                      aria-label={t('review.cancelAria')}
                      onClick={cancelEdit}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <span
                  dir={getTextDirection(lang)}
                  className="block break-words text-left"
                >
                  {cell || '—'}
                </span>
              )}
            </div>
          );
        })}
        <RowErrorBadges status={status} />
      </div>
      <button
        type="button"
        className="shrink-0 self-start rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        aria-label={t('review.deleteAria')}
        onClick={() => onDelete(dataRowIndex)}
        data-testid={`import-review-delete-${dataRowIndex}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function StepperImportView({ c }: { c: ImportController }) {
  const t = useTranslations('ImportTexts');
  const [step, setStep] = useState<Step>(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * Stable severity-sorted order of **absolute** parsed-row indices. Snapshotted
   * when the base dataset changes (input / mapping / hasHeader), so edits on the
   * Review step don't shuffle rows around as issues get resolved. Deleted rows
   * are filtered out at render time.
   */
  const mappingKey = JSON.stringify(c.mapping);
  const [reviewOrder, setReviewOrder] = useState<number[]>([]);
  useEffect(() => {
    const order = c.validation.statuses
      .map((s, i) => ({ s, abs: c.dataRowAbsolute[i] }))
      .sort(
        (a, b) =>
          SEVERITY_ORDER[a.s.kind] - SEVERITY_ORDER[b.s.kind] || a.abs - b.abs,
      )
      .map((x) => x.abs)
      .filter((abs) => abs !== undefined);
    setReviewOrder(order);
    // Deliberately exclude validation.statuses so edits don't re-sort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.input, mappingKey, c.hasHeader]);

  const sortedReviewIndices = useMemo(() => {
    const absToDataIdx = new Map<number, number>();
    c.dataRowAbsolute.forEach((abs, idx) => absToDataIdx.set(abs, idx));
    const mapped = reviewOrder
      .map((abs) => absToDataIdx.get(abs))
      .filter((i): i is number => i !== undefined);
    // Append any dataRows not in the snapshot (edge case: they shouldn't
    // appear mid-session, but stay defensive).
    const seen = new Set(mapped);
    for (let i = 0; i < c.dataRowAbsolute.length; i++) {
      if (!seen.has(i)) mapped.push(i);
    }
    return mapped;
  }, [reviewOrder, c.dataRowAbsolute]);

  const steps = useMemo(
    () => [t('step.input'), t('step.map'), t('step.review')],
    [t],
  );

  const hasInput = c.rows.length > 0;
  const mappingComplete = c.validation.mappingComplete;

  const canReachStep = (s: Step): boolean => {
    if (s <= step) return true; // always allowed to go back
    if (s === 1) return hasInput;
    if (s === 2) return hasInput && mappingComplete;
    return false;
  };

  const goToStep = (s: Step) => {
    if (canReachStep(s)) setStep(s);
  };

  const canNext = [
    hasInput,
    mappingComplete,
    false, // no "next" on the last step — it's Import
  ];

  const headerRow = c.hasHeader ? c.rows[0] : undefined;
  const sampleRow = c.hasHeader ? c.rows[1] : c.rows[0];

  const primaryLabel =
    step === 2
      ? c.validation.importableCount > 0
        ? t('importButton', { count: c.validation.importableCount })
        : t('importButtonEmpty')
      : t('step.next');

  const handlePrimary = () => {
    if (step < 2) {
      goToStep((step + 1) as Step);
    } else if (c.validation.canImport) {
      setConfirmOpen(true);
    }
  };

  const handleConfirm = async () => {
    setConfirmOpen(false);
    await c.submit();
  };

  return (
    <div className="space-y-4">
      {/* Step indicator. Clickable */}
      <div
        className="flex w-full rounded-lg border bg-muted/50 p-1 gap-0.5"
        role="tablist"
      >
        {steps.map((label, i) => {
          const reachable = canReachStep(i as Step);
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === step}
              disabled={!reachable}
              onClick={() => goToStep(i as Step)}
              data-testid={`import-step-${i}`}
              className={cn(
                'flex-1 min-w-0 text-center text-xs sm:text-sm font-medium py-1.5 px-1 rounded-md transition-colors truncate',
                i === step
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : reachable
                    ? 'text-foreground hover:bg-background cursor-pointer'
                    : 'text-muted-foreground/60 cursor-not-allowed',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <FileDropzone
            fileName={c.fileName}
            onFile={c.onFileSelected}
            onClear={() => {
              c.setFileName(null);
              c.setInput('');
            }}
            courseLanguages={c.courseLanguages}
          />
          <div className="flex gap-3 flex-wrap items-end">
            <DelimiterSelect
              value={c.delimiter}
              onChange={c.setDelimiter}
              detected={c.detectedDelimiter}
            />
            <div className="h-9 flex items-center">
              <HeaderToggle value={c.hasHeader} onChange={c.setHasHeader} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">{t('dropzone.orPaste')}</label>
            <textarea
              value={c.input}
              onChange={(e) => c.setInput(e.target.value)}
              // Mixed-language raw paste, no single language code exists, so
              // first-strong-character detection is the best available dir.
              dir="auto"
              placeholder={t('pastePlaceholder')}
              rows={8}
              data-testid="import-paste"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
            />
          </div>
          {c.rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('preview.rowsCounted', { count: c.rows.length })}
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap min-h-9">
            <h3 className="text-sm font-semibold">{t('mapping.title')}</h3>
            <HeaderToggle value={c.hasHeader} onChange={c.setHasHeader} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.courseLanguages.map((lang) => (
              <ColumnMappingSelect
                key={lang}
                language={lang}
                columnCount={c.columnCount}
                selectedColumn={c.mapping[lang]}
                sampleRow={sampleRow}
                headerRow={headerRow}
                hasHeader={c.hasHeader}
                onChange={(idx) => c.setMappingForLanguage(lang, idx)}
              />
            ))}
          </div>
          {/* Horizontally scrollable preview table on mobile */}
          <div className="rounded-md border overflow-x-auto">
            <div
              className="grid text-xs min-w-max"
              style={{ gridTemplateColumns: `repeat(${c.columnCount}, minmax(140px, 1fr))` }}
            >
              {(c.hasHeader ? c.rows.slice(1, 6) : c.rows.slice(0, 5)).map((row, rIdx) => (
                <div key={rIdx} className="contents">
                  {Array.from({ length: c.columnCount }).map((_, cIdx) => {
                    const mapped = Object.entries(c.mapping).find(([, v]) => v === cIdx);
                    return (
                      <div
                        key={cIdx}
                        className={cn(
                          'px-2 py-1 border-b border-r last:border-r-0 truncate',
                          mapped ? 'bg-primary/5' : 'bg-background',
                        )}
                      >
                        {row[cIdx] ?? ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <SummaryBar
            importableCount={c.validation.importableCount}
            warningCount={c.validation.warningCount}
            errorCount={c.validation.errorCount}
            quotaBalance={c.quotaBalance}
            quotaUnlimited={c.quotaUnlimited}
            quotaLoading={c.quotaLoading}
            isSubmitting={c.isSubmitting}
            canImport={c.validation.canImport}
            onImport={() => setConfirmOpen(true)}
          />
          {!c.validation.quotaSufficient && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {t('quota.insufficient', {
                balance: c.quotaBalance,
                count: c.validation.importableCount,
              })}
            </p>
          )}
          <div className="rounded-md border divide-y max-h-[50vh] overflow-y-auto">
            {sortedReviewIndices.map((i) => (
              <ReviewRow
                key={i}
                status={c.validation.statuses[i]}
                dataRowIndex={i}
                row={c.dataRows[i]}
                courseLanguages={c.courseLanguages}
                mapping={c.mapping}
                onEdit={c.updateCell}
                onDelete={c.deleteRow}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        {step > 0 && (
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
            disabled={c.isSubmitting}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t('step.back')}
          </Button>
        )}
        <Button
          className={cn('flex-1', step === 0 ? 'w-full' : '')}
          onClick={handlePrimary}
          disabled={
            step < 2
              ? !canNext[step]
              : !c.validation.canImport || c.isSubmitting
          }
          data-testid={step === 2 ? 'import-submit' : 'import-next'}
        >
          {step === 2 ? <Upload className="h-4 w-4 mr-1" /> : null}
          {primaryLabel}
          {step < 2 && <ChevronRight className="h-4 w-4 ml-1" />}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-start gap-2">
              {c.validation.warningCount > 0 && (
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              )}
              {t('confirmDialog.title', { count: c.validation.importableCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {c.validation.warningCount > 0
                ? t('confirmDialog.descriptionWithWarnings', {
                  count: c.validation.importableCount,
                  warnings: c.validation.warningCount,
                })
                : t('confirmDialog.description', {
                  count: c.validation.importableCount,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={c.isSubmitting}>
              {t('confirmDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={c.isSubmitting}
              data-testid="import-confirm"
            >
              {c.isSubmitting
                ? t('importing')
                : t('confirmDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
