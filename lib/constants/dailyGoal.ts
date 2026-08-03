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
