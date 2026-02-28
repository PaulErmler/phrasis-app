'use client';

/**
 * Prototype A: Visual Timeline / Sequence
 *
 * Shows the actual playback sequence as a visual flow of audio blocks connected
 * by editable pause gaps. Users see exactly what will happen during auto-play
 * and can edit repetitions and pauses inline.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { getLanguageByCode } from '@/lib/languages';
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

interface PrototypeAProps {
  baseLanguages: string[];
  targetLanguages: string[];
}

export function PrototypeA({
  baseLanguages,
  targetLanguages,
}: PrototypeAProps) {
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

  const allCodes = [...baseLanguages, ...targetLanguages];

  // Build the timeline sequence
  const timelineItems: React.ReactNode[] = [];

  const activeBase = baseLanguages.filter(
    (c) => (langSettings[c]?.plays ?? DEFAULT_REPETITIONS_BASE) > 0,
  );
  const activeTarget = targetLanguages.filter(
    (c) => (langSettings[c]?.plays ?? DEFAULT_REPETITIONS_TARGET) > 0,
  );

  // Base languages
  activeBase.forEach((code, idx) => {
    const lang = getLanguageByCode(code);
    const settings = langSettings[code];
    const plays = settings?.plays ?? DEFAULT_REPETITIONS_BASE;
    const repPause = settings?.repPause ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;

    timelineItems.push(
      <TimelineAudioBlock
        key={`base-${code}`}
        flag={lang?.flag ?? ''}
        name={lang?.name ?? code}
        type="base"
        plays={plays}
        repPause={repPause}
      />,
    );

    if (idx < activeBase.length - 1) {
      timelineItems.push(
        <TimelinePause
          key={`pause-base-${idx}`}
          label="Base → Base"
          seconds={pauseBaseToBase}
          onChange={setPauseBaseToBase}
        />,
      );
    }
  });

  // Pause between base and target
  if (activeBase.length > 0 && activeTarget.length > 0) {
    timelineItems.push(
      <TimelinePause
        key="pause-b2t"
        label="Base → Target"
        seconds={pauseBaseToTarget}
        onChange={setPauseBaseToTarget}
        accent
      />,
    );
  }

  // Target languages
  activeTarget.forEach((code, idx) => {
    const lang = getLanguageByCode(code);
    const settings = langSettings[code];
    const plays = settings?.plays ?? DEFAULT_REPETITIONS_TARGET;
    const repPause = settings?.repPause ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS;

    timelineItems.push(
      <TimelineAudioBlock
        key={`target-${code}`}
        flag={lang?.flag ?? ''}
        name={lang?.name ?? code}
        type="target"
        plays={plays}
        repPause={repPause}
      />,
    );

    if (idx < activeTarget.length - 1) {
      timelineItems.push(
        <TimelinePause
          key={`pause-target-${idx}`}
          label="Target → Target"
          seconds={pauseTargetToTarget}
          onChange={setPauseTargetToTarget}
        />,
      );
    }
  });

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

      {/* Per-language plays and repetition pauses */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Language Repetitions
        </p>

        {/* Column headers */}
        <div className="flex items-center gap-3">
          <div className="flex-1" />
          <span className="w-14 text-center text-[11px] text-muted-foreground">
            Plays
          </span>
          <span className="w-14 text-center text-[11px] text-muted-foreground">
            Pause
          </span>
        </div>

        <div className="space-y-2">
          {allCodes.map((code) => {
            const lang = getLanguageByCode(code);
            const isBase = baseLanguages.includes(code);
            const settings = langSettings[code] ?? getDefaultsFor(code);
            return (
              <div key={code} className="flex items-center gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-sm">{lang?.flag}</span>
                  <span className="text-sm truncate">{lang?.name ?? code}</span>
                  <Badge
                    variant={isBase ? 'secondary' : 'outline'}
                    className="text-[10px] shrink-0"
                  >
                    {isBase ? 'Base' : 'Target'}
                  </Badge>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  value={
                    settings?.plays ??
                    (isBase
                      ? DEFAULT_REPETITIONS_BASE
                      : DEFAULT_REPETITIONS_TARGET)
                  }
                  onChange={(e) =>
                    updateLang(code, 'plays', parseInt(e.target.value) || 0)
                  }
                  className="w-14 h-8 text-center text-sm"
                />
                <Input
                  type="number"
                  min={0}
                  max={30}
                  step={1}
                  value={
                    settings?.repPause ?? DEFAULT_PAUSE_BETWEEN_REPETITIONS
                  }
                  onChange={(e) =>
                    updateLang(code, 'repPause', parseInt(e.target.value) || 0)
                  }
                  className="w-14 h-8 text-center text-sm"
                />
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Playback timeline visualization */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Playback Sequence Preview
        </p>
        <p className="text-muted-xs">
          Preview of the audio playback order. Edit pauses inline.
        </p>

        <div className="flex flex-col items-center gap-0 py-2">
          {timelineItems.length > 0 ? (
            timelineItems
          ) : (
            <p className="text-muted-xs py-4">All languages set to 0 plays</p>
          )}

          {/* Auto-advance indicator */}
          {autoAdvance && timelineItems.length > 0 && (
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

// ---- Timeline sub-components ----

function TimelineAudioBlock({
  flag,
  name,
  type,
  plays,
  repPause,
}: {
  flag: string;
  name: string;
  type: 'base' | 'target';
  plays: number;
  repPause: number;
}) {
  return (
    <div className="w-full max-w-[280px]">
      <div
        className={`rounded-lg border-2 px-3 py-2 text-center ${
          type === 'base'
            ? 'border-timeline-base-border bg-timeline-base'
            : 'border-timeline-target-border bg-timeline-target'
        }`}
      >
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-base">{flag}</span>
          <span className="text-sm font-medium">{name}</span>
        </div>
        <div className="text-muted-xs mt-0.5">
          {plays}x {plays > 1 && repPause > 0 ? `(${repPause}s between)` : ''}
        </div>
      </div>
    </div>
  );
}

function TimelinePause({
  label,
  seconds,
  onChange,
  accent,
}: {
  label: string;
  seconds: number;
  onChange: (v: number) => void;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center py-0.5">
      {/* Vertical connector line */}
      <div className={`w-px h-2.5 ${accent ? 'bg-primary' : 'bg-border'}`} />

      {/* Editable pause bubble */}
      <div
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${
          accent
            ? 'bg-primary/10 text-primary border border-primary/30'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <span className="whitespace-nowrap">{label}</span>
        <Input
          type="number"
          min={0}
          max={30}
          step={1}
          value={seconds}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="w-10 h-5 text-center text-xs rounded border border-border bg-background px-1 py-0 shadow-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span>s</span>
      </div>

      {/* Vertical connector line */}
      <div className={`w-px h-2.5 ${accent ? 'bg-primary' : 'bg-border'}`} />
    </div>
  );
}
