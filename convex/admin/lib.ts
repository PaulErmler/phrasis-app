import {
  ConvexError,
  type Infer,
  type ObjectType,
  type PropertyValidators,
  type Validator,
} from 'convex/values';
import { query, QueryCtx } from '../_generated/server';
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

/**
 * Query builder for admin endpoints: registers a public query whose handler
 * only runs after `requireAdmin` passes. Every data-exposing function in
 * convex/admin/ MUST be declared with this instead of `query` — the gate is
 * then structural rather than a first-line call each handler has to
 * remember. The resolved AdminContext is passed as the handler's third
 * argument. (`isAdmin` stays a plain query on purpose: it returns only a
 * boolean and must not throw for regular users.)
 */
export function adminQuery<
  ArgsValidator extends PropertyValidators,
  ReturnsValidator extends Validator<unknown, 'required', string>,
>(def: {
  args: ArgsValidator;
  returns: ReturnsValidator;
  handler: (
    ctx: QueryCtx,
    args: ObjectType<ArgsValidator>,
    admin: AdminContext,
  ) => Promise<Infer<ReturnsValidator>>;
}) {
  return query({
    args: def.args,
    returns: def.returns,
    handler: async (ctx: QueryCtx, args: ObjectType<ArgsValidator>) => {
      const admin = await requireAdmin(ctx);
      return def.handler(ctx, args, admin);
    },
  });
}
