import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/**
 * The gate every e2e-only backend hook stands behind. Enable
 * `E2E_TEST_HOOKS=1` ONLY on dev/test deployments, never in production —
 * the hooks behind it capture auth emails, rig curriculum flag counters,
 * and bulk-delete fixture accounts.
 *
 * One definition (was copied into authEmailTesting, curriculumFlagTesting,
 * e2eCleanup, and usage/testing) so the guard cannot drift between hook
 * modules.
 */
export function assertTestHooksEnabled(): void {
  if (process.env.E2E_TEST_HOOKS !== '1') {
    throw new Error(
      'E2E test hooks are disabled (set E2E_TEST_HOOKS=1 on a dev deployment)',
    );
  }
}

/**
 * Resolve a user's id from their email via the userProfiles mirror. Shared
 * by the e2e hook modules; throws when no profile row exists. The structural
 * ctx type accepts both QueryCtx and MutationCtx.
 */
export async function requireUserIdByEmail(
  ctx: { db: QueryCtx['db'] },
  rawEmail: string,
): Promise<string> {
  const email = rawEmail.trim().toLowerCase();
  const profile = await ctx.db
    .query('userProfiles')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first();
  if (!profile) throw new Error(`No userProfiles row for "${email}"`);
  return profile.userId;
}

/**
 * The user's active course, resolved from their email. Every hook that acts
 * on "the fixture user's deck" needs this same three-hop lookup (profile →
 * userSettings.activeCourseId → course), and drift between copies is not
 * hypothetical: `curriculumFlagTesting.armProbe` scoped itself to the active
 * course while `userCardCountForText` counted across every course the user
 * owned, so the arm step and its inverse assertion disagreed.
 *
 * Structurally typed on the db handle, like `requireUserIdByEmail`, so
 * queries and mutations share it. Throws rather than returning null: a
 * fixture user with no active course means the setup step failed, and a
 * silent zero would read as a legitimate result.
 */
export async function activeCourseForEmail(
  ctx: { db: QueryCtx['db'] },
  email: string,
): Promise<{ userId: string; course: Doc<'courses'> }> {
  const userId = await requireUserIdByEmail(ctx, email);
  const settings = await ctx.db
    .query('userSettings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
  const courseId = settings?.activeCourseId;
  if (!courseId) throw new Error(`No active course for "${email}"`);
  const course = await ctx.db.get(courseId);
  if (!course) throw new Error(`Active course ${courseId} is missing`);
  return { userId, course };
}
