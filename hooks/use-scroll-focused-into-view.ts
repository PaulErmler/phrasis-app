'use client';

import * as React from 'react';

/**
 * Returns a ref for a horizontally scrollable rail and, whenever `focusedId`
 * changes, scrolls the descendant marked `data-focused="true"` into view.
 *
 * Horizontal-only "scroll into view if needed". Equivalent to
 * `scrollIntoView({ block: 'nearest', inline: 'nearest' })` but
 * operating only on the rail's scrollLeft, so the page is never
 * nudged vertically (the mobile OS-chrome jog bug). If the focused
 * chip is already fully visible we leave the rail where it is.
 * The previous "always center" behavior shifted the rail on every
 * selection, which surprised users who'd manually scrolled it.
 */
export function useScrollFocusedIntoView(focusedId: string | null) {
  const railRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const rail = railRef.current;
    const el = rail?.querySelector(
      `[data-focused="true"]`,
    ) as HTMLElement | null;
    if (!rail || !el) return;
    const railRect = rail.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.left < railRect.left) {
      rail.scrollTo({
        left: rail.scrollLeft + (elRect.left - railRect.left),
        behavior: 'smooth',
      });
    } else if (elRect.right > railRect.right) {
      rail.scrollTo({
        left: rail.scrollLeft + (elRect.right - railRect.right),
        behavior: 'smooth',
      });
    }
  }, [focusedId]);

  return railRef;
}
