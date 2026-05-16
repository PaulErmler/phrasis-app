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
