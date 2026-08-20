import type { Config, DriveStep } from 'driver.js';

const DRIVER_OVERLAY_OPACITY_VAR = '--driver-overlay-opacity';

/** Opaque fill + single opacity for driver.js SVG overlay (see app/globals.css). */
export function getDriverOverlayOpacity(): number {
  if (typeof document === 'undefined') return 0.5;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(DRIVER_OVERLAY_OPACITY_VAR)
    .trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/**
 * Base driver.js config shared by the guided tours (use-tutorial) and the
 * in-lesson tips (use-milestone-tips), so the overlay/stage tuning can't
 * drift between them. Evaluated at call time because the overlay opacity is
 * read from a live CSS variable (theme-dependent).
 */
export function baseDriverConfig(): Pick<
  Config,
  | 'animate'
  | 'showButtons'
  | 'overlayColor'
  | 'overlayOpacity'
  | 'stagePadding'
  | 'stageRadius'
> {
  return {
    animate: true,
    showButtons: ['next', 'previous', 'close'],
    overlayColor: '#000',
    overlayOpacity: getDriverOverlayOpacity(),
    stagePadding: 8,
    stageRadius: 8,
  };
}

/**
 * Resolve each string-selector step to the first VISIBLE matching element.
 *
 * `visibility: hidden` keeps its layout box (e.g. the due-count pills reserve
 * their width while counts load), so a pure rect check would highlight a
 * blank rectangle — treat such elements as absent.
 *
 * When no visible match exists, `onMiss` decides the fallback:
 * - `'keep-selector'` — return the step untouched; driver.js re-queries the
 *   selector itself at highlight time (tours: the element may mount later).
 * - `'unanchor'` — drop the element so the step renders as a centered
 *   popover (tips: pointing at nothing is worse than not pointing).
 */
export function resolveStepAnchors(
  steps: DriveStep[],
  { onMiss }: { onMiss: 'keep-selector' | 'unanchor' },
): DriveStep[] {
  return steps.map((step) => {
    if (typeof step.element !== 'string') return step;
    const candidates = document.querySelectorAll<HTMLElement>(step.element);
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        getComputedStyle(el).visibility !== 'hidden'
      ) {
        return { ...step, element: el };
      }
    }
    return onMiss === 'unanchor' ? { ...step, element: undefined } : step;
  });
}
