/**
 * Threshold at which the embedded onboarding lesson completes. Larger
 * than `ONBOARDING_INITIAL_SEED_CARDS` on purpose — the first 5 are the
 * seeded batch, the next 5 are drawn from whichever cards become due
 * again (audio warm-up + FSRS "Again/Hard") or, if nothing is due, from
 * auto-add (`ONBOARDING_CARDS_BATCH_SIZE`). This gives the user a
 * meaningfully longer first lesson without us having to inflate the
 * upfront seed.
 */
export const ONBOARDING_FIRST_LESSON_CARDS = 10;

/**
 * Number of cards seeded upfront when `completeOnboarding` creates the deck.
 * Matched with `ONBOARDING_FIRST_LESSON_CARDS` — the lesson finishes the
 * moment the seed is exhausted; auto-add and FSRS take over from there.
 */
export const ONBOARDING_INITIAL_SEED_CARDS = 5;

/**
 * Default `cardsToAddBatchSize` written to `courseSettings` for onboarded
 * users — auto-add fires this many cards at a time when the deck runs dry.
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
 * (`COLLECTION_PREVIEW_SIZE` = 5 is known-safe; ≤15 works-but-strained — 10
 * leaves comfortable margin.)
 */
export const PLACEMENT_CONTENT_BATCH_SIZE = 10;

/** Inclusive bounds of the OGTE difficulty scale (levels L01..L20). */
export const OGTE_MIN_LEVEL = 1;
export const OGTE_MAX_LEVEL = 20;

/**
 * Collection `code` ("L01".."L20") for an OGTE level, or null when the value
 * isn't a valid integer level. Single source of truth for the L%02d format —
 * used by the server's starting-collection resolution and anywhere else a
 * level must round-trip to a dataset collection code.
 */
export function ogteLevelToCollectionCode(level: number): string | null {
  if (!Number.isInteger(level) || level < OGTE_MIN_LEVEL || level > OGTE_MAX_LEVEL) {
    return null;
  }
  return `L${String(level).padStart(2, '0')}`;
}
