import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { assertTestHooksEnabled } from '../lib/testHooks';

/**
 * E2E test hooks for transactional auth emails (verification + password
 * reset). Gated like usage/testing.ts: every function throws unless the
 * deployment has `E2E_TEST_HOOKS=1` set. Enable it ONLY on dev/test
 * deployments (`pnpm exec convex env set E2E_TEST_HOOKS 1`), never in production.
 *
 * While the flag is set, lib/authEmails.ts CAPTURES outbound auth emails
 * into the `testAuthEmails` table instead of sending real mail; Playwright
 * reads the verification/reset links back via
 * `pnpm exec convex run features/authEmailTesting:latestAuthEmail '<json>'`
 * (see fetchAuthEmail in e2e/helpers.ts).
 */

/**
 * Capture hook for lib/authEmails.ts: the Better Auth send callbacks run
 * in an HTTP action ctx (no direct db access), so the capture write goes
 * through this internal mutation.
 */
export const captureAuthEmail = internalMutation({
  args: {
    email: v.string(),
    kind: v.union(v.literal('verify'), v.literal('reset'), v.literal('welcome')),
    url: v.optional(v.string()),
    otp: v.optional(v.string()),
    subject: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    await ctx.db.insert('testAuthEmails', {
      email: args.email.trim().toLowerCase(),
      kind: args.kind,
      url: args.url,
      otp: args.otp,
      subject: args.subject,
    });
    return null;
  },
});

/**
 * Most recent captured auth email of the given kind for an address, or
 * null. The `id` lets pollers distinguish a fresh email from the previous
 * one (rate-limit assertions compare ids instead of clearing the table).
 */
export const latestAuthEmail = internalQuery({
  args: {
    email: v.string(),
    kind: v.union(v.literal('verify'), v.literal('reset'), v.literal('welcome')),
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id('testAuthEmails'),
      url: v.optional(v.string()),
      otp: v.optional(v.string()),
      subject: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const email = args.email.trim().toLowerCase();
    const doc = await ctx.db
      .query('testAuthEmails')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .filter((q) => q.eq(q.field('kind'), args.kind))
      .first();
    return doc
      ? { id: doc._id, url: doc.url, otp: doc.otp, subject: doc.subject }
      : null;
  },
});
