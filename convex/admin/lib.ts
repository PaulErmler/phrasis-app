import { ConvexError } from 'convex/values';
import { QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';

export type AdminContext = { userId: string; email: string };

/**
 * Resolve the caller as an admin, or null. Admins are rows in the `admins`
 * table (managed via admin/manage:setAdmin); BOTH userId and email on the
 * row must match the caller's Better Auth user. The email comes from the
 * component user doc via safeGetAuthUser — identity.email is not
 * guaranteed on the JWT.
 */
export async function getAdminContext(
  ctx: QueryCtx,
): Promise<AdminContext | null> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  const email = user.email.toLowerCase();
  const row = await ctx.db
    .query('admins')
    .withIndex('by_userId', (q) => q.eq('userId', user._id))
    .first();
  if (!row || row.email !== email) return null;
  return { userId: user._id, email };
}

/**
 * Server-side gate for every admin-facing public function. The frontend
 * check (isAdmin query + notFound) is cosmetic only — this throw is the
 * real protection.
 */
export async function requireAdmin(ctx: QueryCtx): Promise<AdminContext> {
  const admin = await getAdminContext(ctx);
  if (!admin) throw new ConvexError('Not authorized');
  return admin;
}
