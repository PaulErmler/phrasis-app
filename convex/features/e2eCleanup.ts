import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { isE2EFixtureAddress } from '../lib/authEmails';
import { assertTestHooksEnabled } from '../lib/testHooks';
import { autumnFetchRaw } from '../usage/autumnClient';

/**
 * Bulk removal of Playwright fixture accounts.
 *
 * Every e2e run signs up throwaway users (`e2e-<prefix>-<ts>-<hex>@flexling.com`
 * — see `generateCredentials` in e2e/auth.setup.ts and `signUpFreshUser` in
 * e2e/helpers.ts) and, until this module existed, never removed them. They
 * accumulate on the shared dev deployment: each one is handed the same shared
 * curriculum texts, so the per-text card count grows without bound and the
 * `.take(...)` limits in the other test hooks eventually truncate past the
 * user's own row. That is not hypothetical — it broke
 * `userCardCountForText` (features/curriculumFlagTesting.ts) once ~360 users
 * had piled up on the local dev deployment.
 *
 * The purge itself is the real operator path (`admin/deleteUser:run` with
 * `overrideNoRequest`, recorded on the audit row), not a shortcut: fixture
 * users are exercised by the same code that deletes a real account.
 *
 * Every function throws unless the deployment has `E2E_TEST_HOOKS=1`. Enable
 * it ONLY on dev/test deployments, never in production — this deletes
 * accounts in bulk and the address filter is the only thing standing between
 * it and real users.
 *
 * Driven from e2e/global-teardown.ts, and runnable by hand:
 *   pnpm exec convex run features/e2eCleanup:purgeFixtureUsers '{"dryRun":true}'
 */

/** Scan ceiling for one pass over userProfiles. */
const SCAN_LIMIT = 4096;
/** Accounts purged per action invocation; the caller loops until dry. */
const DEFAULT_BATCH = 8;

type FixtureUser = { userId: string; email: string };

type ListResult = {
  users: FixtureUser[];
  matched: number;
  scanTruncated: boolean;
};

type PurgeResult = {
  purged: string[];
  failed: { email: string; error: string }[];
  remaining: number;
  auditRowsDeleted: number;
  scanTruncated: boolean;
};

/**
 * Fixture accounts still on the deployment, oldest signup first.
 *
 * Enumerated from `userProfiles` because that row carries both halves of the
 * pair `admin/deleteUser:run` needs (Better Auth user id + email) and is the
 * same lookup the other test hooks use. `matched` counts every fixture row the
 * scan saw, so the caller knows how much is left without a second query.
 */
export const listFixtureUsers = internalQuery({
  args: {
    limit: v.optional(v.number()),
    // Accounts the caller has given up on this sweep (they refused to purge).
    // Explicit exclusion rather than an offset: an offset presumed the scan
    // order stable across calls and failed rows compacted to the head, which
    // nothing enforced — a changed ordering would silently skip purgeable
    // accounts while retrying wedged ones.
    excludeEmails: v.optional(v.array(v.string())),
  },
  returns: v.object({
    users: v.array(v.object({ userId: v.string(), email: v.string() })),
    matched: v.number(),
    scanTruncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_BATCH, 64));
    const excluded = new Set(args.excludeEmails ?? []);

    const profiles = await ctx.db
      .query('userProfiles')
      .withIndex('by_createdAt')
      .take(SCAN_LIMIT);

    const users: FixtureUser[] = [];
    let matched = 0;
    for (const profile of profiles) {
      if (!isE2EFixtureAddress(profile.email)) continue;
      // `matched` counts excluded fixtures too: it reports what is ON the
      // deployment, and the caller compares it against its own exclusion
      // list to decide when the sweep is done.
      matched += 1;
      if (excluded.has(profile.email)) continue;
      if (users.length < limit) {
        users.push({ userId: profile.userId, email: profile.email });
      }
    }

    return {
      users,
      matched,
      scanTruncated: profiles.length >= SCAN_LIMIT,
    };
  },
});

/**
 * Drop the audit rows the purge leaves behind for fixture addresses.
 *
 * `admin/deleteUser.ts` deliberately keeps a `completed` accountDeletions row
 * per purge: for a real account that row is the record that the deletion
 * happened, which is the point. For a throwaway Playwright account it is just
 * the next table to grow without bound — one row per fixture user per run,
 * the same leak the account purge above exists to stop.
 *
 * Only `completed` rows go. A `requested` or `running` row belongs to a purge
 * that has not finished, and deleting it would strand the run mid-way.
 */
export const purgeFixtureAuditRows = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), remaining: v.number() }),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const limit = Math.max(1, Math.min(args.limit ?? 256, 1024));

    const rows = await ctx.db.query('accountDeletions').take(SCAN_LIMIT);

    let deleted = 0;
    let matched = 0;
    for (const row of rows) {
      if (row.status !== 'completed') continue;
      if (!isE2EFixtureAddress(row.email)) continue;
      matched += 1;
      if (deleted < limit) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    return { deleted, remaining: matched - deleted };
  },
});

/**
 * Remove a fixture account's Autumn customer, taking its Stripe customer with
 * it, before the real purge runs.
 *
 * `deleteBillingCustomer` in admin/deleteUser.ts cancels each live plan with
 * `cancel_immediately: true` first, and Stripe rejects that for a Managed
 * Payments subscription ("Invoices cannot be created for Subscriptions with
 * Managed Payments enabled"). Since it runs before any app data is touched,
 * the whole purge throws and the account survives — which is exactly what
 * stalled the first bulk sweep of this deployment on its billing fixtures.
 *
 * Deleting the customer outright sidesteps the cancel: Stripe cancels the
 * subscriptions it owns when the customer goes, and `run` then sees a 404 and
 * skips its billing phase entirely. That is the right teardown for a test
 * fixture regardless — but note it does NOT fix deleting a real paying
 * account, which still hits the same wall in admin/deleteUser.ts.
 *
 * Best-effort: billing state must never block removing test data.
 */
async function deleteAutumnCustomer(
  customerId: string,
): Promise<'deleted' | 'absent' | 'failed'> {
  try {
    const res = await autumnFetchRaw(
      'DELETE',
      `/customers/${encodeURIComponent(customerId)}?delete_in_stripe=true`,
      undefined,
      '1.2',
    );
    if (res.status === 404) return 'absent';
    return res.ok ? 'deleted' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Purge one batch of fixture accounts and report what is left.
 *
 * Bounded per call because each account is a full multi-phase purge plus
 * Autumn/Stripe teardown; the caller re-invokes while `remaining > 0`. A
 * single account that refuses to purge is collected into `failed` rather than
 * aborting the sweep — one wedged fixture must not strand the rest.
 */
export const purgeFixtureUsers = internalAction({
  args: {
    limit: v.optional(v.number()),
    // See listFixtureUsers: accounts a previous pass failed to purge.
    excludeEmails: v.optional(v.array(v.string())),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    purged: v.array(v.string()),
    failed: v.array(v.object({ email: v.string(), error: v.string() })),
    remaining: v.number(),
    auditRowsDeleted: v.number(),
    scanTruncated: v.boolean(),
  }),
  handler: async (ctx, args): Promise<PurgeResult> => {
    assertTestHooksEnabled();

    // Annotated because this action names its own module through `internal`,
    // which TypeScript cannot resolve while still inferring it.
    const batch: ListResult = await ctx.runQuery(
      internal.features.e2eCleanup.listFixtureUsers,
      { limit: args.limit, excludeEmails: args.excludeEmails },
    );

    if (args.dryRun) {
      return {
        purged: batch.users.map((user) => user.email),
        failed: [],
        remaining: batch.matched,
        auditRowsDeleted: 0,
        scanTruncated: batch.scanTruncated,
      };
    }

    const purged: string[] = [];
    const failed: { email: string; error: string }[] = [];

    for (const user of batch.users) {
      try {
        await deleteAutumnCustomer(user.userId);
        await ctx.runAction(internal.admin.deleteUser.run, {
          userId: user.userId,
          email: user.email,
          overrideNoRequest: true,
        });
        purged.push(user.email);
      } catch (error) {
        failed.push({
          email: user.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // After the accounts, not before: a row is only collectable once its
    // purge has reached `completed`.
    const audit: { deleted: number; remaining: number } = await ctx.runMutation(
      internal.features.e2eCleanup.purgeFixtureAuditRows,
      {},
    );

    return {
      purged,
      failed,
      auditRowsDeleted: audit.deleted,
      // Everything the scan matched, less what this call actually removed.
      // Failures stay in the count so a caller looping on `remaining > 0`
      // does not spin forever on them: it also watches `failed`.
      remaining: batch.matched - purged.length,
      scanTruncated: batch.scanTruncated,
    };
  },
});
