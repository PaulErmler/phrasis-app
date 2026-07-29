import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { getUserSettings, requireAuthUserId } from '../db/users';

/**
 * Mirror the browser's analytics-consent choice onto the account.
 *
 * The authoritative record lives in PostHog's own storage on the device
 * (see `lib/posthog/consent.ts`); the backend cannot read it, but it needs to
 * know the answer because chat cost events attach the message content as
 * `$ai_input` — and the privacy policy promises that declining stops AI
 * content from reaching PostHog. Synced by `components/analytics/ConsentSync`
 * whenever an authenticated session sees a granted/denied status.
 *
 * Account-scoped where the browser choice is device-scoped: a user who
 * accepts on desktop and declines on mobile ends up with whichever synced
 * last. That imprecision is inherent to mirroring and acceptable — the field
 * only ever *withholds* optional content, never enables device storage.
 */
export const setAnalyticsConsent = mutation({
  args: { granted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const settings = await getUserSettings(ctx, userId);

    if (settings) {
      if (settings.analyticsConsent !== args.granted) {
        await ctx.db.patch(settings._id, { analyticsConsent: args.granted });
      }
      return null;
    }

    // No settings row yet (consent can be answered before onboarding creates
    // one). Only `finalizeOnboarding` may flip `hasCompletedOnboarding` true,
    // so a fresh row starts false — same rule as the course-creation upsert.
    await ctx.db.insert('userSettings', {
      userId,
      hasCompletedOnboarding: false,
      analyticsConsent: args.granted,
    });
    return null;
  },
});
