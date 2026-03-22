/**
 * Shared constants for collection ordering and level-to-collection mapping.
 * Used by both backend (onboarding, auto-advance) and can be imported by frontend helpers.
 */

/** CEFR-based collection order from easiest to hardest. */
export const LEVEL_ORDER = [
  'Essential',
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
] as const;

/** How many upcoming texts to fetch/pre-generate for collection previews. */
export const COLLECTION_PREVIEW_SIZE = 5;

/**
 * Maps the onboarding `currentLevel` value to the collection name that should
 * be preselected as the user's starting difficulty.
 *
 * | currentLevel       | Collection |
 * |--------------------|------------|
 * | beginner           | Essential  |
 * | elementary         | A2         |
 * | intermediate       | B1         |
 * | upper_intermediate | B2         |
 * | advanced           | C1         |
 */
export const LEVEL_TO_COLLECTION: Record<string, string> = {
  beginner: 'Essential',
  elementary: 'A2',
  intermediate: 'B1',
  upper_intermediate: 'B2',
  advanced: 'C1',
};

/**
 * Given a collection name, returns the name of the next collection in
 * `LEVEL_ORDER`, or `null` if the given name is the last (or unknown).
 */
export function getNextCollectionName(currentName: string): string | null {
  const idx = LEVEL_ORDER.indexOf(currentName as (typeof LEVEL_ORDER)[number]);
  if (idx === -1 || idx >= LEVEL_ORDER.length - 1) return null;
  return LEVEL_ORDER[idx + 1];
}
