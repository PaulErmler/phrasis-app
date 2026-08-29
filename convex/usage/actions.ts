'use node';

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { requireAuthUserId } from '../db/users';
import { syncQuotasForUser } from './tracking';

/**
 * Full sync of all features from Autumn (single API call).
 */
export const syncQuotas = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const quotaUserId = await requireAuthUserId(ctx);
    await syncQuotasForUser(ctx, quotaUserId);
    return null;
  },
});
