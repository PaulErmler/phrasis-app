/**
 * Learning-mode constants shared by Convex (decks, courses) and the frontend.
 * Single source of truth for batch sizes and content-generation cadence.
 */

/** Maximum number of cards that can be added per batch (settings and backend clamp). */
export const MAX_CARDS_PER_BATCH = 15;

/** How many upcoming due cards to pre-generate content for during review.
 * Sized to stay ahead of LLM translation latency (queued OpenRouter call per
 * non-source language), matches MAX_CARDS_PER_BATCH so a fresh add-batch is
 * fully primed before the learner can outrun it. */
export const ENSURE_CONTENT_LOOKAHEAD = 15;

/** Re-trigger content pre-generation every N reviews. */
export const ENSURE_CONTENT_REVIEW_INTERVAL = 4;

/** Cooldown before re-firing an ensure call for a card whose content is
 * still missing. Long enough for in-flight translation + TTS to land in the
 * common case, so retries mostly fire when the first attempt was actually
 * lost (silent mutation failure, a claim held by a job that died). */
export const ENSURE_CONTENT_RETRY_MS = 15_000;

/** Retry budget per stuck card. Bounds the ensure re-fires so a permanently
 * broken card (e.g. no voice configured for the language) can't ping the
 * backend for the whole session. */
export const ENSURE_CONTENT_MAX_RETRIES = 3;

/**
 * Consecutive card-adding runs that inserted cards while no card got served
 * in between before auto-add latches off (stall guard in useLearningMode).
 * Normal operation never exceeds 1-2 (one spurious re-fire can race the
 * reactive update that delivers the new card); reaching the cap means added
 * cards are invisible to the serving query (e.g. extreme client-clock skew),
 * and adding more would loop forever. The manual Add button bypasses the
 * latch, same as the exhausted latch.
 */
export const MAX_UNSERVED_ADD_RUNS = 3;

/** Maximum character length for any single translation text (editing and creating cards). */
export const MAX_CARD_TEXT_LENGTH = 150;

/** Max stored AI-feedback accepted alternatives per (card, language). Shared
 * by the store mutation (convex/features/writingFeedback.ts) and the
 * getCardForReview payload that ships them to the writing card. */
export const WRITING_ALTERNATIVES_MAX = 5;

/** In custom text entry, show n/max only when this many or fewer characters remain (or over limit). */
export const CARD_TEXT_SHOW_COUNT_REMAINING_THRESHOLD = 20;

/** Max number of items accepted in a single bulk-import call (client and server clamp). */
export const MAX_IMPORT_BATCH = 500;

/** Max file size (bytes) accepted by the bulk-import dropzone. ~5 MB is well above the
 * theoretical worst case of MAX_IMPORT_BATCH * MAX_CARD_TEXT_LENGTH per language. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/** How many of the most recent reviews can be undone in learning mode.
 * Bounds the per-(user, course) `reviewLogs` undo stack. */
export const UNDO_DEPTH = 3;

/** Interrupt the learning flow with a celebration screen every N reviews (per day). */
export const PROGRESS_DISPLAY_INTERVAL = 20;

/**
 * Whether the review about to be submitted lands on a celebration milestone.
 * A client-side prediction from the local daily count, which can be stale
 * across tabs; the server's `triggerCelebration` (features/reviewPipeline.ts)
 * is the authoritative verdict. Shared by the review handler, which latches
 * the celebration screen before the mutation resolves, and the auto-advance
 * path, which must not let the next card's audio run ahead into it.
 */
export function predictsMilestone(
  dailyReviewsToday: number,
  enabled: boolean,
): boolean {
  const predictedCount = dailyReviewsToday + 1;
  return (
    enabled &&
    predictedCount > 0 &&
    predictedCount % PROGRESS_DISPLAY_INTERVAL === 0
  );
}

/** How long the celebration screen stays before auto-advancing (ms). */
export const PROGRESS_DISPLAY_DURATION_MS = 7000;

/** Path to the celebration success sound (under public/). */
export const PROGRESS_SOUND_URL = '/sounds/progress-success.mp3';
