/**
 * Shared CEFR tier metadata for the segmented home view. Mirrors
 * `convex/lib/collections.ts:LEGACY_LEVEL_ORDER` and the upload script's CEFR
 * mapping, with `Pre-A1` added for the new OGTE 20-level course (L01).
 */

export type Cefr = 'Pre-A1' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export const CEFR_ORDER: Cefr[] = [
  'Pre-A1',
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
];

/**
 * Each tier is a stop along a blue → yellow → orange gradient using the
 * project's three brand tokens (`--primary`, `--warning`, `--accent-orange`).
 *
 *   Pre-A1 ── A1 ── A2 ── B1 ── B2 ── C1 ── C2
 *    blue ───── mix ────── yellow ─── mix ── orange
 *
 * Values are CSS `color-mix(in oklch, …)` expressions so they auto-track theme
 * changes (light/dark mode tweaks to the underlying CSS variables flow
 * through). Browsers handle the nested `color-mix` calls our chip backgrounds
 * apply on top of these values (e.g. `color-mix(in oklch, <stop> 22%, transparent)`).
 */
export const CEFR_COLORS: Record<Cefr, string> = {
  'Pre-A1': 'var(--primary)',
  A1: 'color-mix(in oklch, var(--primary) 75%, var(--warning))',
  A2: 'color-mix(in oklch, var(--primary) 50%, var(--warning))',
  B1: 'color-mix(in oklch, var(--primary) 25%, var(--warning))',
  B2: 'var(--warning)',
  C1: 'color-mix(in oklch, var(--warning) 50%, var(--accent-orange))',
  C2: 'var(--accent-orange)',
};

export function isCefr(value: string): value is Cefr {
  return (CEFR_ORDER as readonly string[]).includes(value);
}
