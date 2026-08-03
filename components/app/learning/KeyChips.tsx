'use client';

import { Fragment } from 'react';
import { Kbd, KbdGroup } from '@/components/ui/kbd';

/**
 * Keyboard-key chips with an optional separator between them — the shared
 * renderer behind the control tooltips (KeyHint in LearningControls) and the
 * shortcuts legend (ShortcutRow in LearningHeader). `join` disambiguates
 * multi-chip hints: "+" for chords (Shift+R), "/" for alternatives
 * (Enter / →), "–" for ranges (1–4); omitted = plain adjacency.
 */
export function KeyChips({
  keys,
  join,
  className,
}: {
  keys: string[];
  join?: string;
  className?: string;
}) {
  return (
    <KbdGroup className={className}>
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 && join && <span aria-hidden>{join}</span>}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  );
}
