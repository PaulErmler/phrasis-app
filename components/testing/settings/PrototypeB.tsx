'use client';

/**
 * Prototype B: Per-language cards with slider controls
 *
 * Each language gets a self-contained card/row with slider controls for both
 * play count and repetition pause. Global pauses (base→base, base→target,
 * target→target) shown as labeled divider rows between groups.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
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

interface PrototypeBProps {
  baseLanguages: string[];
  targetLanguages: string[];
}

export function PrototypeB({
  baseLanguages,
  targetLanguages,
}: PrototypeBProps) {
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

      {/* BASE LANGUAGES */}
      <div className="space-y-3">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Base Languages
        </p>

        {baseLanguages.map((code, idx) => (
          <div key={code}>
            <LanguageCard
              code={code}
              type="base"
              settings={langSettings[code] ?? getDefaultsFor(code)}
              onChange={(key, val) => updateLang(code, key, val)}
            />
            {idx < baseLanguages.length - 1 && (
              <div className="my-3">
                <PauseDivider
                  label="Base → Base"
                  seconds={pauseBaseToBase}
                  onChange={setPauseBaseToBase}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Base → Target divider with editable pause */}
      <PauseDivider
        label="Base → Target"
        seconds={pauseBaseToTarget}
        onChange={setPauseBaseToTarget}
        accent
      />

      {/* TARGET LANGUAGES */}
      <div className="space-y-3">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Target Languages
        </p>

        {targetLanguages.map((code, idx) => (
          <div key={code}>
            <LanguageCard
              code={code}
              type="target"
              settings={langSettings[code] ?? getDefaultsFor(code)}
              onChange={(key, val) => updateLang(code, key, val)}
            />
            {idx < targetLanguages.length - 1 && (
              <div className="my-3">
                <PauseDivider
                  label="Target → Target"
                  seconds={pauseTargetToTarget}
                  onChange={setPauseTargetToTarget}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Language card ----

function LanguageCard({
  code,
  type,
  settings,
  onChange,
}: {
  code: string;
  type: 'base' | 'target';
  settings: LanguageSettings;
  onChange: (key: keyof LanguageSettings, value: number) => void;
}) {
  const lang = getLanguageByCode(code);
  const plays = settings?.plays ?? 0;
  const repPause = settings?.repPause ?? 0;
  const isDisabled = plays === 0;

  return (
    <div
      className={`rounded-xl border p-3 space-y-3 transition-opacity ${
        isDisabled ? 'opacity-50' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-lg">{lang?.flag}</span>
        <span className="text-sm font-medium">{lang?.name ?? code}</span>
        <Badge
          variant={type === 'base' ? 'secondary' : 'outline'}
          className="text-[10px] shrink-0"
        >
          {type === 'base' ? 'Base' : 'Target'}
        </Badge>
      </div>

      {/* Plays slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Plays</span>
          <span className="text-xs font-medium tabular-nums w-6 text-right">
            {plays}x
          </span>
        </div>
        <Slider
          min={0}
          max={10}
          step={1}
          value={[plays]}
          onValueChange={([v]) => onChange('plays', v)}
        />
      </div>

      {/* Repetition pause slider (only relevant if plays > 1) */}
      {plays > 1 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Pause between repetitions
            </span>
            <span className="text-xs font-medium tabular-nums w-6 text-right">
              {repPause}s
            </span>
          </div>
          <Slider
            min={0}
            max={30}
            step={1}
            value={[repPause]}
            onValueChange={([v]) => onChange('repPause', v)}
          />
        </div>
      )}
    </div>
  );
}

// ---- Pause divider ----

function PauseDivider({
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
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <div
          className={`flex-1 h-px ${accent ? 'bg-primary/40' : 'bg-border'}`}
        />
        <span
          className={`text-xs whitespace-nowrap ${
            accent ? 'text-primary font-medium' : 'text-muted-foreground'
          }`}
        >
          {label}
        </span>
        <div
          className={`flex-1 h-px ${accent ? 'bg-primary/40' : 'bg-border'}`}
        />
      </div>
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-1.5">
          <Slider
            min={0}
            max={30}
            step={1}
            value={[seconds]}
            onValueChange={([v]) => onChange(v)}
            className="w-28"
          />
          <span className="text-xs font-medium tabular-nums w-6 text-right">
            {seconds}s
          </span>
        </div>
      </div>
    </div>
  );
}
