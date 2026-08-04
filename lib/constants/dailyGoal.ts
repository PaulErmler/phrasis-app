/**
 * Daily study-time goal bounds and preset tiles. Shared between the
 * onboarding wizard, the in-app goal editors (settings row, homescreen
 * quick-edit), and the Convex-side clamp in `updateCourseSettings` —
 * Convex code cannot import from `app/`, so these live in `lib/`.
 */
export const DAILY_TIME_PRESETS = [5, 10, 20, 30, 60] as const;
export const DAILY_TIME_CUSTOM_MIN = 1;
export const DAILY_TIME_CUSTOM_MAX = 120;

/**
 * Parse a custom-goal input value; null when empty/invalid/out of bounds.
 * Single source of the validation shared by the onboarding goal step and
 * the homescreen quick-edit so the two can't drift.
 */
export function parseCustomGoal(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) &&
    parsed >= DAILY_TIME_CUSTOM_MIN &&
    parsed <= DAILY_TIME_CUSTOM_MAX
    ? parsed
    : null;
}

/**
 * Clamp a stored goal into the valid window, or `undefined` when there is
 * nothing storable. NaN/±Infinity survive Math.max/min/round and Convex
 * persists them as float64, where a poisoned goal breaks the homescreen ring
 * and every projection until repaired by hand — so non-finite values are
 * dropped rather than clamped.
 *
 * Single source of the server-side clamp, shared by every path that writes
 * `dailyTimeGoalMinutes`: `updateCourseSettings`, `saveOnboardingProgress`,
 * and the `completeOnboarding` copy from the wizard row onto the course.
 */
export function clampDailyGoal(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(
    DAILY_TIME_CUSTOM_MIN,
    Math.min(DAILY_TIME_CUSTOM_MAX, Math.round(value)),
  );
}
