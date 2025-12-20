import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { 
  learningStyleValidator, 
  currentLevelValidator
} from "./types";

/**
 * Get the current user's settings
 */
export const getUserSettings = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("userSettings"),
      _creationTime: v.number(),
      userId: v.string(),
      hasCompletedOnboarding: v.boolean(),
      learningStyle: v.optional(learningStyleValidator),
      currentLevel: v.optional(currentLevelValidator),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    try {
      const user = await authComponent.getAuthUser(ctx);
      if (!user) {
        return null;
      }

      const userId = user._id;
      const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();

      return settings ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * Quick check if user has completed onboarding
 */
export const hasCompletedOnboarding = query({
  args: {},
  returns: v.union(v.boolean(), v.null()),
  handler: async (ctx) => {
    try {
      const user = await authComponent.getAuthUser(ctx);
      if (!user) {
        return null;
      }

      const userId = user._id;
      const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();

      return settings?.hasCompletedOnboarding ?? false;
    } catch {
      return null;
    }
  },
});

/**
 * Get all courses for the authenticated user
 */
export const getUserCourses = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("courses"),
      _creationTime: v.number(),
      userId: v.string(),
      baseLanguages: v.array(v.string()),
      targetLanguages: v.array(v.string()),
      courseSettingsId: v.optional(v.id("courseSettings")),
    })
  ),
  handler: async (ctx) => {
    try {
      const user = await authComponent.getAuthUser(ctx);
      if (!user) {
        return [];
      }

      const userId = user._id;
      const courses = await ctx.db
        .query("courses")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();

      return courses;
    } catch {
      return [];
    }
  },
});

/**
 * Get the current user's onboarding progress
 */
export const getOnboardingProgress = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("onboardingProgress"),
      _creationTime: v.number(),
      userId: v.string(),
      step: v.number(),
      learningStyle: v.optional(learningStyleValidator),
      currentLevel: v.optional(currentLevelValidator),
      targetLanguages: v.optional(v.array(v.string())),
      baseLanguages: v.optional(v.array(v.string())),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    try {
      const user = await authComponent.getAuthUser(ctx);
      if (!user) {
        return null;
      }

      const userId = user._id;
      const progress = await ctx.db
        .query("onboardingProgress")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();

      return progress ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * Save onboarding progress
 */
export const saveOnboardingProgress = mutation({
  args: {
    step: v.number(),
    learningStyle: v.optional(learningStyleValidator),
    targetLanguages: v.optional(v.array(v.string())),
    currentLevel: v.optional(currentLevelValidator),
    baseLanguages: v.optional(v.array(v.string())),
  },
  returns: v.object({
    _id: v.id("onboardingProgress"),
    _creationTime: v.number(),
    userId: v.string(),
    step: v.number(),
    learningStyle: v.optional(learningStyleValidator),
    currentLevel: v.optional(currentLevelValidator),
    targetLanguages: v.optional(v.array(v.string())),
    baseLanguages: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const userId = user._id;

    // Check if progress already exists
    const existingProgress = await ctx.db
      .query("onboardingProgress")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    let progressId;
    if (existingProgress) {
      await ctx.db.patch(existingProgress._id, args);
      progressId = existingProgress._id;
    } else {
      progressId = await ctx.db.insert("onboardingProgress", {
        userId,
        ...args,
      });
    }

    // Ensure userSettings exists
    const existingSettings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!existingSettings) {
      await ctx.db.insert("userSettings", {
        userId,
        hasCompletedOnboarding: false,
        learningStyle: args.learningStyle,
        currentLevel: args.currentLevel,
      });
    } else {
      // Update userSettings with learning preferences
      await ctx.db.patch(existingSettings._id, {
        learningStyle: args.learningStyle,
        currentLevel: args.currentLevel,
      });
    }

    const progress = await ctx.db.get(progressId);
    if (!progress) {
      throw new Error("Failed to retrieve onboarding progress");
    }
    return progress;
  },
});

/**
 * Create a new course with associated settings
 */
export const createCourse = mutation({
  args: {
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.object({
    courseId: v.id("courses"),
    courseSettingsId: v.id("courseSettings"),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated to create a course");
    }

    const userId = user._id;

    // Create the course first without courseSettingsId
    const courseId = await ctx.db.insert("courses", {
      baseLanguages: args.baseLanguages,
      targetLanguages: args.targetLanguages,
      userId,
    });

    // Create the course settings with the courseId
    const courseSettingsId = await ctx.db.insert("courseSettings", {
      courseId,
    });

    // Update course with courseSettingsId
    await ctx.db.patch(courseId, {
      courseSettingsId,
    });

    return { courseId, courseSettingsId };
  },
});

/**
 * Complete onboarding by creating user settings and first course
 */
export const completeOnboarding = mutation({
  args: {},
  returns: v.object({
    settingsId: v.id("userSettings"),
    courseId: v.id("courses"),
  }),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const userId = user._id;

    // Get onboarding progress
    const progress = await ctx.db
      .query("onboardingProgress")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!progress) {
      throw new Error("Onboarding progress not found");
    }

    // Get or create user settings
    const existingSettings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    let settingsId;
    if (!existingSettings) {
      settingsId = await ctx.db.insert("userSettings", {
        userId,
        hasCompletedOnboarding: true,
        learningStyle: progress.learningStyle,
        currentLevel: progress.currentLevel,
      });
    } else {
      // Mark onboarding as complete
      await ctx.db.patch(existingSettings._id, {
        hasCompletedOnboarding: true,
        learningStyle: progress.learningStyle,
        currentLevel: progress.currentLevel,
      });
      settingsId = existingSettings._id;
    }

    // Create the course with data from onboarding progress
    const courseId = await ctx.db.insert("courses", {
      baseLanguages: progress.baseLanguages || [],
      targetLanguages: progress.targetLanguages || [],
      userId,
    });

    // Create course settings
    const courseSettingsId = await ctx.db.insert("courseSettings", {
      courseId,
    });

    // Update course with courseSettingsId
    await ctx.db.patch(courseId, {
      courseSettingsId,
    });

    // Delete the onboarding progress now that it's been transferred
    await ctx.db.delete(progress._id);

    return { settingsId, courseId };
  },
});
