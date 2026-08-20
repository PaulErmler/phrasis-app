'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  LevelSliderCard,
  LevelSamplePreview,
  clampOgte,
  cefrForOgte,
} from '@/components/course/LevelPicker';
import type { StrategyName } from '../lib/placementStrategies';

interface Props {
  /** Source language code (e.g. 'en'). */
  sourceLanguage: string;
  /** Target language the user is learning. */
  targetLanguage: string;
  /** Initial OGTE level (1..20). Defaults to 8. */
  initialOgteLevel?: number;
  /** Fires on every slider change so the wizard can react to the slid level
   *  in real time (e.g. enable the Continue button, mirror into URL, etc.). */
  onLevelChange: (ogteLevel: number) => void;
}

/**
 * CEFR self-pick. Slider variant (live step). Thin onboarding wrapper
 * around the shared `LevelPicker` slider + sample preview (also used by the
 * learn view's one-time difficulty-check dialog).
 *
 * This step no longer owns a Continue button. The wizard footer's "Pick
 * this level" button handles confirmation.
 */
export function CefrSelfPickStep({
  sourceLanguage,
  targetLanguage,
  initialOgteLevel = 8,
  onLevelChange,
}: Props) {
  const t = useTranslations('Onboarding.cefrPick');
  const [ogte, setOgte] = useState(clampOgte(initialOgteLevel));

  // Push the initial level up exactly once on mount so the wizard can light
  // up the Continue button without waiting for the user to wiggle the slider.
  useEffect(() => {
    onLevelChange(ogte);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (next: number) => {
    setOgte(next);
    onLevelChange(next);
  };

  return (
    <div
      data-testid="onboarding-step-cefr-pick"
      className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="shrink-0 text-center py-3 md:py-4">
        <h2 className="text-xl md:text-2xl font-bold">{t('title')}</h2>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-6">
        <div className="space-y-4 max-w-2xl mx-auto w-full">
          <LevelSliderCard ogte={ogte} onChange={handleChange} />
          <LevelSamplePreview
            ogteLevel={ogte}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
          />
        </div>
      </div>
    </div>
  );
}

export { cefrForOgte };
export type { StrategyName };
