import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { authComponent } from '../auth';
import { sendWelcomeEmail } from '../lib/welcomeEmail';

/**
 * Send target of the welcome email scheduled by the user onCreate trigger
 * in convex/auth.ts (WELCOME_EMAIL_DELAY_MS after signup). Everything about
 * the user is re-read here — a lot can happen in a day.
 */
export const sendScheduled = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Account deleted in the meantime — the onDelete trigger removes the
    // mirror row, so a missing profile means don't email.
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    if (!profile) return null;

    // onCreate fires before email verification; unverified accounts can't
    // sign in and are effectively abandoned signups — never welcome those.
    // OAuth users (Google/Apple) are verified at creation. Email + name come
    // from the auth user, not the trigger-time args, in case they changed.
    const authUser = await authComponent.getAnyUserById(ctx, args.userId);
    if (!authUser || !authUser.emailVerified) return null;

    await sendWelcomeEmail(ctx, { to: authUser.email, name: authUser.name });
    return null;
  },
});
