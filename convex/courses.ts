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
      activeCourseId: v.optional(v.id("courses")),
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
      currentLevel: v.optional(currentLevelValidator),
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
        .take(50);

      return courses;
    } catch {
      return [];
    }
  },
});

/**
 * Get the currently active course for the authenticated user
 */
export const getActiveCourse = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("courses"),
      _creationTime: v.number(),
      userId: v.string(),
      baseLanguages: v.array(v.string()),
      targetLanguages: v.array(v.string()),
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
      
      // Get user settings to find active course ID
      const settings = await ctx.db
        .query("userSettings")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();

      if (!settings?.activeCourseId) {
        // If no active course is set, return the first course
        const firstCourse = await ctx.db
          .query("courses")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first();
        
        return firstCourse;
      }

      // Get the active course
      const activeCourse = await ctx.db.get(settings.activeCourseId);
      return activeCourse;
    } catch {
      return null;
    }
  },
});

/**
 * Set the active course for the authenticated user
 */
export const setActiveCourse = mutation({
  args: {
    courseId: v.id("courses"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const userId = user._id;

    // Verify the course belongs to the user
    const course = await ctx.db.get(args.courseId);
    if (!course) {
      throw new Error("Course not found");
    }
    if (course.userId !== userId) {
      throw new Error("Course does not belong to user");
    }

    // Get or create user settings
    const existingSettings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, {
        activeCourseId: args.courseId,
      });
    } else {
      await ctx.db.insert("userSettings", {
        userId,
        hasCompletedOnboarding: true,
        activeCourseId: args.courseId,
      });
    }

    return null;
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
      });
    } else {
      // Update userSettings with learning preferences
      await ctx.db.patch(existingSettings._id, {
        learningStyle: args.learningStyle,
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
 * Create a new course
 */
export const createCourse = mutation({
  args: {
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
    currentLevel: v.optional(currentLevelValidator),
  },
  returns: v.object({
    courseId: v.id("courses"),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("User must be authenticated to create a course");
    }

    const userId = user._id;

    // Create the course with currentLevel
    const courseId = await ctx.db.insert("courses", {
      baseLanguages: args.baseLanguages,
      targetLanguages: args.targetLanguages,
      currentLevel: args.currentLevel,
      userId,
    });

    return { courseId };
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

    // Create the course with data from onboarding progress
    const courseId = await ctx.db.insert("courses", {
      baseLanguages: progress.baseLanguages || [],
      targetLanguages: progress.targetLanguages || [],
      currentLevel: progress.currentLevel,
      userId,
    });

    let settingsId;
    if (!existingSettings) {
      settingsId = await ctx.db.insert("userSettings", {
        userId,
        hasCompletedOnboarding: true,
        learningStyle: progress.learningStyle,
        activeCourseId: courseId,
      });
    } else {
      // Mark onboarding as complete and set active course
      await ctx.db.patch(existingSettings._id, {
        hasCompletedOnboarding: true,
        learningStyle: progress.learningStyle,
        activeCourseId: courseId,
      });
      settingsId = existingSettings._id;
    }

    // Delete the onboarding progress now that it's been transferred
    await ctx.db.delete(progress._id);

    return { settingsId, courseId };
  },
});
