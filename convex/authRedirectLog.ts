import { mutation } from './_generated/server';
import { v } from 'convex/values';

export const logAuthRedirect = mutation({
  args: {
    source: v.union(v.literal('layout'), v.literal('authBoundary')),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    console.warn('[AUTH_REDIRECT]', {
      source: args.source,
      details: args.details,
      hasIdentity: !!identity,
      identitySubject: identity?.subject ?? null,
      timestamp: new Date().toISOString(),
    });
  },
});
