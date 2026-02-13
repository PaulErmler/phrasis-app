/**
 * Audio playback defaults for the learning mode.
 *
 * These are the single source of truth for default values.
 * They are used both client-side (settings UI, playback logic) and as
 * fallbacks when the courseSettings record has no stored value yet.
 */

// ---------------------------------------------------------------------------
// Repetitions — how many times each language's audio is played per card
// ---------------------------------------------------------------------------

/** Default repetitions for every base language */
export const DEFAULT_REPETITIONS_BASE = 1;

/** Default repetitions for every target language */
export const DEFAULT_REPETITIONS_TARGET = 2;

// ---------------------------------------------------------------------------
// Pauses (in whole seconds, step = 1)
// ---------------------------------------------------------------------------

/** Gap between consecutive repeats of the *same* language (base or target) */
export const DEFAULT_PAUSE_BETWEEN_REPETITIONS = 2;

/** Gap between *different* languages inside the same group (base↔base or target↔target) */
export const DEFAULT_PAUSE_BETWEEN_LANGUAGES = 3;

/** Gap between the last base-language play and the first target-language play */
export const DEFAULT_PAUSE_BASE_TO_TARGET = 5;

/** Pause (in seconds) before auto-advancing to the next card after audio finishes */
export const DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE = 2;

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------

/** Whether audio starts automatically when a new card is shown */
export const DEFAULT_AUTO_PLAY = true;

/** Whether the next card is shown automatically after all audio finishes */
export const DEFAULT_AUTO_ADVANCE = true;
