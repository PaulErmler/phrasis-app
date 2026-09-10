'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  allPolitenessLevels,
  coursePolitenessRows,
  formCopyCode,
  type PolitenessLevel,
} from '@/lib/languageForms';
import { PolitenessRows } from '@/components/course/PolitenessRows';

/**
 * Wizard step "Which politeness levels do you want to learn?": the course's
 * `politenessLevels` setting (lib/languageForms.ts), a SET of the three
 * global levels. Asked only for Japanese and Korean targets
 * (`onboardingAsksPoliteness`). The rows are the union of the course
 * languages' distinct forms (`coursePolitenessRows`). Row titles are the
 * translated level words. Ticking several rows means the sentences
 * alternate evenly. Hidden levels inherit the visible level below them
 * (`levelsFromTickedRows`), so the stored set stays right when a language
 * with more forms is added later.
 *
 * Every level is the recommended answer: the rows' "All levels" card
 * (`recommendAll`) is preselected on entry, so a learner who just continues
 * gets the mix. The rows below are for narrowing it.
 */

interface Props {
  targetLanguages: string[];
  baseLanguages: string[];
  /** The stored global levels; the rows derive their ticked state from it. */
  selected: PolitenessLevel[];
  onChange: (levels: PolitenessLevel[]) => void;
}

export function PolitenessStep({
  targetLanguages,
  baseLanguages,
  selected,
  onChange,
}: Props) {
  const t = useTranslations('Onboarding.politeness');
  const tForms = useTranslations('LanguageForms');
  const rows = coursePolitenessRows([...targetLanguages, ...baseLanguages]);
  const introCode = rows[0]?.perLanguage[0]?.code;
  const intro = introCode
    ? tForms(`politeness.${formCopyCode(introCode)}.intro`)
    : '';
  const allLevels = allPolitenessLevels(rows);
  // Preselect the recommended answer once, on entry with nothing ticked. A
  // learner who unticks every row afterwards keeps the empty set (Continue
  // stays disabled), so the effect must not re-fire on later renders.
  const preselectedRef = useRef(false);
  useEffect(() => {
    if (preselectedRef.current) return;
    preselectedRef.current = true;
    if (selected.length === 0 && allLevels.length > 0) onChange(allLevels);
  }, [selected, allLevels, onChange]);

  return (
    <div
      data-testid="onboarding-step-politeness"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{intro}</p>
        </div>
        <PolitenessRows
          rows={rows}
          selected={selected}
          onChange={onChange}
          showExamples
          recommendAll
        />
      </div>
    </div>
  );
}
