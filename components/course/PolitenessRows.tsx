'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  POLITENESS_CONFIG,
  formCopyCode,
  levelsFromTickedRows,
  recommendedPolitenessLevels,
  type PolitenessLevel,
  type PolitenessRow,
} from '@/lib/languageForms';
import { getLanguageByCode } from '@/lib/languages';

/**
 * The learner-facing words for a politeness row: the translated level word
 * as the title, and a sub-line naming each language's form. One marked
 * language shows its description and "e.g. du"; several show a flag and the
 * form name per language. Shared by the rows and the Flag dialog so both
 * read the same.
 */
export function usePolitenessRowCopy() {
  const t = useTranslations('Onboarding.politeness');
  const tForms = useTranslations('LanguageForms');
  const title = (row: PolitenessRow) => t(`levels.${row.level}`);
  const levelWord = (level: PolitenessLevel) => t(`levelWords.${level}`);
  const subline = (row: PolitenessRow) => {
    if (row.perLanguage.length === 1) {
      const { code, form } = row.perLanguage[0];
      return `${tForms(`politeness.${formCopyCode(code)}.forms.${form.id}.description`)} · ${t('example', { form: form.name })}`;
    }
    return row.perLanguage
      .map((p) => `${getLanguageByCode(p.code)?.flag ?? p.code} ${p.form.name}`)
      .join(' · ');
  };
  return { title, subline, levelWord };
}

/** "casual and polite" in the UI locale, for the summary line. */
function joinLevelWords(words: string[], conjunction: string): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1]}`;
}

/**
 * The checkbox rows plus the summary line. Shared by the wizard step, the
 * create-course dialog and the course-languages sheet. `recommendDefault`
 * puts a "Use the default we recommend" card with a Recommended badge above
 * the rows; pressing it ticks the recommended set
 * (`recommendedPolitenessLevels`), and the rows below stay for changing it.
 */
export function PolitenessRows({
  rows,
  selected,
  onChange,
  showExamples,
  compact,
  recommendDefault,
}: {
  rows: PolitenessRow[];
  selected: PolitenessLevel[];
  onChange: (levels: PolitenessLevel[]) => void;
  showExamples?: boolean;
  compact?: boolean;
  recommendDefault?: boolean;
}) {
  const t = useTranslations('Onboarding.politeness');
  const { title, subline, levelWord } = usePolitenessRowCopy();
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
  const recommended = recommendedPolitenessLevels(rows);
  const recommendedTicked =
    recommended.length > 0 &&
    recommended.length === selected.length &&
    recommended.every((level) => selected.includes(level));
  const tickRecommended = () => onChange(recommended);
  return (
    <div className="max-w-md mx-auto w-full text-left">
      {recommendDefault ? (
        <>
          <button
            type="button"
            aria-pressed={recommendedTicked}
            data-testid="politeness-recommended"
            onClick={tickRecommended}
            className={cn(
              'w-full rounded-xl border text-left transition-all flex items-start gap-3',
              compact ? 'p-2.5 md:p-3' : 'p-3 md:p-4',
              'hover:bg-accent',
              recommendedTicked &&
                'border-primary bg-primary/5 ring-2 ring-primary/20',
            )}
          >
            <span
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center',
                recommendedTicked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-muted-foreground/40',
              )}
              aria-hidden
            >
              {recommendedTicked ? <Check className="h-3 w-3" /> : null}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t('recommended.title')}</span>
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                  {t('recommended.badge')}
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {t('recommended.description')}
              </div>
            </div>
          </button>
          <p
            className={cn(
              'mb-2 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
              compact ? 'mt-4' : 'mt-5',
            )}
          >
            {t('orPick')}
          </p>
        </>
      ) : null}
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
                <div className="font-semibold">{title(row)}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {subline(row)}
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
            ? t('summary.single', { level: levelWord(ticked[0]) })
            : t('summary.mixed', {
                levels: joinLevelWords(
                  rows
                    .filter((r) => ticked.includes(r.level))
                    .map((r) => levelWord(r.level)),
                  t('and'),
                ),
              })}
      </div>
    </div>
  );
}

function exampleEnFor(code: string): string {
  return POLITENESS_CONFIG[code]?.exampleEn ?? '';
}
