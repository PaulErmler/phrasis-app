'use client';

import {
  nextCardOverrideValue,
  nextEphemeralCardOverrideValue,
} from '@/lib/constants/audioPlayback';

interface CardSpeedBadgeProps {
  /**
   * Current override value. Semantics depend on `variant`:
   * - persistent: `null` = no stored override (displays general speed greyed).
   * - ephemeral: `null` = initial "resting" state (displays 1.0 greyed).
   */
  override: number | null;
  /**
   * Course-level per-language general speed. Only used by `persistent`; the
   * `ephemeral` variant ignores it and always falls back to 1.0.
   */
  generalSpeed: number;
  /**
   * Called with the next cycle value on click. In `persistent` mode this
   * may be `null` (clears the override). In `ephemeral` mode it is always a
   * number. The cycle has no null slot.
   */
  onCycle: (next: number | null) => void;
  /**
   * `persistent` (default) is for surfaces that save the override on the
   * card. `ephemeral` is for preview surfaces (library, word-cloud dialog)
   * where the speed is local state and 1.0 is always rendered greyed.
   */
  variant?: 'persistent' | 'ephemeral';
}

/**
 * Small clickable speed indicator rendered under an AudioButton. Shows the
 * effective playback speed and cycles through slowdown values on click.
 */
export function CardSpeedBadge({
  override,
  generalSpeed,
  onCycle,
  variant = 'persistent',
}: CardSpeedBadgeProps) {
  const isEphemeral = variant === 'ephemeral';

  // In ephemeral mode the badge ignores `generalSpeed` and treats `null` as
  // 1.0. The "no change" resting display.
  const displayed = isEphemeral
    ? (override ?? 1.0)
    : (override ?? generalSpeed);

  // Greying rule: persistent greys only the null/default state; ephemeral
  // greys whenever the effective speed is 1.0 (there's no separate default).
  const muted = isEphemeral ? displayed === 1.0 : override === null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = isEphemeral
      ? nextEphemeralCardOverrideValue(override)
      : nextCardOverrideValue(override);
    onCycle(next);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={[
        'tabular-nums rounded h-5 px-1 text-[11px] leading-none transition-colors',
        'hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        muted
          ? 'text-muted-foreground/70 italic'
          : 'text-foreground font-medium',
      ].join(' ')}
      aria-label={`Playback speed ${displayed.toFixed(1)}x${muted ? ' (default)' : ''}`}
    >
      {displayed.toFixed(1)}x
    </button>
  );
}
