import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

/**
 * Grant admin access. Run from the Convex dashboard / CLI:
 * `npx convex run admin/manage:setAdmin '{"email": "person@example.com"}'`
 *
 * Resolves the userId from the userProfiles mirror (pass userId explicitly
 * only if the profile doesn't exist yet) and upserts the admins row with
 * both fields — the gate requires both to match.
 */
export const setAdmin = internalMutation({
  args: {
    email: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();

    let resolvedUserId = args.userId;
    if (!resolvedUserId) {
      const profile = await ctx.db
        .query('userProfiles')
        .withIndex('by_email', (q) => q.eq('email', email))
        .first();
      if (!profile) {
        throw new Error(
          `No userProfiles row for "${email}" — check the email, run migrations/backfillUserProfiles, or pass userId explicitly.`,
        );
      }
      resolvedUserId = profile.userId;
    }
    const userId = resolvedUserId;

    const existing = await ctx.db
      .query('admins')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
    let rowId;
    if (existing) {
      await ctx.db.patch(existing._id, { email, userId });
      rowId = existing._id;
    } else {
      rowId = await ctx.db.insert('admins', { email, userId });
    }

    // The gate (getAdminContext) reads admins by_userId and only checks the
    // first row, so a leftover row from a previous email would shadow this
    // one and lock the admin out — drop any other rows for the same user.
    const sameUser = await ctx.db
      .query('admins')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(10);
    for (const row of sameUser) {
      if (row._id !== rowId) await ctx.db.delete(row._id);
    }
    return { email, userId };
  },
});

/**
 * Revoke admin access:
 * `npx convex run admin/manage:removeAdmin '{"email": "person@example.com"}'`
 */
export const removeAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query('admins')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});
