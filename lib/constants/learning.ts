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

/** Max number of items accepted in a single bulk-import call (client and server clamp). */
export const MAX_IMPORT_BATCH = 500;

/** Max file size (bytes) accepted by the bulk-import dropzone. ~5 MB is well above the
 * theoretical worst case of MAX_IMPORT_BATCH * MAX_CARD_TEXT_LENGTH per language. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/** Interrupt the learning flow with a celebration screen every N reviews (per day). */
export const PROGRESS_DISPLAY_INTERVAL = 1;

/** How long the celebration screen stays before auto-advancing (ms). */
export const PROGRESS_DISPLAY_DURATION_MS = 7000;

/** Path to the celebration success sound (under public/). */
export const PROGRESS_SOUND_URL = '/sounds/progress-success.mp3';
