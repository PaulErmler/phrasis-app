'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';
import {
  DEFAULT_AUTO_RATE_THRESHOLDS,
  resolveAutoRateThresholds,
  type AutoRateThresholds,
} from '@/lib/autoRating';

/**
 * Two-thumb slider that renders the three auto-rate bands.
 *
 * Built directly on @radix-ui/react-slider rather than components/ui/slider:
 * that wrapper hardcodes the className on Track and Thumb with no
 * pass-through, and Radix draws a single Range between the thumbs, so three
 * differently coloured bands are impossible through it. Here the Range is
 * dropped entirely and the bands are absolutely positioned inside the Track,
 * which clips them because it is overflow-hidden.
 *
 * Colours follow the playback-sequence preview: a pale fill with a saturated
 * border of the same hue. Again and Good reuse the timeline tokens outright so
 * they match those chips exactly and flip for dark mode on their own; Hard has
 * no equivalent token, so it is mixed from --warning to the same weight.
 */

// `key` doubles as the `LearningMode.ratings` message key, so a band can never
// be labelled with a different rating than the one it selects.
const BANDS = [
  {
    key: 'again' as const,
    fill: 'var(--timeline-target)',
    border: 'var(--timeline-target-border)',
  },
  {
    key: 'hard' as const,
    fill: 'color-mix(in oklch, var(--warning) 22%, var(--background))',
    border: 'color-mix(in oklch, var(--warning) 62%, var(--background))',
  },
  {
    key: 'good' as const,
    fill: 'var(--timeline-base)',
    border: 'var(--timeline-base-border)',
  },
];

// Each thumb sits between two bands; naming it from the same rating keys keeps
// the aria-label in step with the visible labels.
const BOUNDARIES = [
  ['again', 'hard'],
  ['hard', 'good'],
] as const;

// Drawn from the Again band's own border colour rather than a fixed white or
// black, so it stays visible on the pale fill in light mode and on the darker
// fill in dark mode without needing a per-mode value.
const STRIPE = `repeating-linear-gradient(45deg, transparent 0 5px, color-mix(in oklch, ${BANDS[0].border} 45%, transparent) 5px 10px)`;

const AUTO_RATE_STEP = 5;

interface AutoRateBandSliderProps {
  /** `[hard, good]` — the two boundaries, 0-100. */
  value: [number, number];
  /** Fires continuously while dragging; keep this local. */
  onValueChange: (value: [number, number]) => void;
  /** Fires once on release — persist here, not on every pixel. */
  onValueCommit: (value: [number, number]) => void;
  disabled?: boolean;
}

export function AutoRateBandSlider({
  value,
  onValueChange,
  onValueCommit,
  disabled,
}: AutoRateBandSliderProps) {
  const tRatings = useTranslations('LearningMode.ratings');
  const tPanel = useTranslations('LearningMode.settingsPanel');
  const [hard, good] = value;
  const widths = [hard, good - hard, 100 - good];
  const lefts = [0, hard, good];

  return (
    <div className="space-y-1.5">
      {/* Value chips sit above the track so a dragging finger never covers them */}
      <div className="relative h-5">
        {value.map((v, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
            style={{ left: `clamp(14px, ${v}%, calc(100% - 14px))` }}
          >
            {v}%
          </span>
        ))}
      </div>

      <SliderPrimitive.Root
        value={value}
        onValueChange={(v) => onValueChange([v[0], v[1]])}
        onValueCommit={(v) => onValueCommit([v[0], v[1]])}
        min={0}
        max={100}
        step={AUTO_RATE_STEP}
        minStepsBetweenThumbs={1}
        disabled={disabled}
        // touch-none is essential — without it a drag scrolls the settings
        // sheet instead of moving the thumb on iOS.
        className="relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50"
      >
        <SliderPrimitive.Track className="relative h-9 w-full grow overflow-hidden rounded-lg bg-muted">
          {BANDS.map((band, i) => (
            <div
              key={band.key}
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden"
              style={{
                left: `${lefts[i]}%`,
                width: `${widths[i]}%`,
                background: band.fill,
                border: `1px solid ${band.border}`,
                color: 'var(--foreground)',
              }}
            >
              {band.key === 'again' && (
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{ backgroundImage: STRIPE }}
                />
              )}
              {/* Hidden when the band is too narrow to hold its label */}
              {widths[i] >= 18 && (
                <span className="relative text-[11px] font-medium whitespace-nowrap">
                  {tRatings(band.key)}
                </span>
              )}
            </div>
          ))}
        </SliderPrimitive.Track>

        {BOUNDARIES.map(([lower, upper], i) => (
            <SliderPrimitive.Thumb
              key={i}
              aria-label={tPanel('autoRateBoundary', {
                lower: tRatings(lower),
                upper: tRatings(upper),
              })}
              // The visual is 20x36; the ::after pseudo-element widens the hit
              // area to roughly 52px square without disturbing layout.
              className={cn(
                'relative block h-9 w-5 shrink-0 rounded-md border-2 border-foreground/80 bg-background shadow-md',
                "after:absolute after:-inset-x-3.5 after:-inset-y-2 after:content-['']",
                'transition-[box-shadow] hover:ring-4 hover:ring-ring/40',
                'focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:outline-hidden',
                'disabled:pointer-events-none',
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-foreground/40"
              />
            </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Root>
    </div>
  );
}

/**
 * The slider plus the draft state it needs.
 *
 * Persisting on every `onValueChange` would fire a Convex mutation (and its
 * optimistic update) for every pixel of a drag, so the live value is held
 * locally and only written on release. When the stored value changes
 * underneath us — another tab, or the mutation resolving — the draft re-syncs.
 */
export function AutoRateThresholdControl({
  thresholds,
  onCommit,
}: {
  thresholds: AutoRateThresholds | undefined;
  onCommit: (next: { hard: number; good: number }) => void;
}) {
  const resolved = resolveAutoRateThresholds(
    thresholds ?? DEFAULT_AUTO_RATE_THRESHOLDS,
  );
  const persisted: [number, number] = [resolved.hard, resolved.good];

  const [draft, setDraft] = useState<[number, number]>(persisted);
  const [prevPersisted, setPrevPersisted] = useState<[number, number]>(persisted);
  if (
    prevPersisted[0] !== persisted[0] ||
    prevPersisted[1] !== persisted[1]
  ) {
    setPrevPersisted(persisted);
    setDraft(persisted);
  }

  return (
    <AutoRateBandSlider
      value={draft}
      onValueChange={setDraft}
      onValueCommit={([hard, good]) => onCommit({ hard, good })}
    />
  );
}
