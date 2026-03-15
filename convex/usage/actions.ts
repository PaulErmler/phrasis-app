"use node";

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { requireAuthUser } from '../db/users';
import { syncQuotasForUser } from './tracking';

/**
 * Full sync of all features from Autumn (single API call).
 */
export const syncQuotas = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    await syncQuotasForUser(ctx, user._id);
    return null;
  },
});

