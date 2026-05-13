/**
 * Pure constants and synchronous helpers for collection ordering,
 * level-to-collection mapping, and curriculum-vs-custom classification.
 *
 * Works across two collection generations:
 * - **Legacy**: pre-dataset rows with names in `LEGACY_LEVEL_ORDER` (Essential,
 *   A1..C2). No `datasetId` set.
 * - **New (OGTE)**: rows with `datasetId` set and a `code` like L01..L20.
 *
 * Async DB helpers (`getActiveDataset`, `resolveStartingCollection`,
 * `getNextCollection`, `findNextIncompleteCollection`) live in
 * `convex/db/collections.ts`.
 */

import type { Doc } from '../_generated/dataModel';

/** Legacy CEFR collection order, kept for back-compat with old courses. */
export const LEGACY_LEVEL_ORDER = [
  'Essential',
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
] as const;

/**
 * Mapping from a legacy CEFR collection NAME to the new-dataset collection
 * CODE that receives the user's rolled-forward progress credit.
 *
 * Legacy A1 lands on L02 (the new A1 tier starts at L02); legacy C2 lands on
 * L17 (first level of the new C2 tier). Used by:
 * - `datasetMigration_cutoverUser.cutoverUser` to roll counters forward at
 *   cutover time.
 * - `bumpCardsMastered` (db/stats/cardAggregates.ts) to redirect mastery
 *   events on legacy cards onto the new collection post-cutover.
 */
export const LEGACY_TO_NEW_CODE: Record<string, string> = {
  Essential: 'L01',
  A1: 'L02',
  A2: 'L05',
  B1: 'L08',
  B2: 'L11',
  C1: 'L14',
  C2: 'L17',
};

/**
 * Back-compat alias. Prefer `LEGACY_LEVEL_ORDER` in new code, and
 * `isPremadeLevelCollection(collection)` for membership checks against the
 * active dataset.
 */
export const LEVEL_ORDER = LEGACY_LEVEL_ORDER;

/** How many upcoming texts to fetch for collection previews. */
export const COLLECTION_PREVIEW_SIZE = 5;

/**
 * How many upcoming texts (after current collection progress) to pre-generate
 * content for. Should be at least 2× {@link COLLECTION_PREVIEW_SIZE} so a +5 add
 * still leaves the next preview batch (and one more) covered.
 */
export const CONTENT_LOOKAHEAD_SIZE = 10;

/**
 * Maps the onboarding `currentLevel` value to a starting collection in BOTH
 * collection generations.
 *
 * | currentLevel       | Legacy name | New code | Approx. words known |
 * |--------------------|-------------|----------|---------------------|
 * | beginner           | Essential   | L01      | ~0                  |
 * | elementary         | A2          | L05      | ~1,000              |
 * | intermediate       | B1          | L08      | ~2,000              |
 * | upper_intermediate | B2          | L11      | ~3,500              |
 * | advanced           | C1          | L14      | ~5,000              |
 * | proficient         | C2          | L17      | 8,000+              |
 */
export const LEVEL_TO_COLLECTION: Record<string, { legacyName: string; code: string }> = {
  beginner: { legacyName: 'Essential', code: 'L01' },
  elementary: { legacyName: 'A2', code: 'L05' },
  intermediate: { legacyName: 'B1', code: 'L08' },
  upper_intermediate: { legacyName: 'B2', code: 'L11' },
  advanced: { legacyName: 'C1', code: 'L14' },
  proficient: { legacyName: 'C2', code: 'L17' },
};

/**
 * True iff this collection is a premade curriculum level (either a new-dataset
 * row or a legacy CEFR row). Used by auto-add and content-fetch flows to
 * distinguish curriculum collections from user-owned custom/chat collections.
 */
export function isPremadeLevelCollection(collection: Doc<'collections'>): boolean {
  if (collection.datasetId) return true;
  return (LEGACY_LEVEL_ORDER as readonly string[]).includes(collection.name);
}

