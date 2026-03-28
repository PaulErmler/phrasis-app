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

/** Maximum character length for any single translation text (editing and creating cards). */
export const MAX_CARD_TEXT_LENGTH = 150;

/** In custom text entry, show n/max only when this many or fewer characters remain (or over limit). */
export const CARD_TEXT_SHOW_COUNT_REMAINING_THRESHOLD = 20;
