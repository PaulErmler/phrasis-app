'use client';

import { useTranslations } from 'next-intl';
import {
  POLITENESS_CONFIG,
  coursePolitenessRows,
  type PolitenessLevel,
  type PolitenessRow,
} from '@/lib/languageForms';
import { PolitenessRows } from '@/components/course/PolitenessRows';

export { PolitenessRows };

/**
 * Wizard step "Which politeness levels do you want to learn?": the course's
 * `politenessLevels` setting (lib/languageForms.ts), a SET of the three
 * global levels. The rows are the union of the course languages' distinct
 * forms (`coursePolitenessRows`): a German-only course shows two rows named
 * by its forms, Japanese shows three, Japanese + German three with a
 * per-language sublabel. Ticking several rows means the sentences
 * alternate evenly. Hidden levels inherit the visible level below them
 * (`levelsFromTickedRows`), so the stored set stays right when a language
 * with more forms is added later.
 */

interface Props {
  targetLanguages: string[];
  baseLanguages: string[];
  /** The stored global levels; the rows derive their ticked state from it. */
  selected: PolitenessLevel[];
  onChange: (levels: PolitenessLevel[]) => void;
}

/** The rows for a course, shared with the create-course dialog and settings. */
export function politenessRowsFor(
  targetLanguages: string[],
  baseLanguages: string[],
): PolitenessRow[] {
  return coursePolitenessRows([...targetLanguages, ...baseLanguages]);
}

export function PolitenessStep({
  targetLanguages,
  baseLanguages,
  selected,
  onChange,
}: Props) {
  const t = useTranslations('Onboarding.politeness');
  const rows = politenessRowsFor(targetLanguages, baseLanguages);
  const intro = rows[0]?.perLanguage[0]
    ? politenessIntro(rows[0].perLanguage[0].code)
    : '';
  return (
    <div
      data-testid="onboarding-step-politeness"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {intro} {t('subtitle')}
          </p>
        </div>
        <PolitenessRows
          rows={rows}
          selected={selected}
          onChange={onChange}
          showExamples
        />
      </div>
    </div>
  );
}

/** The intro line of the first marked language (config copy, English). */
function politenessIntro(code: string): string {
  return POLITENESS_CONFIG[code]?.intro ?? '';
}
