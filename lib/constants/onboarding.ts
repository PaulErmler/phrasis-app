/**
 * Threshold at which the embedded onboarding lesson completes. Larger
 * than `ONBOARDING_INITIAL_SEED_CARDS` on purpose. The first 5 are the
 * seeded batch, the next 5 are drawn from whichever cards become due
 * again (audio warm-up + FSRS "Again/Hard") or, if nothing is due, from
 * auto-add (`ONBOARDING_CARDS_BATCH_SIZE`). This gives the user a
 * meaningfully longer first lesson without us having to inflate the
 * upfront seed.
 */
export const ONBOARDING_FIRST_LESSON_CARDS = 10;

/**
 * Number of cards seeded upfront when `completeOnboarding` creates the deck.
 * Matched with `ONBOARDING_FIRST_LESSON_CARDS`. The lesson finishes the
 * moment the seed is exhausted; auto-add and FSRS take over from there.
 */
export const ONBOARDING_INITIAL_SEED_CARDS = 5;

/**
 * Default `cardsToAddBatchSize` written to `courseSettings` for onboarded
 * users. Auto-add fires this many cards at a time when the deck runs dry.
 */
export const ONBOARDING_CARDS_BATCH_SIZE = 5;

/**
 * Hard cap on user-provided free-text answers in onboarding (acquisition
 * "Other" and goal "Other" inputs). Mirrored as a server-side guard in
 * `convex/features/courses.ts` `saveOnboardingProgress`.
 */
export const MAX_ONBOARDING_FREE_TEXT_LENGTH = 200;

/**
 * Surface the character counter once the user has fewer than this many
 * characters remaining. Mirrors the pattern in
 * `components/app/EnterTextsView.tsx` for custom-card text inputs.
 */
export const ONBOARDING_FREE_TEXT_SHOW_COUNT_REMAINING_THRESHOLD = 100;

/**
 * Defensive upper bound on `.take()` calls over `placementTestSentences`.
 * The seed migration caps the corpus at ~100 rows; this leaves headroom
 * while making it audible (via `console.warn` at the call site) if the
 * cap is ever bumped past safe single-query territory.
 */
export const PLACEMENT_SENTENCES_QUERY_CAP = 256;

/**
 * Placement sentences processed per placement-content-sweep transaction
 * (`processPlacementSentences`). Sized well under Convex's per-mutation
 * system-op ceiling: each sentence runs the heavy `scheduleMissingContent`
 * (~15–25 system ops), so the sweep entry point processes one batch inline
 * and fans the remaining batches out as independent scheduled workers instead
 * of sweeping the whole corpus in one transaction.
 * (`COLLECTION_PREVIEW_SIZE` = 5 is known-safe; ≤15 works-but-strained, 10
 * leaves comfortable margin.)
 */
export const PLACEMENT_CONTENT_BATCH_SIZE = 10;

/**
 * Total attempts (initial + retries) for one placement-content batch worker.
 * Convex does NOT retry scheduled mutations that fail with application
 * errors, so `processPlacementContentBatch` reschedules itself on failure,
 * without this, a transient error (e.g. a TTS enqueue hiccup) silently
 * dropped the batch's sentences for the rest of onboarding.
 */
export const PLACEMENT_BATCH_MAX_ATTEMPTS = 3;

/**
 * Base delay for placement-batch retries; attempt N waits
 * `PLACEMENT_BATCH_RETRY_BACKOFF_MS * 2 ** N` (+10s, +20s). Deliberately
 * far past the initial fan-out so retries never re-enter the burst of
 * first-run batches.
 */
export const PLACEMENT_BATCH_RETRY_BACKOFF_MS = 10_000;

/**
 * Cap on (text × language) pairs handled by one `warmupTranslationsBatch`
 * transaction. Each pair costs one indexed translation read plus, when the
 * translation is missing/stale, claim checks and a scheduler enqueue
 * (~2–6 system ops), 100 pairs lands in the same comfortable range as
 * `PLACEMENT_CONTENT_BATCH_SIZE`'s ~250 ops per transaction.
 */
export const WARMUP_TRANSLATIONS_MAX_PAIRS_PER_BATCH = 100;

/** Inclusive bounds of the OGTE difficulty scale (levels L01..L20). */
export const OGTE_MIN_LEVEL = 1;
export const OGTE_MAX_LEVEL = 20;

/**
 * Collection `code` ("L01".."L20") for an OGTE level, or null when the value
 * isn't a valid integer level. Single source of truth for the L%02d format.
 * Used by the server's starting-collection resolution and anywhere else a
 * level must round-trip to a dataset collection code.
 */
export function ogteLevelToCollectionCode(level: number): string | null {
  if (
    !Number.isInteger(level) ||
    level < OGTE_MIN_LEVEL ||
    level > OGTE_MAX_LEVEL
  ) {
    return null;
  }
  return `L${String(level).padStart(2, '0')}`;
}

/**
 * Inverse of `ogteLevelToCollectionCode`: the OGTE level for a collection
 * `code`, or null when the code isn't a dataset level ("L01".."L20", e.g.
 * custom/chat/legacy CEFR collections).
 */
export function collectionCodeToOgteLevel(
  code: string | undefined,
): number | null {
  const match = code ? /^L(\d{2})$/.exec(code) : null;
  if (!match) return null;
  const level = Number(match[1]);
  return level >= OGTE_MIN_LEVEL && level <= OGTE_MAX_LEVEL ? level : null;
}
