import { ConvexError } from "convex/values";
import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { authComponent } from "../auth";
import { Doc } from "../_generated/dataModel";

/**
 * Get the authenticated user from the auth component.
 * Works with query, mutation, and action contexts.
 * Returns null if not authenticated.
 */
export async function getAuthUser(ctx: QueryCtx | MutationCtx | ActionCtx) {
  return authComponent.getAuthUser(ctx);
}

/**
 * Require an authenticated user, throwing if not logged in.
 * Use in mutations and actions that should never run unauthenticated.
 */
export async function requireAuthUser(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const user = await getAuthUser(ctx);
  if (!user) throw new ConvexError("Unauthenticated");
  return user;
}

/**
 * Get user settings by userId.
 */
export async function getUserSettings(
  ctx: QueryCtx,
  userId: string
): Promise<Doc<"userSettings"> | null> {
  return ctx.db
    .query("userSettings")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
}

/**
 * Get or create user settings. Returns the existing settings or creates new ones.
 */
export async function getOrCreateUserSettings(
  ctx: MutationCtx,
  userId: string,
  defaults: Partial<Omit<Doc<"userSettings">, "_id" | "_creationTime" | "userId">>
) {
  const existing = await getUserSettings(ctx, userId);
  if (existing) return existing;

  const id = await ctx.db.insert("userSettings", {
    userId,
    hasCompletedOnboarding: defaults.hasCompletedOnboarding ?? false,
    learningStyle: defaults.learningStyle,
    activeCourseId: defaults.activeCourseId,
  });
  return (await ctx.db.get(id))!;
}

/**
 * Get onboarding progress for a user.
 */
export async function getOnboardingProgress(
  ctx: QueryCtx,
  userId: string
): Promise<Doc<"onboardingProgress"> | null> {
  return ctx.db
    .query("onboardingProgress")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
}

