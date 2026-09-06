'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  POLITENESS_CONFIG,
  levelsFromTickedRows,
  type PolitenessLevel,
  type PolitenessRow,
} from '@/lib/languageForms';
import { getLanguageByCode } from '@/lib/languages';

/**
 * The checkbox rows plus the summary line. Shared by the wizard step, the
 * create-course dialog and the course-languages sheet.
 */
export function PolitenessRows({
  rows,
  selected,
  onChange,
  showExamples,
  compact,
}: {
  rows: PolitenessRow[];
  selected: PolitenessLevel[];
  onChange: (levels: PolitenessLevel[]) => void;
  showExamples?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('Onboarding.politeness');
  const ticked = rows
    .map((row) => row.level)
    .filter((level) => selected.includes(level));
  const toggle = (level: PolitenessLevel) => {
    const next = ticked.includes(level)
      ? ticked.filter((l) => l !== level)
      : [...ticked, level];
    onChange(levelsFromTickedRows(rows, next));
  };
  const multi = rows.some((row) => row.perLanguage.length > 1);
  return (
    <div className="max-w-md mx-auto w-full text-left">
      <div className="space-y-2" role="group">
        {rows.map((row) => {
          const isTicked = ticked.includes(row.level);
          return (
            <button
              key={row.level}
              type="button"
              role="checkbox"
              aria-checked={isTicked}
              data-testid={`politeness-${row.level}`}
              onClick={() => toggle(row.level)}
              className={cn(
                'w-full rounded-xl border text-left transition-all flex items-start gap-3',
                compact ? 'p-2.5 md:p-3' : 'p-3 md:p-4',
                'hover:bg-accent',
                isTicked &&
                  'border-primary bg-primary/5 ring-2 ring-primary/20',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center',
                  isTicked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40',
                )}
                aria-hidden
              >
                {isTicked ? <Check className="h-3 w-3" /> : null}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{row.label}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {multi
                    ? row.perLanguage
                        .map(
                          (p) =>
                            `${getLanguageByCode(p.code)?.flag ?? p.code} ${p.form.label}`,
                        )
                        .join(' · ')
                    : row.perLanguage[0]?.form.description}
                </div>
                {showExamples && !multi && row.perLanguage[0] ? (
                  <div className="text-sm mt-1.5">
                    <span className="text-muted-foreground mr-2">
                      {exampleEnFor(row.perLanguage[0].code)}
                    </span>
                    {row.perLanguage[0].form.example}
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
      <div
        className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
        data-testid="politeness-summary"
      >
        {ticked.length === 0
          ? t('summary.none')
          : ticked.length === 1
            ? t('summary.single', {
                form: rows.find((r) => r.level === ticked[0])?.label ?? '',
              })
            : t('summary.mixed', {
                forms: rows
                  .filter((r) => ticked.includes(r.level))
                  .map((r) => r.label)
                  .join(' / '),
              })}
      </div>
    </div>
  );
}

function exampleEnFor(code: string): string {
  return POLITENESS_CONFIG[code]?.exampleEn ?? '';
}
