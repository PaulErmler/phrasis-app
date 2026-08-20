import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { authComponent } from '../auth';
import {
  buildSignupNotification,
  sendAdminNotificationEmail,
} from '../lib/adminEmails';
import { isE2EFixtureAddress } from '../lib/authEmails';
import { getActiveCourseForUser } from '../db/courses';
import { getCourseStats } from '../db/courseStats';

/**
 * Send target of the new-signup admin notification, scheduled by the user
 * onCreate trigger in convex/auth.ts (SIGNUP_NOTIFICATION_DELAY_MS after
 * signup). Delayed on purpose: by then the user has had a chance to finish
 * onboarding, so the email can report their course, how far they got, and
 * their survey answers instead of just an address. Everything is re-read at
 * send time.
 */
export const sendScheduled = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Account deleted in the meantime. The onDelete trigger removes the
    // mirror row, so a missing profile means there is nothing to report.
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    if (!profile) return null;

    // Unlike the welcome email, UNVERIFIED accounts still notify. An
    // abandoned signup is exactly the kind of thing the heads-up is for;
    // the verification state is reported in the body instead.
    const authUser = await authComponent.getAnyUserById(ctx, args.userId);
    if (!authUser) return null;
    // Scheduled ~20min out, so a suite that finishes faster has already
    // removed E2E_TEST_HOOKS and the capture branch inside
    // sendAdminNotificationEmail no longer suppresses these.
    if (isE2EFixtureAddress(authUser.email)) return null;

    // Newest onboarding row: the completed row is the permanent record of
    // the user's answers; an in-progress row tells how far they got.
    const onboarding = await ctx.db
      .query('onboardingProgress')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .order('desc')
      .first();

    const active = await getActiveCourseForUser(ctx, args.userId);
    const stats = active
      ? await getCourseStats(ctx, args.userId, active.course._id)
      : null;

    const { subject, lines } = buildSignupNotification({
      name: authUser.name,
      email: authUser.email,
      emailVerified: authUser.emailVerified === true,
      onboarding,
      course: active?.course ?? null,
      stats,
    });
    await sendAdminNotificationEmail(ctx, { subject, lines });
    return null;
  },
});
