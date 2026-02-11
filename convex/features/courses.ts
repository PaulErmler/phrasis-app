import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { learningStyleValidator, currentLevelValidator } from "../types";
import { getAuthUser, requireAuthUser, getUserSettings as dbGetUserSettings, getOnboardingProgress as dbGetOnboardingProgress } from "../db/users";
import { getCoursesForUser, getActiveCourseForUser } from "../db/courses";
import { getCourseSettings as dbGetCourseSettings, upsertCourseSettings } from "../db/courseSettings";
import { DEFAULT_INITIAL_REVIEW_COUNT } from "../../lib/scheduling";

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get the current user's settings.
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
      const user = await getAuthUser(ctx);
      if (!user) return null;
      return (await dbGetUserSettings(ctx, user._id)) ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * Get all courses for the authenticated user.
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
      const user = await getAuthUser(ctx);
      if (!user) return [];
      return getCoursesForUser(ctx, user._id);
    } catch {
      return [];
    }
  },
});

/**
 * Get the currently active course for the authenticated user.
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
      const user = await getAuthUser(ctx);
      if (!user) return null;

      const settings = await dbGetUserSettings(ctx, user._id);
      if (!settings?.activeCourseId) {
        // If no active course is set, return the first course
        const firstCourse = await ctx.db
          .query("courses")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .first();
        return firstCourse;
      }

      return ctx.db.get(settings.activeCourseId);
    } catch {
      return null;
    }
  },
});

/**
 * Get the current user's onboarding progress.
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
      const user = await getAuthUser(ctx);
      if (!user) return null;
      return (await dbGetOnboardingProgress(ctx, user._id)) ?? null;
    } catch {
      return null;
    }
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Set the active course for the authenticated user.
 */
export const setActiveCourse = mutation({
  args: {
    courseId: v.id("courses"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError("Course not found");
    if (course.userId !== user._id) throw new ConvexError("Course does not belong to user");

    const existingSettings = await dbGetUserSettings(ctx, user._id);
    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, { activeCourseId: args.courseId });
    } else {
      await ctx.db.insert("userSettings", {
        userId: user._id,
        hasCompletedOnboarding: true,
        activeCourseId: args.courseId,
      });
    }

    return null;
  },
});

/**
 * Save onboarding progress.
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
    const user = await requireAuthUser(ctx);

    const userId = user._id;

    // Upsert onboarding progress
    const existingProgress = await dbGetOnboardingProgress(ctx, userId);
    let progressId;
    if (existingProgress) {
      await ctx.db.patch(existingProgress._id, args);
      progressId = existingProgress._id;
    } else {
      progressId = await ctx.db.insert("onboardingProgress", { userId, ...args });
    }

    // Ensure userSettings exists
    const existingSettings = await dbGetUserSettings(ctx, userId);
    if (!existingSettings) {
      await ctx.db.insert("userSettings", {
        userId,
        hasCompletedOnboarding: false,
        learningStyle: args.learningStyle,
      });
    } else {
      await ctx.db.patch(existingSettings._id, { learningStyle: args.learningStyle });
    }

    const progress = await ctx.db.get(progressId);
    if (!progress) throw new ConvexError("Failed to retrieve onboarding progress");
    return progress;
  },
});

/**
 * Create a new course.
 */
export const createCourse = mutation({
  args: {
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
    currentLevel: v.optional(currentLevelValidator),
    initialReviewCount: v.optional(v.number()),
  },
  returns: v.object({
    courseId: v.id("courses"),
    deckId: v.id("decks"),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const courseId = await ctx.db.insert("courses", {
      baseLanguages: args.baseLanguages,
      targetLanguages: args.targetLanguages,
      currentLevel: args.currentLevel,
      userId: user._id,
    });

    // Create course settings in a separate table
    await upsertCourseSettings(ctx, courseId, {
      initialReviewCount: args.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT,
    });

    const deckName = `Learning ${args.targetLanguages.join(", ")}`;
    const deckId = await ctx.db.insert("decks", {
      courseId,
      name: deckName,
      cardCount: 0,
    });

    return { courseId, deckId };
  },
});

/**
 * Complete onboarding by creating user settings and first course.
 */
export const completeOnboarding = mutation({
  args: {},
  returns: v.object({
    settingsId: v.id("userSettings"),
    courseId: v.id("courses"),
    deckId: v.id("decks"),
  }),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);

    const userId = user._id;

    const progress = await dbGetOnboardingProgress(ctx, userId);
    if (!progress) throw new ConvexError("Onboarding progress not found");

    const existingSettings = await dbGetUserSettings(ctx, userId);
    const targetLanguages = progress.targetLanguages || [];

    // Create the course
    const courseId = await ctx.db.insert("courses", {
      baseLanguages: progress.baseLanguages || [],
      targetLanguages,
      currentLevel: progress.currentLevel,
      userId,
    });

    // Create course settings in a separate table
    await upsertCourseSettings(ctx, courseId, {
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
    });

    // Auto-create a deck
    const deckName = `Learning ${targetLanguages.join(", ")}`;
    const deckId = await ctx.db.insert("decks", {
      courseId,
      name: deckName,
      cardCount: 0,
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
      await ctx.db.patch(existingSettings._id, {
        hasCompletedOnboarding: true,
        learningStyle: progress.learningStyle,
        activeCourseId: courseId,
      });
      settingsId = existingSettings._id;
    }

    // Delete the onboarding progress
    await ctx.db.delete(progress._id);

    return { settingsId, courseId, deckId };
  },
});

// ============================================================================
// COURSE SETTINGS
// ============================================================================

/**
 * Get the settings for the active course.
 */
export const getActiveCourseSettings = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("courseSettings"),
      _creationTime: v.number(),
      courseId: v.id("courses"),
      initialReviewCount: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    try {
      const user = await getAuthUser(ctx);
      if (!user) return null;

      const active = await getActiveCourseForUser(ctx, user._id);
      if (!active) return null;

      return dbGetCourseSettings(ctx, active.course._id);
    } catch {
      return null;
    }
  },
});

/**
 * Update the initialReviewCount for the user's active course.
 */
export const updateCourseSettings = mutation({
  args: {
    courseId: v.id("courses"),
    initialReviewCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError("Course not found");
    if (course.userId !== user._id) throw new ConvexError("Course does not belong to user");

    await upsertCourseSettings(ctx, args.courseId, {
      initialReviewCount: args.initialReviewCount,
    });

    return null;
  },
});

