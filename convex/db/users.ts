import { ConvexError } from 'convex/values';
import { QueryCtx, MutationCtx, ActionCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';

type UserSettingsInsert = Omit<Doc<'userSettings'>, '_id' | '_creationTime'>;

/**
 * Get the authenticated user ID from the JWT (no session validation).
 * Use when you only need the user ID for filtering - avoids cross-component DB queries.
 * Returns null if not authenticated.
 */
export async function getAuthUserId(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return identity.subject;
}

/**
 * Require an authenticated user ID, throwing if not logged in.
 */
export async function requireAuthUserId(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError('Unauthenticated');
  return userId;
}

/**
 * Get user settings by userId.
 */
export async function getUserSettings(
  ctx: QueryCtx,
  userId: string,
): Promise<Doc<'userSettings'> | null> {
  return ctx.db
    .query('userSettings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
}

/**
 * Insert a new `userSettings` row. `hideDueCounts` / `hideWorkloadForecast`
 * are deliberately NOT seeded: unset means hidden (readers show only on an
 * explicit `false`), so the off-by-default rule lives in one place.
 * Existing rows are never backfilled — patch them in place instead.
 */
export async function insertUserSettings(
  ctx: MutationCtx,
  fields: UserSettingsInsert,
): Promise<Id<'userSettings'>> {
  return ctx.db.insert('userSettings', fields);
}

/**
 * Get the user's *active* onboarding progress row (i.e. an in-flight
 * onboarding that hasn't been finalized yet). Returns null once
 * `finalizeOnboarding` has stamped `completedAt` on the row. Completed
 * rows are the permanent snapshot of the user's answers and must not be
 * mutated by the wizard.
 *
 * All in-app reads of `onboardingProgress` must funnel through here so
 * the active/frozen distinction stays the responsibility of one
 * function. JS-side check (rather than a `.filter()` clause) per the
 * Convex query guideline against `filter` on non-indexed fields.
 */
export async function getOnboardingProgress(
  ctx: QueryCtx,
  userId: string,
): Promise<Doc<'onboardingProgress'> | null> {
  const row = await ctx.db
    .query('onboardingProgress')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
  return row && row.completedAt === undefined ? row : null;
}
