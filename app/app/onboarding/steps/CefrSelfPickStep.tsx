'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Loader2 } from 'lucide-react';
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
 * CEFR self-pick — slider variant (live step).
 *
 * Continuous slider over OGTE levels 1..20. The current level's 5 placement-
 * test sentences are queried in the user's *target* language so the preview
 * matches what they'll see during learning.
 *
 * This step no longer owns a Continue button — the wizard footer's "Pick
 * this level" button handles confirmation (and opens a follow-up dialog
 * offering to refine via the placement test).
 */
export function CefrSelfPickStep({
  sourceLanguage,
  targetLanguage,
  initialOgteLevel = 8,
  onLevelChange,
}: Props) {
  const t = useTranslations('Onboarding.cefrPick');
  const [ogte, setOgte] = useState(clampOgte(initialOgteLevel));
  const cefr = cefrForOgte(ogte);

  // Push the initial level up exactly once on mount so the wizard can light
  // up the Continue button without waiting for the user to wiggle the slider.
  useEffect(() => {
    onLevelChange(ogte);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (v: number[]) => {
    const next = clampOgte(v[0]);
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
          <Card>
            <CardContent className="p-4 md:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('levelLabel')}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-3xl md:text-4xl font-bold tabular-nums">
                      {ogte.toString().padStart(2, '0')}
                    </div>
                    <Badge variant="outline">{cefr}</Badge>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground hidden md:block">
                  <div>{t('levelsTotal')}</div>
                  <div>{t('levelsRange')}</div>
                </div>
              </div>
              <Slider
                value={[ogte]}
                min={1}
                max={20}
                step={1}
                onValueChange={handleChange}
                aria-label={t('ariaLabel')}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground -mt-2 px-1">
                <span>Pre-A1</span>
                <span>A2</span>
                <span>B1</span>
                <span>B2</span>
                <span>C1</span>
                <span>C2</span>
              </div>
            </CardContent>
          </Card>

          <SamplePreview
            ogteLevel={ogte}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
          />
        </div>
      </div>
    </div>
  );
}

function SamplePreview({
  ogteLevel,
  sourceLanguage,
  targetLanguage,
}: {
  ogteLevel: number;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const t = useTranslations('Onboarding.cefrPick');
  const positions = useMemo(() => [0, 1, 2, 3, 4], []);
  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('samplesHeading', { level: ogteLevel.toString().padStart(2, '0') })}
        </div>
        {positions.map((p) => (
          <SampleRow
            key={`${ogteLevel}-${p}`}
            level={ogteLevel}
            position={p}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SampleRow({
  level,
  position,
  sourceLanguage,
  targetLanguage,
}: {
  level: number;
  position: number;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const t = useTranslations('Onboarding.cefrPick');
  const sentence = useQuery(api.features.placementTest.getPlacementSentence, {
    level,
    position,
    targetLanguage,
  });

  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (sentence !== undefined) {
      setShowSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowSpinner(true), 120);
    return () => clearTimeout(timer);
  }, [sentence]);

  if (sentence === undefined) {
    return (
      <div className="rounded bg-muted/40 px-3 py-2 text-sm text-muted-foreground italic flex items-center gap-2">
        {showSpinner ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {t('sampleLoading')}
      </div>
    );
  }
  if (sentence === null) {
    return (
      <div className="rounded bg-muted/40 px-3 py-2 text-sm text-muted-foreground italic">
        {t('sampleEmpty')}
      </div>
    );
  }

  const showTarget = targetLanguage !== sourceLanguage && !!sentence.targetText;
  const primary = showTarget ? sentence.targetText! : sentence.sourceText;

  return (
    <div className="rounded bg-muted/50 px-3 py-2 text-sm space-y-0.5">
      <div>{primary}</div>
      {showTarget && sentence.targetRomanization ? (
        <div className="text-[11px] text-muted-foreground italic">
          {sentence.targetRomanization}
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampOgte(n: number): number {
  if (n < 1) return 1;
  if (n > 20) return 20;
  return Math.round(n);
}

export function cefrForOgte(ogte: number): string {
  if (ogte <= 1) return 'Pre-A1';
  if (ogte <= 4) return 'A1';
  if (ogte <= 7) return 'A2';
  if (ogte <= 10) return 'B1';
  if (ogte <= 13) return 'B2';
  if (ogte <= 16) return 'C1';
  return 'C2';
}

export type { StrategyName };
