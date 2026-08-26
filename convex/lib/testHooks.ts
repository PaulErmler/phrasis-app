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
