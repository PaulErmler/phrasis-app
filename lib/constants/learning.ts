/**
 * Learning-mode constants shared by Convex (decks, courses) and the frontend.
 * Single source of truth for batch sizes and content-generation cadence.
 */

/** Maximum number of cards that can be added per batch (settings and backend clamp). */
export const MAX_CARDS_PER_BATCH = 15;

/** How many upcoming due cards to pre-generate content for during review. */
export const ENSURE_CONTENT_LOOKAHEAD = 5;

/** Re-trigger content pre-generation every N reviews. */
export const ENSURE_CONTENT_REVIEW_INTERVAL = 4;
