/**
 * Card-action keys that the user can promote onto the card surface (the row
 * of icon buttons left of the `...` menu in `CardActionsMenu`).
 *
 * Persisted as `userSettings.pinnedCardActions` and validated by the
 * `updatePinnedCardActions` mutation. The order of entries is the render
 * order on the surface.
 */
export const PINNABLE_CARD_ACTIONS = [
  'favorite',
  'master',
  'hide',
  'edit',
  'regenerateAudio',
  'flag',
] as const;

export type PinnableCardAction = (typeof PINNABLE_CARD_ACTIONS)[number];

// Regenerate-audio is on the surface by default (2026-09-04) so a learner
// who hears a bad clip can fix it in one tap without opening the menu. Users
// who have saved their own pins keep them; only the empty default changes.
export const DEFAULT_PINNED_CARD_ACTIONS: readonly PinnableCardAction[] = [
  'favorite',
  'master',
  'hide',
  'edit',
  'regenerateAudio',
];

export const MAX_PINNED_CARD_ACTIONS = 5;

export function isPinnableCardAction(
  value: string,
): value is PinnableCardAction {
  return (PINNABLE_CARD_ACTIONS as readonly string[]).includes(value);
}

/**
 * Normalize a raw `pinnedCardActions` array from storage or user input:
 * filter to the whitelist, dedupe preserving order, and clamp to the max.
 * Returns the default when the input is empty/undefined.
 */
export function normalizePinnedCardActions(
  input: readonly string[] | undefined,
): PinnableCardAction[] {
  if (!input || input.length === 0) {
    return [...DEFAULT_PINNED_CARD_ACTIONS];
  }
  const seen = new Set<PinnableCardAction>();
  const result: PinnableCardAction[] = [];
  for (const entry of input) {
    if (!isPinnableCardAction(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
    if (result.length >= MAX_PINNED_CARD_ACTIONS) break;
  }
  return result.length > 0 ? result : [...DEFAULT_PINNED_CARD_ACTIONS];
}
