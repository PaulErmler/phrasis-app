'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { StepperControl } from '@/components/app/learning/StepperControl';
import { cn } from '@/lib/utils';

/**
 * Prototype: how the Practice-Listening deactivation strategy ("Only new"
 * vs "Until rated good") could slot into the settings panel. Three variants,
 * all fully interactive on local state — pick one and it gets wired to
 * `targetBeforeListeningStrategy` / the two X steppers for real.
 */

type Strategy = 'onlyNew' | 'untilGood';

interface StrategyState {
  strategy: Strategy;
  onlyNewReps: number; // 0 = ∞
  untilGoodReps: number; // min 1
}

const INITIAL: StrategyState = { strategy: 'onlyNew', onlyNewReps: 1, untilGoodReps: 1 };

export default function ListeningStrategyPrototypes() {
  return (
    <div className="space-y-8 max-w-5xl">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">Practice Listening — strategy selection</h1>
        <p className="text-sm text-muted-foreground">
          Replaces the current single &quot;Only new&quot; stepper row. All three variants sit in
          the indent rail below the Practice Listening switch (shown for context) and only
          appear when both Listening and Speaking are on.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3 items-start">
        <VariantFrame
          title="A — Select in the rail"
          note="One compact row: strategy dropdown + one stepper whose label/∞ behavior follows the choice. Smallest footprint, matches existing sub-setting look."
        >
          <VariantA />
        </VariantFrame>
        <VariantFrame
          title="B — Segmented control"
          note="Same pattern as the Translate/Transcribe writing-style picker: two tab-like buttons with a description that swaps, stepper below."
        >
          <VariantB />
        </VariantFrame>
        <VariantFrame
          title="C — Radio rows with inline steppers"
          note="Both strategies always visible, each owns its X inline; the inactive row is dimmed. Most explicit, tallest."
        >
          <VariantC />
        </VariantFrame>
      </div>
    </div>
  );
}

/** Panel chrome mimicking LearningModeSettings: the two Practice switches + the rail. */
function VariantFrame({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <StaticSwitchRow
          label="Practice Speaking"
          description="Play the target language after the base language"
        />
        <StaticSwitchRow
          label="Practice Listening"
          description="Play the target language before the base language"
        />
        <div className="ml-4 pl-3 border-l-2 border-border">{children}</div>
      </div>
    </div>
  );
}

function StaticSwitchRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-muted-xs">{description}</p>
      </div>
      <Switch checked disabled className="opacity-80" />
    </div>
  );
}

// ─── Variant A: Select above one context-sensitive stepper ─────────────────

function VariantA() {
  const [s, setS] = useState<StrategyState>(INITIAL);
  const isOnlyNew = s.strategy === 'onlyNew';
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">Practice new sentences</Label>
        <p className="text-muted-xs">When does a sentence stop needing listening practice?</p>
      </div>
      <Select
        value={s.strategy}
        onValueChange={(v) => setS({ ...s, strategy: v as Strategy })}
      >
        <SelectTrigger className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="onlyNew">Only new — first repetitions</SelectItem>
          <SelectItem value="untilGood">Until rated Good</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-xs flex-1">
          {isOnlyNew
            ? 'Number of initial repetitions with listening practice'
            : 'Good or Easy ratings needed to finish listening practice'}
        </p>
        {isOnlyNew ? (
          <StepperControl
            value={s.onlyNewReps}
            min={0}
            max={10}
            onChange={(v) => setS({ ...s, onlyNewReps: v })}
            formatValue={(v) => (v <= 0 ? '∞' : String(v))}
          />
        ) : (
          <StepperControl
            value={s.untilGoodReps}
            min={1}
            max={10}
            onChange={(v) => setS({ ...s, untilGoodReps: v })}
          />
        )}
      </div>
    </div>
  );
}

// ─── Variant B: segmented two-button control (Translate/Transcribe pattern) ─

function VariantB() {
  const [s, setS] = useState<StrategyState>(INITIAL);
  const isOnlyNew = s.strategy === 'onlyNew';
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">Practice new sentences</Label>
        <p className="text-muted-xs">When does a sentence stop needing listening practice?</p>
      </div>
      <div className="rounded-lg border bg-muted/50 p-1 grid grid-cols-2 gap-1">
        {(
          [
            { key: 'onlyNew', label: 'Only new' },
            { key: 'untilGood', label: 'Until rated Good' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setS({ ...s, strategy: key })}
            className={cn(
              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              s.strategy === key
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-muted-xs">
        {isOnlyNew
          ? 'Listening practice plays on a sentence’s first repetitions, then switches to speaking practice.'
          : 'Listening practice keeps playing until you rate the sentence Good or Easy often enough.'}
      </p>
      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium">
          {isOnlyNew ? 'Repetitions' : 'Good ratings'}
        </Label>
        {isOnlyNew ? (
          <StepperControl
            value={s.onlyNewReps}
            min={0}
            max={10}
            onChange={(v) => setS({ ...s, onlyNewReps: v })}
            formatValue={(v) => (v <= 0 ? '∞' : String(v))}
          />
        ) : (
          <StepperControl
            value={s.untilGoodReps}
            min={1}
            max={10}
            onChange={(v) => setS({ ...s, untilGoodReps: v })}
          />
        )}
      </div>
    </div>
  );
}

// ─── Variant C: radio rows, each with its own inline stepper ────────────────

function VariantC() {
  const [s, setS] = useState<StrategyState>(INITIAL);
  return (
    <RadioGroup
      value={s.strategy}
      onValueChange={(v) => setS({ ...s, strategy: v as Strategy })}
      className="space-y-3"
    >
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">Practice new sentences</Label>
        <p className="text-muted-xs">When does a sentence stop needing listening practice?</p>
      </div>
      <StrategyRadioRow
        active={s.strategy === 'onlyNew'}
        value="onlyNew"
        title="Only new"
        description="First repetitions of a sentence"
        stepper={
          <StepperControl
            value={s.onlyNewReps}
            min={0}
            max={10}
            onChange={(v) => setS({ ...s, onlyNewReps: v })}
            formatValue={(v) => (v <= 0 ? '∞' : String(v))}
          />
        }
      />
      <StrategyRadioRow
        active={s.strategy === 'untilGood'}
        value="untilGood"
        title="Until rated Good"
        description="Until this many Good/Easy ratings"
        stepper={
          <StepperControl
            value={s.untilGoodReps}
            min={1}
            max={10}
            onChange={(v) => setS({ ...s, untilGoodReps: v })}
          />
        }
      />
    </RadioGroup>
  );
}

function StrategyRadioRow({
  active,
  value,
  title,
  description,
  stepper,
}: {
  active: boolean;
  value: string;
  title: string;
  description: string;
  stepper: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border p-2.5 transition-colors cursor-pointer',
        active ? 'border-primary/40 bg-primary/5' : 'opacity-60 hover:opacity-90',
      )}
    >
      <div className="flex items-center gap-2.5">
        <RadioGroupItem value={value} />
        <div className="space-y-0.5">
          <span className="text-sm font-medium leading-none">{title}</span>
          <p className="text-muted-xs">{description}</p>
        </div>
      </div>
      <div className={cn(!active && 'pointer-events-none')}>{stepper}</div>
    </label>
  );
}
