import { ConvexError } from 'convex/values';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { rateLimiter } from '../rateLimiter';
import { resend } from '../lib/resendClient';
import { SUPPORT_EMAIL } from '../lib/authEmails';

/**
 * Account deletion works as a REQUEST: the user asks in-app (App Store
 * Guideline 5.1.1(v) requires the flow to start there, with no customer
 * service contact needed from the user's side), support@ gets an automated
 * email, and the account is deleted manually within the promised 30 days.
 */


export const requestAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) throw new ConvexError('Unauthenticated');

    // Each request emails support@ for real — cap per user so the public
    // mutation can't be scripted into an inbox flood.
    await rateLimiter.limit(ctx, 'accountDeletionRequest', {
      key: user._id,
      throws: true,
    });

    await resend.sendEmail(ctx, {
      from: `Flexling <${SUPPORT_EMAIL}>`,
      to: SUPPORT_EMAIL,
      subject: `Account deletion request: ${user.email}`,
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
  },
});
