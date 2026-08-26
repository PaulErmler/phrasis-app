import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { rateLimiter } from '../rateLimiter';
import { SUPPORT_EMAIL } from '../lib/authEmails';
import { withEmailEnvSubject } from '../lib/emailEnv';
import { resend } from '../lib/resendClient';

/**
 * Account deletion works as a REQUEST: the user asks in-app (App Store
 * Guideline 5.1.1(v) requires the flow to start there, with no customer
 * service contact needed from the user's side), support@ gets an automated
 * email, and the account is deleted manually within the promised 30 days.
 */


export const requestAccountDeletion = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    // Each request emails support@ for real. Cap per user so the public
    // mutation can't be scripted into an inbox flood.
    await rateLimiter.limit(ctx, 'accountDeletionRequest', {
      key: user._id,
      throws: true,
    });

    // Durable proof of the request. The operator-run purge
    // (admin/deleteUser.ts) refuses to delete an account without a
    // `requested` row for it, so a mistyped userId on the CLI can't wipe
    // someone who never asked. Repeat requests just refresh the timestamp;
    // a purge already running or completed is left untouched.
    const existing = await ctx.db
      .query('accountDeletions')
      .withIndex('by_userId', (q) => q.eq('userId', user._id))
      .first();
    if (!existing) {
      await ctx.db.insert('accountDeletions', {
        userId: user._id,
        email: user.email.toLowerCase(),
        status: 'requested',
        requestedAt: Date.now(),
      });
    } else if (existing.status === 'requested') {
      await ctx.db.patch(existing._id, { requestedAt: Date.now() });
    }

    await resend.sendEmail(ctx, {
      from: `Flexling <${SUPPORT_EMAIL}>`,
      to: SUPPORT_EMAIL,
      subject: withEmailEnvSubject(
        `Account deletion request: ${user.email}`,
      ),
      text: [
        'A user requested account deletion from the app.',
        '',
        `Email:      ${user.email}`,
        `User id:    ${user._id}`,
        `Name:       ${user.name ?? '—'}`,
        `Requested:  ${new Date(Date.now()).toISOString()}`,
        '',
        'Promised to the user: deletion within 30 days.',
      ].join('\n'),
    });
    return null;
  },
});
