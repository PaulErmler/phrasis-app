import { v, ConvexError } from 'convex/values';
import { mutation, query } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { learningStyleValidator, currentLevelValidator, reviewModeValidator } from '../types';
import {
  getAuthUserId,
  requireAuthUserId,
  getUserSettings as dbGetUserSettings,
  getOnboardingProgress as dbGetOnboardingProgress,
} from '../db/users';
import { getCoursesForUser, getActiveCourseForUser } from '../db/courses';
import {
  getCourseSettings as dbGetCourseSettings,
  upsertCourseSettings,
} from '../db/courseSettings';
import {
  getCourseStats as dbGetCourseStats,
  createCourseStats,
} from '../db/courseStats';
import { useQuota, checkQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import {
  DEFAULT_INITIAL_REVIEW_COUNT,
  validateInitialReviewCount,
} from '../../lib/scheduling';
import { LEVEL_TO_COLLECTION } from '../lib/collections';
import { getNextTextsFromRank } from '../db/collections';
import { createCardsFromTexts, updateCollectionProgress } from './decks';

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
      _id: v.id('userSettings'),
      _creationTime: v.number(),
      userId: v.string(),
      hasCompletedOnboarding: v.boolean(),
      learningStyle: v.optional(learningStyleValidator),
      activeCourseId: v.optional(v.id('courses')),
      completedTutorials: v.optional(v.array(v.string())),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;
      return (await dbGetUserSettings(ctx, userId)) ?? null;
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
      _id: v.id('courses'),
      _creationTime: v.number(),
      userId: v.string(),
      baseLanguages: v.array(v.string()),
      targetLanguages: v.array(v.string()),
      currentLevel: v.optional(currentLevelValidator),
    }),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return [];
      return getCoursesForUser(ctx, userId);
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
      _id: v.id('courses'),
      _creationTime: v.number(),
      userId: v.string(),
      baseLanguages: v.array(v.string()),
      targetLanguages: v.array(v.string()),
      currentLevel: v.optional(currentLevelValidator),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;

      const settings = await dbGetUserSettings(ctx, userId);
      if (!settings?.activeCourseId) {
        // If no active course is set, return the first course
        const firstCourse = await ctx.db
          .query('courses')
          .withIndex('by_userId', (q) => q.eq('userId', userId))
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
      _id: v.id('onboardingProgress'),
      _creationTime: v.number(),
      userId: v.string(),
      step: v.number(),
      reviewMode: v.optional(reviewModeValidator),
      currentLevel: v.optional(currentLevelValidator),
      targetLanguages: v.optional(v.array(v.string())),
      baseLanguages: v.optional(v.array(v.string())),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;
      return (await dbGetOnboardingProgress(ctx, userId)) ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * Get stats for the user's active course.
 */
export const getCourseStats = query({
  args: {},
  returns: v.union(
    v.object({
      totalRepetitions: v.number(),
      totalTimeMs: v.number(),
      totalCards: v.number(),
      currentStreak: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;

      const active = await getActiveCourseForUser(ctx, userId);
      if (!active) return null;

      const stats = await dbGetCourseStats(
        ctx,
        userId,
        active.course._id,
      );
      if (!stats) return null;

      return {
        totalRepetitions: stats.totalRepetitions,
        totalTimeMs: stats.totalTimeMs,
        totalCards: stats.totalCards,
        currentStreak: stats.currentStreak,
      };
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
    courseId: v.id('courses'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError('Course not found');
    if (course.userId !== userId)
      throw new ConvexError('Course does not belong to user');

    const existingSettings = await dbGetUserSettings(ctx, userId);
    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, {
        activeCourseId: args.courseId,
      });
    } else {
      await ctx.db.insert('userSettings', {
        userId,
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
    reviewMode: v.optional(reviewModeValidator),
    targetLanguages: v.optional(v.array(v.string())),
    currentLevel: v.optional(currentLevelValidator),
    baseLanguages: v.optional(v.array(v.string())),
  },
  returns: v.object({
    _id: v.id('onboardingProgress'),
    _creationTime: v.number(),
    userId: v.string(),
    step: v.number(),
    reviewMode: v.optional(reviewModeValidator),
    currentLevel: v.optional(currentLevelValidator),
    targetLanguages: v.optional(v.array(v.string())),
    baseLanguages: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const existingProgress = await dbGetOnboardingProgress(ctx, userId);
    let progressId;
    if (existingProgress) {
      await ctx.db.patch(existingProgress._id, args);
      progressId = existingProgress._id;
    } else {
      progressId = await ctx.db.insert('onboardingProgress', {
        userId,
        ...args,
      });
    }

    const existingSettings = await dbGetUserSettings(ctx, userId);
    if (!existingSettings) {
      await ctx.db.insert('userSettings', {
        userId,
        hasCompletedOnboarding: false,
      });
    }

    const progress = await ctx.db.get(progressId);
    if (!progress)
      throw new ConvexError('Failed to retrieve onboarding progress');
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
    courseId: v.id('courses'),
    deckId: v.id('decks'),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    await useQuota(ctx, userId, FEATURE_IDS.COURSES, 1);

    const initialReviewCount =
      args.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;
    validateInitialReviewCount(initialReviewCount);

    const courseId = await ctx.db.insert('courses', {
      baseLanguages: args.baseLanguages,
      targetLanguages: args.targetLanguages,
      currentLevel: args.currentLevel,
      userId,
    });
    await createCourseStats(ctx, userId, courseId);

    let activeCollectionId: Id<'collections'> | undefined;
    if (args.currentLevel) {
      const collectionName =
        LEVEL_TO_COLLECTION[args.currentLevel] ?? 'Essential';
      const collection = await ctx.db
        .query('collections')
        .withIndex('by_name', (q) => q.eq('name', collectionName))
        .first();
      activeCollectionId = collection?._id;
    }

    await upsertCourseSettings(ctx, courseId, {
      initialReviewCount,
      activeCollectionId,
    });

    const deckName = `Learning ${args.targetLanguages.join(', ')}`;
    const deckId = await ctx.db.insert('decks', {
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
    settingsId: v.id('userSettings'),
    courseId: v.id('courses'),
    deckId: v.id('decks'),
  }),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);

    await useQuota(ctx, userId, FEATURE_IDS.COURSES, 1);

    const progress = await dbGetOnboardingProgress(ctx, userId);
    if (!progress) throw new ConvexError('Onboarding progress not found');

    const existingSettings = await dbGetUserSettings(ctx, userId);
    const targetLanguages = progress.targetLanguages || [];
    const baseLanguages = progress.baseLanguages || [];

    const courseId = await ctx.db.insert('courses', {
      baseLanguages,
      targetLanguages,
      currentLevel: progress.currentLevel,
      userId,
    });
    await createCourseStats(ctx, userId, courseId);

    // Map the user's level to a starting collection
    const collectionName =
      LEVEL_TO_COLLECTION[progress.currentLevel ?? 'beginner'] ?? 'Essential';
    const collection = await ctx.db
      .query('collections')
      .withIndex('by_name', (q) => q.eq('name', collectionName))
      .first();

    // Create course settings in a separate table (with preselected collection and review mode)
    await upsertCourseSettings(ctx, courseId, {
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      activeCollectionId: collection?._id,
      reviewMode: progress.reviewMode,
    });

    // Auto-create a deck
    const deckName = `Learning ${targetLanguages.join(', ')}`;
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: deckName,
      cardCount: 0,
    });

    // Auto-add first 5 cards from the selected difficulty collection
    const INITIAL_CARDS = 5;
    if (collection) {
      const textsToAdd = await getNextTextsFromRank(ctx, collection._id, 0, INITIAL_CARDS);

      if (textsToAdd.length > 0) {
        const deck = await ctx.db.get(deckId);
        const course = await ctx.db.get(courseId);
        if (!deck || !course) throw new ConvexError('Failed to load deck or course');

        const { cardsInserted, newLastRank } = await createCardsFromTexts(
          ctx, textsToAdd, deck, collection._id, course,
        );

        if (cardsInserted > 0) {
          await ctx.db.patch(deckId, { cardCount: deck.cardCount + cardsInserted });
        }

        await useQuota(ctx, userId, FEATURE_IDS.SENTENCES, textsToAdd.length);
        await updateCollectionProgress(
          ctx, userId, courseId, collection._id, textsToAdd.length, newLastRank,
        );

        for (const text of textsToAdd) {
          await ctx.scheduler.runAfter(0, internal.features.decks.prepareCardContent, {
            textId: text._id,
            baseLanguages,
            targetLanguages,
          });
        }
      }
    }

    let settingsId;
    if (!existingSettings) {
      settingsId = await ctx.db.insert('userSettings', {
        userId,
        hasCompletedOnboarding: true,
        activeCourseId: courseId,
      });
    } else {
      await ctx.db.patch(existingSettings._id, {
        hasCompletedOnboarding: true,
        activeCourseId: courseId,
      });
      settingsId = existingSettings._id;
    }

    await ctx.db.delete(progress._id);

    return { settingsId, courseId, deckId };
  },
});

/**
 * Update languages for a course. Languages can only be added, never removed.
 */
export const updateCourseLanguages = mutation({
  args: {
    courseId: v.id('courses'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError('Course not found');
    if (course.userId !== userId)
      throw new ConvexError('Course does not belong to user');

    if (args.baseLanguages.length === 0)
      throw new ConvexError('At least one base language is required');
    if (args.targetLanguages.length === 0)
      throw new ConvexError('At least one target language is required');
    if (args.baseLanguages.length > 3)
      throw new ConvexError('Maximum 3 base languages');
    if (args.targetLanguages.length > 3)
      throw new ConvexError('Maximum 3 target languages');
    if (args.baseLanguages.length + args.targetLanguages.length > 5)
      throw new ConvexError('Maximum 5 languages total');

    const existingCodes = new Set([
      ...course.baseLanguages,
      ...course.targetLanguages,
    ]);
    const newCodes = new Set([
      ...args.baseLanguages,
      ...args.targetLanguages,
    ]);
    for (const code of existingCodes) {
      if (!newCodes.has(code)) {
        throw new ConvexError(`Cannot remove existing language: ${code}`);
      }
    }

    await ctx.db.patch(course._id, {
      baseLanguages: args.baseLanguages,
      targetLanguages: args.targetLanguages,
    });

    return null;
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
      _id: v.id('courseSettings'),
      _creationTime: v.number(),
      courseId: v.id('courses'),
      initialReviewCount: v.number(),
      activeCollectionId: v.optional(v.id('collections')),
      cardsToAddBatchSize: v.optional(v.number()),
      autoAddCards: v.optional(v.boolean()),
      // Audio playback settings
      autoPlayAudio: v.optional(v.boolean()),
      autoAdvance: v.optional(v.boolean()),
      languageRepetitions: v.optional(v.record(v.string(), v.number())),
      languageRepetitionPauses: v.optional(v.record(v.string(), v.number())),
      pauseBaseToBase: v.optional(v.number()),
      pauseBaseToTarget: v.optional(v.number()),
      pauseTargetToTarget: v.optional(v.number()),
      pauseBeforeAutoAdvance: v.optional(v.number()),
      showProgressBar: v.optional(v.boolean()),
      hideTargetLanguages: v.optional(v.boolean()),
      autoRevealLanguages: v.optional(v.boolean()),
      baseLanguageOrder: v.optional(v.array(v.string())),
      targetLanguageOrder: v.optional(v.array(v.string())),
      // Review mode
      reviewMode: v.optional(v.union(v.literal('audio'), v.literal('full'))),
      fullReviewTargetAudioMode: v.optional(
        v.union(v.literal('always'), v.literal('afterSubmit'), v.literal('never')),
      ),
      chatCollectionId: v.optional(v.id('collections')),
      activeCustomCollectionIds: v.optional(v.array(v.id('collections'))),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;

      const active = await getActiveCourseForUser(ctx, userId);
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
    courseId: v.id('courses'),
    initialReviewCount: v.optional(v.number()),
    cardsToAddBatchSize: v.optional(v.number()),
    autoAddCards: v.optional(v.boolean()),
    // Audio playback settings
    autoPlayAudio: v.optional(v.boolean()),
    autoAdvance: v.optional(v.boolean()),
    languageRepetitions: v.optional(v.record(v.string(), v.number())),
    languageRepetitionPauses: v.optional(v.record(v.string(), v.number())),
    pauseBaseToBase: v.optional(v.number()),
    pauseBaseToTarget: v.optional(v.number()),
    pauseTargetToTarget: v.optional(v.number()),
    pauseBeforeAutoAdvance: v.optional(v.number()),
    showProgressBar: v.optional(v.boolean()),
    hideTargetLanguages: v.optional(v.boolean()),
    autoRevealLanguages: v.optional(v.boolean()),
    baseLanguageOrder: v.optional(v.array(v.string())),
    targetLanguageOrder: v.optional(v.array(v.string())),
    instantProceedAudio: v.optional(v.boolean()),
    instantProceedFull: v.optional(v.boolean()),
    reviewMode: v.optional(v.union(v.literal('audio'), v.literal('full'))),
    fullReviewTargetAudioMode: v.optional(
      v.union(v.literal('always'), v.literal('afterSubmit'), v.literal('never')),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    if (args.initialReviewCount !== undefined) {
      validateInitialReviewCount(args.initialReviewCount);
    }

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError('Course not found');
    if (course.userId !== userId)
      throw new ConvexError('Course does not belong to user');

    // Build patch object with only provided fields
    const PATCHABLE_KEYS = [
      'initialReviewCount',
      'cardsToAddBatchSize',
      'autoAddCards',
      'autoPlayAudio',
      'autoAdvance',
      'languageRepetitions',
      'languageRepetitionPauses',
      'pauseBaseToBase',
      'pauseBaseToTarget',
      'pauseTargetToTarget',
      'pauseBeforeAutoAdvance',
      'showProgressBar',
      'hideTargetLanguages',
      'autoRevealLanguages',
      'baseLanguageOrder',
      'targetLanguageOrder',
      'instantProceedAudio',
      'instantProceedFull',
      'reviewMode',
      'fullReviewTargetAudioMode',
    ] as const;

    const existing = await dbGetCourseSettings(ctx, args.courseId);
    const patch: Record<string, unknown> = {};
    for (const key of PATCHABLE_KEYS) {
      const value = args[key];
      if (value !== undefined) patch[key] = value;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('courseSettings', {
        courseId: args.courseId,
        initialReviewCount:
          args.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT,
        cardsToAddBatchSize: args.cardsToAddBatchSize,
        autoAddCards: args.autoAddCards,
        autoPlayAudio: args.autoPlayAudio,
        autoAdvance: args.autoAdvance,
        languageRepetitions: args.languageRepetitions,
        languageRepetitionPauses: args.languageRepetitionPauses,
        pauseBaseToBase: args.pauseBaseToBase,
        pauseBaseToTarget: args.pauseBaseToTarget,
        pauseTargetToTarget: args.pauseTargetToTarget,
        pauseBeforeAutoAdvance: args.pauseBeforeAutoAdvance,
        showProgressBar: args.showProgressBar,
        hideTargetLanguages: args.hideTargetLanguages,
        autoRevealLanguages: args.autoRevealLanguages,
        baseLanguageOrder: args.baseLanguageOrder,
        targetLanguageOrder: args.targetLanguageOrder,
        instantProceedAudio: args.instantProceedAudio,
        instantProceedFull: args.instantProceedFull,
        reviewMode: args.reviewMode,
        fullReviewTargetAudioMode: args.fullReviewTargetAudioMode,
      });
    }

    return null;
  },
});

// ============================================================================
// TUTORIALS
// ============================================================================

/**
 * Get completed tutorials for the authenticated user.
 */
export const getCompletedTutorials = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return [];
      const settings = await dbGetUserSettings(ctx, userId);
      return settings?.completedTutorials ?? [];
    } catch {
      return [];
    }
  },
});

/**
 * Mark a tutorial as completed.
 */
export const completeTutorial = mutation({
  args: {
    tutorialId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const settings = await dbGetUserSettings(ctx, userId);
    if (!settings) throw new ConvexError('User settings not found');

    const existing = settings.completedTutorials ?? [];
    if (!existing.includes(args.tutorialId)) {
      await ctx.db.patch(settings._id, {
        completedTutorials: [...existing, args.tutorialId],
      });
    }

    return null;
  },
});

