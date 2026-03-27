import { mutation } from './_generated/server';
import { v } from 'convex/values';

/** Debug: `layout` = app/app/layout RSC; `authBoundary` = ClientAuthBoundary onUnauth (Convex dashboard logs). */
export const logAuthRedirect = mutation({
  args: {
    source: v.union(v.literal('layout'), v.literal('authBoundary')),
  },
  handler: async (_ctx, args) => {
    console.log('[auth-redirect]', { source: args.source, ts: Date.now() });
  },
});
