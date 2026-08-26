'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Loader2 } from 'lucide-react';
import { OGTE_MIN_LEVEL, OGTE_MAX_LEVEL } from '@/lib/constants/onboarding';

/**
 * Shared OGTE level picker: continuous slider over levels 1..20 with a live
 * preview of sentences at the slid level (the placement corpus, in the
 * user's target language. The same material the learner will actually
 * see). Used by the onboarding CEFR self-pick step and the one-time
 * difficulty-check dialog in the learn view.
 *
 * The preview corpus is fetched once for ALL levels, so dragging the slider
 * re-renders instantly from memory. Copy comes from the shared
 * `Onboarding.cefrPick` namespace (level labels, sample headings).
 */

export function clampOgte(n: number): number {
  if (n < OGTE_MIN_LEVEL) return OGTE_MIN_LEVEL;
  if (n > OGTE_MAX_LEVEL) return OGTE_MAX_LEVEL;
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

export function LevelSliderCard({
  ogte,
  onChange,
}: {
  ogte: number;
  onChange: (ogte: number) => void;
}) {
  const t = useTranslations('Onboarding.cefrPick');
  const cefr = cefrForOgte(ogte);
  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('levelLabel')}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-3xl md:text-4xl font-bold tabular-nums leading-none">
                {ogte.toString().padStart(2, '0')}
              </div>
              <Badge
                variant="outline"
                className="h-auto px-3 py-0 text-3xl md:text-4xl font-bold leading-none"
              >
                {cefr}
              </Badge>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground hidden md:block">
            <div>{t('levelsTotal')}</div>
            <div>{t('levelsRange')}</div>
          </div>
        </div>
        <Slider
          value={[ogte]}
          min={OGTE_MIN_LEVEL}
          max={OGTE_MAX_LEVEL}
          step={1}
          onValueChange={(v) => onChange(clampOgte(v[0]))}
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
  );
}

type PreviewSentence = FunctionReturnType<
  typeof api.features.placementTest.getPlacementPreviewSentences
>[number];

/** Structural row shape shared by the placement-corpus preview and the
 *  upcoming-sentences preview. SampleRow renders either. */
export interface PreviewRowShape {
  sourceText: string;
  targetText?: string;
  targetRomanization?: string;
}

const PREVIEW_POSITIONS = [0, 1, 2, 3, 4];

export function LevelSamplePreview({
  ogteLevel,
  sourceLanguage,
  targetLanguage,
}: {
  ogteLevel: number;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const t = useTranslations('Onboarding.cefrPick');
  // One subscription for the WHOLE corpus (no per-(level, position) queries):
  // sliding between levels renders instantly from memory instead of flashing
  // five loading rows per tick while fresh queries resolve. Translations
  // landing mid-flow still stream in reactively.
  const corpus = useQuery(
    api.features.placementTest.getPlacementPreviewSentences,
    { targetLanguage, sourceLanguage },
  );
  const byLevel = useMemo(() => {
    if (!corpus) return null;
    const map = new Map<number, PreviewSentence[]>();
    for (const row of corpus) {
      const rows = map.get(row.level);
      if (rows) rows.push(row);
      else map.set(row.level, [row]);
    }
    return map;
  }, [corpus]);

  const levelRows = byLevel?.get(ogteLevel);
  return (
    <Card>
      <CardContent className="p-4 md:p-6 space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('samplesHeading', {
            level: ogteLevel.toString().padStart(2, '0'),
          })}
        </div>
        {byLevel === null
          ? PREVIEW_POSITIONS.map((p) => <SampleLoadingRow key={p} />)
          : PREVIEW_POSITIONS.map((p) => (
              <SampleRow
                key={p}
                sentence={levelRows?.find((row) => row.position === p) ?? null}
                sourceLanguage={sourceLanguage}
                targetLanguage={targetLanguage}
              />
            ))}
      </CardContent>
    </Card>
  );
}

/**
 * The five preview slots, rendering either real rows or loading
 * placeholders. Exported so the difficulty-check pager can lay the same
 * sentence rows out inside its own card chrome (chevrons + dots) instead of
 * wrapping them in the `Card` the onboarding step uses.
 */
export function PreviewSentenceRows({
  rows,
  sourceLanguage,
  targetLanguage,
}: {
  /** `undefined` while the query is in flight. */
  rows: PreviewRowShape[] | undefined;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  if (rows === undefined) {
    return (
      <>
        {PREVIEW_POSITIONS.map((p) => (
          <SampleLoadingRow key={p} />
        ))}
      </>
    );
  }
  // Fewer rows than slots is normal near the end of a collection. Render
  // only what exists rather than padding with empty placeholders.
  return (
    <>
      {rows.slice(0, PREVIEW_POSITIONS.length).map((row, i) => (
        <SampleRow
          key={i}
          sentence={row}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
        />
      ))}
    </>
  );
}

/** Shown only while the one-time corpus fetch is in flight on mount. */
function SampleLoadingRow() {
  const t = useTranslations('Onboarding.cefrPick');
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowSpinner(true), 120);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="rounded bg-muted/40 px-3 py-2 text-sm text-muted-foreground italic flex items-center gap-2">
      {showSpinner ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {t('sampleLoading')}
    </div>
  );
}

function SampleRow({
  sentence,
  sourceLanguage,
  targetLanguage,
}: {
  sentence: PreviewRowShape | null;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const t = useTranslations('Onboarding.cefrPick');
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
