import { MutationCtx } from '../_generated/server';

/**
 * Shape of the Better Auth component `user` document as delivered to the
 * user triggers in convex/auth.ts (see the component schema in
 * @convex-dev/better-auth). Only the fields mirrored into `userProfiles`.
 */
export type AuthUserDoc = {
  _id: string;
  name: string;
  email: string;
  image?: string | null;
  createdAt: number;
};

/**
 * Upsert the app-owned mirror row for a Better Auth user. Called from the
 * user onCreate/onUpdate triggers and the backfill migration, so it must be
 * idempotent.
 */
export async function upsertUserProfile(
  ctx: MutationCtx,
  user: AuthUserDoc,
): Promise<void> {
  const email = user.email.toLowerCase();
  const profile = {
    userId: user._id,
    email,
    name: user.name,
    image: user.image ?? undefined,
    createdAt: user.createdAt,
    searchText: `${email} ${user.name.toLowerCase()}`,
  };
  const existing = await ctx.db
    .query('userProfiles')
    .withIndex('by_userId', (q) => q.eq('userId', user._id))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, profile);
  } else {
    await ctx.db.insert('userProfiles', profile);
  }
}

export async function deleteUserProfile(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const existing = await ctx.db
    .query('userProfiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}
