import type { PriorApp } from '../types';

/**
 * Toggle one prior-app answer, keeping "none of these" exclusive with the
 * real apps: picking an app drops `none`, and picking `none` clears
 * everything else. Without that rule the answer set can say both "I used
 * Anki" and "I used none of these", which is the one combination the
 * question can't mean.
 *
 * Pure and exported so the rule is pinned by a test rather than by whoever
 * next edits the wizard's toggle handler.
 */
export function togglePriorApp(
  selected: readonly PriorApp[],
  value: PriorApp,
): PriorApp[] {
  if (selected.includes(value)) return selected.filter((a) => a !== value);
  if (value === 'none') return ['none'];
  return [...selected.filter((a) => a !== 'none'), value];
}
