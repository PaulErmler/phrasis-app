'use client';

/**
 * Prototype D: Combined Timeline + Language Cards
 *
 * Merges Prototype A (visual timeline) and B (per-language cards).
 * Each language block is an interactive card embedded directly in the timeline.
 * - Play count is controlled via +/- stepper buttons
 * - Repetition pause slider only appears when plays > 1
 * - Pauses between language groups use +/- stepper inputs with a vertical divider
 * - Languages with 0 plays are dimmed but still connected in the timeline
 * - Up/down arrows allow reordering within base and target groups
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { getLanguageByCode } from '@/lib/languages';
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_REPETITIONS_BASE,
  DEFAULT_REPETITIONS_TARGET,
  DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
} from '@/lib/constants/audioPlayback';

interface LanguageSettings {
  plays: number;
  repPause: number;
}

interface PrototypeDProps {
  baseLanguages: string[];
  targetLanguages: string[];
}

export function PrototypeD({
  baseLanguages: baseProp,
  targetLanguages: targetProp,
}: PrototypeDProps) {
  const [autoPlay, setAutoPlay] = useState(DEFAULT_AUTO_PLAY);
  const [autoAdvance, setAutoAdvance] = useState(DEFAULT_AUTO_ADVANCE);
  const [pauseBaseToBase, setPauseBaseToBase] = useState(
    DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  );
  const [pauseBaseToTarget, setPauseBaseToTarget] = useState(
    DEFAULT_PAUSE_BASE_TO_TARGET,
  );
  const [pauseTargetToTarget, setPauseTargetToTarget] = useState(
    DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  );

  // Internal ordered copies — synced when props change
  const [baseLanguages, setBaseLanguages] = useState<string[]>(baseProp);
  const [targetLanguages, setTargetLanguages] = useState<string[]>(targetProp);

  const [langSettings, setLangSettings] = useState<
    Record<string, LanguageSettings>
  >({});
  const getDefaultsFor = (code: string): LanguageSettings => ({
    plays: baseLanguages.includes(code)
      ? DEFAULT_REPETITIONS_BASE
      : DEFAULT_REPETITIONS_TARGET,
    repPause: DEFAULT_PAUSE_BETWEEN_REPETITIONS,
  });

  const updateLang = (
    code: string,
    key: keyof LanguageSettings,
    value: number,
  ) => {
    setLangSettings((prev) => ({
      ...prev,
      [code]: { ...(prev[code] ?? getDefaultsFor(code)), [key]: value },
    }));
  };

  // Reorder helpers
  const swap = (arr: string[], i: number, j: number) => {
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  const moveBaseUp = (idx: number) =>
    setBaseLanguages((prev) => swap(prev, idx, idx - 1));
  const moveBaseDown = (idx: number) =>
    setBaseLanguages((prev) => swap(prev, idx, idx + 1));
  const moveTargetUp = (idx: number) =>
    setTargetLanguages((prev) => swap(prev, idx, idx - 1));
  const moveTargetDown = (idx: number) =>
    setTargetLanguages((prev) => swap(prev, idx, idx + 1));

  return (
    <div className="space-y-5">
      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Auto-play audio</Label>
            <p className="text-muted-xs">Play audio when a card is shown</p>
          </div>
          <Switch checked={autoPlay} onCheckedChange={setAutoPlay} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Auto-advance</Label>
            <p className="text-muted-xs">Go to next card after audio</p>
          </div>
          <Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} />
        </div>
      </div>

      <Separator />

      {/* Playback Sequence — combined timeline + settings */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Playback Sequence
        </p>
        <p className="text-muted-xs">
          Configure each language and see the playback order at a glance.
        </p>

        <div className="flex flex-col items-center gap-0 py-2">
          {/* Base languages */}
          {baseLanguages.map((code, idx) => {
            const settings = langSettings[code] ?? getDefaultsFor(code);
            const plays = settings?.plays ?? DEFAULT_REPETITIONS_BASE;
            const nextCode = baseLanguages[idx + 1];
            const nextPlays = nextCode
              ? (langSettings[nextCode]?.plays ?? DEFAULT_REPETITIONS_BASE)
              : 0;

            return (
              <div
                key={`base-${code}`}
                className="w-full flex flex-col items-center"
              >
                <TimelineLanguageCard
                  code={code}
                  type="base"
                  plays={plays}
                  repPause={
                    settings?.repPause ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS
                  }
                  onPlaysChange={(v) => updateLang(code, 'plays', v)}
                  onRepPauseChange={(v) => updateLang(code, 'repPause', v)}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < baseLanguages.length - 1}
                  onMoveUp={() => moveBaseUp(idx)}
                  onMoveDown={() => moveBaseDown(idx)}
                />

                {/* Base to base pause connector */}
                {idx < baseLanguages.length - 1 && (
                  <StepperPauseConnector
                    label="Base → Base Pause"
                    seconds={pauseBaseToBase}
                    onChange={setPauseBaseToBase}
                    lineOnly={plays === 0 || nextPlays === 0}
                  />
                )}
              </div>
            );
          })}

          {/* Base to target pause connector */}
          {baseLanguages.length > 0 &&
            targetLanguages.length > 0 &&
            (() => {
              const lastBasePlays =
                langSettings[baseLanguages[baseLanguages.length - 1]]?.plays ??
                DEFAULT_REPETITIONS_BASE;
              const firstTargetPlays =
                langSettings[targetLanguages[0]]?.plays ??
                DEFAULT_REPETITIONS_TARGET;
              return (
                <StepperPauseConnector
                  label="Base → Target Pause"
                  seconds={pauseBaseToTarget}
                  onChange={setPauseBaseToTarget}
                  accent
                  lineOnly={lastBasePlays === 0 || firstTargetPlays === 0}
                />
              );
            })()}

          {/* Target languages */}
          {targetLanguages.map((code, idx) => {
            const settings = langSettings[code] ?? getDefaultsFor(code);
            const plays = settings?.plays ?? DEFAULT_REPETITIONS_TARGET;
            const nextCode = targetLanguages[idx + 1];
            const nextPlays = nextCode
              ? (langSettings[nextCode]?.plays ?? DEFAULT_REPETITIONS_TARGET)
              : 0;

            return (
              <div
                key={`target-${code}`}
                className="w-full flex flex-col items-center"
              >
                <TimelineLanguageCard
                  code={code}
                  type="target"
                  plays={plays}
                  repPause={
                    settings?.repPause ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS
                  }
                  onPlaysChange={(v) => updateLang(code, 'plays', v)}
                  onRepPauseChange={(v) => updateLang(code, 'repPause', v)}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < targetLanguages.length - 1}
                  onMoveUp={() => moveTargetUp(idx)}
                  onMoveDown={() => moveTargetDown(idx)}
                />

                {/* Target to target pause connector */}
                {idx < targetLanguages.length - 1 && (
                  <StepperPauseConnector
                    label="Target → Target Pause"
                    seconds={pauseTargetToTarget}
                    onChange={setPauseTargetToTarget}
                    lineOnly={plays === 0 || nextPlays === 0}
                  />
                )}
              </div>
            );
          })}

          {/* Auto-advance indicator */}
          {autoAdvance && (
            <div className="mt-2 flex items-center gap-2 text-muted-xs">
              <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-primary" />
              <span>Auto-advance to next card</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline language card — an interactive card embedded in the timeline
// ---------------------------------------------------------------------------

function TimelineLanguageCard({
  code,
  type,
  plays,
  repPause,
  onPlaysChange,
  onRepPauseChange,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  code: string;
  type: 'base' | 'target';
  plays: number;
  repPause: number;
  onPlaysChange: (v: number) => void;
  onRepPauseChange: (v: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const lang = getLanguageByCode(code);
  const isDisabled = plays === 0;

  return (
    <div className="w-full max-w-[300px]">
      <div
        className={`rounded-lg border-2 px-3 py-2.5 space-y-2.5 transition-opacity ${
          type === 'base'
            ? 'border-timeline-base-border bg-timeline-base'
            : 'border-timeline-target-border bg-timeline-target'
        } ${isDisabled ? 'opacity-50' : ''}`}
      >
        {/* Language header + reorder arrows + plays stepper */}
        <div className="flex items-center gap-2">
          {/* Reorder arrows */}
          <div className="flex flex-col -my-1">
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:pointer-events-none"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:pointer-events-none"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <span className="text-base">{lang?.flag}</span>
          <span className="text-sm font-medium">{lang?.name ?? code}</span>

          {/* Plays +/- stepper */}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={() => onPlaysChange(Math.max(0, plays - 1))}
              disabled={plays <= 0}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="tabular-nums text-sm font-medium w-5 text-center">
              {plays}x
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={() => onPlaysChange(Math.min(10, plays + 1))}
              disabled={plays >= 10}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Repetition pause slider — only when plays > 1 */}
        {plays > 1 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Pause between plays
              </span>
              <span className="text-xs font-medium tabular-nums">
                {repPause}s
              </span>
            </div>
            <Slider
              min={0}
              max={30}
              step={1}
              value={[repPause]}
              onValueChange={([v]) => onRepPauseChange(v)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper pause connector — label | divider | +/- controls
// ---------------------------------------------------------------------------

function StepperPauseConnector({
  label,
  seconds,
  onChange,
  accent,
  lineOnly,
}: {
  label: string;
  seconds: number;
  onChange: (v: number) => void;
  accent?: boolean;
  /** When true, render only a connecting line without the pause bubble. */
  lineOnly?: boolean;
}) {
  const decrement = () => onChange(Math.max(0, seconds - 1));
  const increment = () => onChange(Math.min(30, seconds + 1));

  if (lineOnly) {
    return (
      <div className="flex flex-col items-center py-0.5">
        <div className="w-px h-5 bg-border" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-0.5">
      {/* Vertical connector line */}
      <div className={`w-px h-3 ${accent ? 'bg-primary' : 'bg-border'}`} />

      {/* Stepper control with vertical divider */}
      <div
        className={`flex items-center rounded-full px-2 py-0.5 text-xs ${
          accent
            ? 'bg-primary/10 text-primary border border-primary/30'
            : 'bg-muted text-muted-foreground border border-border'
        }`}
      >
        <span className="whitespace-nowrap pr-2">{label}</span>

        {/* Vertical divider */}
        <div
          className={`w-px h-4 mx-1 ${accent ? 'bg-primary/30' : 'bg-border'}`}
        />

        <div className="flex items-center gap-1 pl-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            onClick={decrement}
            disabled={seconds <= 0}
          >
            <Minus className="h-3 w-3" />
          </Button>

          <span className="tabular-nums text-xs font-medium w-6 text-center">
            {seconds}s
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            onClick={increment}
            disabled={seconds >= 30}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Vertical connector line */}
      <div className={`w-px h-3 ${accent ? 'bg-primary' : 'bg-border'}`} />
    </div>
  );
}
