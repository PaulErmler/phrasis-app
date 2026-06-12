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

/** Gap between the last base-language play and the first (after-base) target-language play */
export const DEFAULT_PAUSE_BASE_TO_TARGET = 5;

/** Gap between the last before-base target-language play and the first base-language play */
export const DEFAULT_PAUSE_TARGET_TO_BASE = DEFAULT_PAUSE_BASE_TO_TARGET;

/** Pause (in seconds) before auto-advancing to the next card after audio finishes */
export const DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE = 2;

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------

/** Whether audio starts automatically when a new card is shown */
export const DEFAULT_AUTO_PLAY = true;

/** Whether the next card is shown automatically after all audio finishes */
export const DEFAULT_AUTO_ADVANCE = true;

/** Whether the target language plays *before* the base language ("Practice Listening") */
export const DEFAULT_PLAY_TARGET_BEFORE_BASE = false;

/** Whether the target language plays *after* the base language ("Practice Speaking") */
export const DEFAULT_PLAY_TARGET_AFTER_BASE = true;

// ---------------------------------------------------------------------------
// Playback speed (pitch-preserved; see lib/audio/timeStretch.ts)
// ---------------------------------------------------------------------------

/** Default playback speed when no per-language setting exists */
export const DEFAULT_PLAYBACK_SPEED = 1.0;

/** General per-language speed range exposed in LearningModeSettings */
export const PLAYBACK_SPEED_MIN = 0.6;
export const PLAYBACK_SPEED_MAX = 2.0;
export const PLAYBACK_SPEED_STEP = 0.1;

/**
 * Persistent cycle used by LearningMode where the override is stored on the
 * card. `null` = "default" state — clears any stored override so the
 * course-level general speed applies.
 */
export const CARD_OVERRIDE_CYCLE = [null, 0.6, 0.7, 0.8, 0.9, 1.0] as const;
export type CardOverrideValue = (typeof CARD_OVERRIDE_CYCLE)[number];

/**
 * Numeric bounds for a stored per-card override (derived from the cycle above,
 * excluding the `null` default slot). Shared by the Convex validator and any
 * client-side clamping.
 */
export const CARD_OVERRIDE_SPEED_MIN = 0.6;
export const CARD_OVERRIDE_SPEED_MAX = 1.0;

/** Advance through CARD_OVERRIDE_CYCLE, wrapping at the end. */
export function nextCardOverrideValue(
  current: number | null,
): CardOverrideValue {
  const idx = CARD_OVERRIDE_CYCLE.findIndex((v) => v === current);
  const nextIdx = (idx + 1) % CARD_OVERRIDE_CYCLE.length;
  return CARD_OVERRIDE_CYCLE[nextIdx];
}

/**
 * Ephemeral cycle used by the Library and word-cloud sentences dialog. Those
 * surfaces don't persist the override and ignore the course-level general
 * speed — the badge is a pure preview control that resets to 1.0 when the
 * view remounts. 1.0 is rendered greyed to signal "no change" (the same way
 * the persistent cycle renders its null default). There is no null slot, so
 * once the user starts cycling they stay inside 0.6–1.0 until unmount.
 */
export const CARD_OVERRIDE_CYCLE_EPHEMERAL = [0.6, 0.7, 0.8, 0.9, 1.0] as const;

export function nextEphemeralCardOverrideValue(current: number | null): number {
  const idx =
    current === null
      ? -1
      : CARD_OVERRIDE_CYCLE_EPHEMERAL.findIndex((v) => v === current);
  const nextIdx = (idx + 1) % CARD_OVERRIDE_CYCLE_EPHEMERAL.length;
  return CARD_OVERRIDE_CYCLE_EPHEMERAL[nextIdx];
}
