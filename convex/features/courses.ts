import { v, ConvexError, type Infer } from 'convex/values';
import {
  PLAYBACK_SPEED_MIN,
  PLAYBACK_SPEED_MAX,
  DEFAULT_PLAY_TARGET_BEFORE_BASE,
  DEFAULT_PLAY_TARGET_AFTER_BASE,
} from '../../lib/constants/audioPlayback';
import { mutation, query, MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import {
  learningStyleValidator,
  currentLevelValidator,
  reviewsByModeValidator,
} from '../types';
import { tutorialIdValidator } from './tutorialIds';
import {
  getAuthUserId,
  requireAuthUserId,
  getUserSettings as dbGetUserSettings,
  getOnboardingProgress as dbGetOnboardingProgress,
} from '../db/users';
import {
  getCoursesForUser,
  getActiveCourseForUser,
  getActiveCourseCount,
  getTotalCourseCount,
  getCourseQuotaSnapshot,
  getActiveCourses,
} from '../db/courses';
import {
  getCourseSettings as dbGetCourseSettings,
  upsertCourseSettings,
} from '../db/courseSettings';
import {
  getCourseStats as dbGetCourseStats,
  createCourseStats,
  getTodayInTimezone,
  deriveStreakDisplay,
} from '../db/courseStats';
import { getDailyStats } from '../db/stats/dailyStats';
import { getTargetLanguageWordCounts } from '../db/stats/languageStats';
import { consumeQuota, hasFeatureAccess, releaseQuota } from '../usage/helpers';
import { EVENTS, track } from '../analytics';
import { MAX_COURSES_PER_USER, ARCHIVE_COOLDOWN_MS } from '../../lib/constants/courses';
import { FEATURE_IDS } from './featureIds';
import {
  DEFAULT_INITIAL_REVIEW_COUNT,
  validateInitialReviewCount,
} from '../../lib/scheduling';
import { validateAutoRateThresholds } from '../../lib/autoRating';
import { MAX_CARDS_PER_BATCH } from '../../lib/constants/learning';
import {
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
} from '../../lib/constants/dailyGoal';
import {
  ONBOARDING_INITIAL_SEED_CARDS,
  ONBOARDING_CARDS_BATCH_SIZE,
  MAX_ONBOARDING_FREE_TEXT_LENGTH,
} from '../../lib/constants/onboarding';
import {
  getNextTextsFromRank,
  resolveStartingCollection,
} from '../db/collections';
import { createCardsFromTexts, updateCollectionProgress } from './decks';
import {
  courseSettingsDocValidator,
  coursePatchableSettingsValidator,
  onboardingProgressFields,
  onboardingProgressDocValidator,
} from '../schema';
import { normalizePinnedCardActions } from '../../lib/cardActions';

async function validateLanguageLimits(
  ctx: MutationCtx,
  userId: string,
  baseLanguages: string[],
  targetLanguages: string[],
  // Existing course's saved languages. When provided, the cap on save is
  // raised to max(planMax, existingCount) so a course already over the
  // current plan limit (e.g. carried over from the previous "5 total" Pro
  // cap) stays editable at its current size. Omit for new-course paths.
  existing?: { baseLanguages: string[]; targetLanguages: string[] },
) {
  if (baseLanguages.length === 0)
    throw new ConvexError('At least one base language is required');
  if (targetLanguages.length === 0)
    throw new ConvexError('At least one target language is required');

  const { available: hasMultiLang, synced: multiLangSynced } =
    await hasFeatureAccess(ctx, userId, FEATURE_IDS.MULTIPLE_LANGUAGES);
  if (!multiLangSynced) {
    throw new ConvexError({
      code: 'QUOTA_NOT_SYNCED',
      message: `Quotas not yet synced. Please wait and try again.`,
      featureId: FEATURE_IDS.MULTIPLE_LANGUAGES,
    });
  }
  const planMaxPerGroup = hasMultiLang ? 2 : 1;
  const planMaxTotal = hasMultiLang ? 3 : 2;

  const existingBase = existing?.baseLanguages.length ?? 0;
  const existingTarget = existing?.targetLanguages.length ?? 0;
  const maxPerBase = Math.max(planMaxPerGroup, existingBase);
  const maxPerTarget = Math.max(planMaxPerGroup, existingTarget);
  const maxTotal = Math.max(planMaxTotal, existingBase + existingTarget);

  if (baseLanguages.length > maxPerBase)
    throw new ConvexError({
      code: 'LANGUAGE_LIMIT',
      message: `Maximum ${maxPerBase} base languages allowed`,
      featureId: FEATURE_IDS.MULTIPLE_LANGUAGES,
    });
  if (targetLanguages.length > maxPerTarget)
    throw new ConvexError({
      code: 'LANGUAGE_LIMIT',
      message: `Maximum ${maxPerTarget} target languages allowed`,
      featureId: FEATURE_IDS.MULTIPLE_LANGUAGES,
    });
  if (baseLanguages.length + targetLanguages.length > maxTotal)
    throw new ConvexError({
      code: 'LANGUAGE_LIMIT',
      message: `Maximum ${maxTotal} languages total allowed`,
      featureId: FEATURE_IDS.MULTIPLE_LANGUAGES,
    });
}

/** Independent hard cap safeguard, separate from plan quota accounting. */
async function enforceCourseHardCap(ctx: MutationCtx, userId: string) {
  const totalCount = await getTotalCourseCount(ctx, userId);
  if (totalCount >= MAX_COURSES_PER_USER) {
    throw new ConvexError({
      code: 'HARD_COURSE_LIMIT',
      message: `Maximum of ${MAX_COURSES_PER_USER} courses reached.`,
    });
  }
}

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
      pinnedCardActions: v.optional(v.array(v.string())),
      analyticsConsent: v.optional(v.boolean()),
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
      isArchived: v.optional(v.boolean()),
      archivedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return [];
      const courses = await getCoursesForUser(ctx, userId);
      // Active courses first, archived at the bottom
      return courses.sort((a, b) => {
        const aArchived = a.isArchived === true ? 1 : 0;
        const bArchived = b.isArchived === true ? 1 : 0;
        return aArchived - bArchived;
      });
    } catch {
      return [];
    }
  },
});

/**
 * Course quota info for the UI. `limit` is plan `included`; gating uses
 * tracked `balance` / `unlimited`.
 */
export const getCourseQuotaInfo = query({
  args: {},
  returns: v.object({
    activeCount: v.number(),
    /** Plan cap (Autumn granted). */
    limit: v.number(),
    balance: v.number(),
    unlimited: v.boolean(),
    totalCount: v.number(),
    canCreate: v.boolean(),
    maxCourses: v.number(),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId)
      return {
        activeCount: 0,
        limit: 1,
        balance: 0,
        unlimited: false,
        totalCount: 0,
        canCreate: false,
        maxCourses: MAX_COURSES_PER_USER,
      };

    const [activeCount, totalCount, quota] = await Promise.all([
      getActiveCourseCount(ctx, userId),
      getTotalCourseCount(ctx, userId),
      getCourseQuotaSnapshot(ctx, userId),
    ]);

    if (!quota) {
      return {
        activeCount,
        limit: 1,
        balance: 0,
        unlimited: false,
        totalCount,
        canCreate: false,
        maxCourses: MAX_COURSES_PER_USER,
      };
    }

    return {
      activeCount,
      limit: quota.included,
      balance: quota.balance,
      unlimited: quota.unlimited,
      totalCount,
      canCreate:
        (quota.unlimited || quota.balance > 0) &&
        totalCount < MAX_COURSES_PER_USER,
      maxCourses: MAX_COURSES_PER_USER,
    };
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
      isArchived: v.optional(v.boolean()),
      archivedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;

      const settings = await dbGetUserSettings(ctx, userId);
      if (!settings?.activeCourseId) {
        const courses = await getCoursesForUser(ctx, userId);
        return courses.find((c) => c.isArchived !== true) ?? null;
      }

      const course = await ctx.db.get(settings.activeCourseId);
      if (!course || course.isArchived === true) {
        const courses = await getCoursesForUser(ctx, userId);
        return courses.find((c) => c.isArchived !== true) ?? null;
      }
      return course;
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
  returns: v.union(onboardingProgressDocValidator, v.null()),
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
  args: { timezone: v.string() },
  returns: v.union(
    v.object({
      totalRepetitions: v.number(),
      totalTimeMs: v.number(),
      totalCards: v.number(),
      currentStreak: v.number(),
      streakFreezeCount: v.number(),
      streakFrozenToday: v.boolean(),
      streakState: v.union(
        v.literal('active'),
        v.literal('pending'),
        v.literal('frozen'),
        v.literal('broken'),
        v.literal('none'),
      ),
      totalWordCount: v.optional(v.number()),
      totalChatMessages: v.optional(v.number()),
      totalChatCardsApproved: v.optional(v.number()),
      totalCardsEdited: v.optional(v.number()),
      totalCardsAddedManually: v.optional(v.number()),
      totalReviewsByMode: v.optional(reviewsByModeValidator),
      totalAccuracySum: v.optional(v.number()),
      totalAccuracyCount: v.optional(v.number()),
      // Course language config — exposed so the home view can label the
      // active level with the user's target languages without a second query.
      targetLanguages: v.array(v.string()),
      baseLanguages: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;

      const active = await getActiveCourseForUser(ctx, userId);
      if (!active) return null;

      const stats = await dbGetCourseStats(ctx, userId, active.course._id);
      if (!stats) return null;

      const todayStr = getTodayInTimezone(args.timezone);
      // Re-derive the live streak state at read time — the stored streak goes
      // stale between activities (it's only recomputed when the user studies),
      // so a lapsed streak must show 0 and the frozen/pending states must be
      // computed from lastActivityDate vs today rather than the stored row.
      const derived = deriveStreakDisplay(
        stats.lastActivityDate,
        todayStr,
        stats.currentStreak,
        stats.streakFreezeUsedDate,
      );

      const languageWordCounts = await getTargetLanguageWordCounts(ctx, {
        userId,
        courseId: active.course._id,
        targetLanguages: active.course.targetLanguages,
      });
      const totalWordCount = languageWordCounts.reduce((sum, lw) => sum + lw.words, 0);

      return {
        totalRepetitions: stats.totalRepetitions,
        totalTimeMs: stats.totalTimeMs,
        totalCards: stats.totalCards,
        currentStreak: derived.displayStreak,
        streakFreezeCount: derived.freezeAvailable ? 1 : 0,
        streakFrozenToday: derived.state === 'frozen',
        streakState: derived.state,
        totalWordCount,
        totalChatMessages: stats.totalChatMessages,
        totalChatCardsApproved: stats.totalChatCardsApproved,
        totalCardsEdited: stats.totalCardsEdited,
        totalCardsAddedManually: stats.totalCardsAddedManually,
        totalReviewsByMode: stats.totalReviewsByMode,
        totalAccuracySum: stats.totalAccuracySum,
        totalAccuracyCount: stats.totalAccuracyCount,
        targetLanguages: active.course.targetLanguages,
        baseLanguages: active.course.baseLanguages,
      };
    } catch {
      return null;
    }
  },
});

/**
 * Get today's learning stats for the user's active course.
 */
export const getTodayStats = query({
  args: { timezone: v.string() },
  returns: v.union(
    v.object({
      reps: v.number(),
      newCards: v.number(),
      timeMs: v.number(),
      reviewsByMode: v.optional(reviewsByModeValidator),
      accuracyAvg: v.optional(v.number()),
      chatMessagesSent: v.optional(v.number()),
      chatCardsApproved: v.optional(v.number()),
      cardsEdited: v.optional(v.number()),
      cardsAddedManually: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const todayStr = getTodayInTimezone(args.timezone);
    const daily = await getDailyStats(ctx, userId, active.course._id, todayStr);
    if (!daily) return null;
    return {
      reps: daily.reps,
      newCards: daily.newCards,
      timeMs: daily.timeMs,
      reviewsByMode: daily.reviewsByMode,
      accuracyAvg:
        daily.accuracyCount && daily.accuracyCount > 0
          ? (daily.accuracySum ?? 0) / daily.accuracyCount
          : undefined,
      chatMessagesSent: daily.chatMessagesSent,
      chatCardsApproved: daily.chatCardsApproved,
      cardsEdited: daily.cardsEdited,
      cardsAddedManually: daily.cardsAddedManually,
    };
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
    if (course.isArchived === true)
      throw new ConvexError('Cannot select an archived course');

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
 * Archive a course. Releases an active-course slot.
 */
export const archiveCourse = mutation({
  args: { courseId: v.id('courses') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError('Course not found');
    if (course.userId !== userId)
      throw new ConvexError('Course does not belong to user');
    if (course.isArchived === true)
      throw new ConvexError('Course is already archived');

    await ctx.db.patch(args.courseId, {
      isArchived: true,
      archivedAt: Date.now(),
    });
    await releaseQuota(ctx, userId, FEATURE_IDS.COURSES, 1);

    const settings = await dbGetUserSettings(ctx, userId);
    if (settings?.activeCourseId === args.courseId) {
      const remaining = await getActiveCourses(ctx, userId);
      const next = remaining.find((c) => c._id !== args.courseId);
      await ctx.db.patch(settings._id, {
        activeCourseId: next?._id,
      });
    }

    await track(ctx, userId, EVENTS.COURSE_ARCHIVED, {
      course_id: args.courseId,
    });

    return null;
  },
});

/**
 * Unarchive a course if quota allows.
 *
 * Quota is the gate on every plan. The 30-day archive cooldown only applies to
 * single-course plans (free/basic, course allowance <= 1), where it guards
 * against archive/unarchive churn. Multi-course plans (Pro) skip the cooldown
 * entirely — having a free course slot is enough to reactivate immediately,
 * even right after archiving.
 */
export const unarchiveCourse = mutation({
  args: { courseId: v.id('courses') },
  returns: v.union(
    v.object({ status: v.literal('success') }),
    v.object({
      status: v.literal('cooldown'),
      readyAt: v.number(),
    }),
    v.object({ status: v.literal('usage_limit') }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError('Course not found');
    if (course.userId !== userId)
      throw new ConvexError('Course does not belong to user');
    if (course.isArchived !== true)
      throw new ConvexError('Course is not archived');

    // Cooldown is anti-churn protection only for single-course plans
    // (free/basic). Multi-course plans gate on quota alone, so they can
    // unarchive a recently-archived course immediately if a slot is free.
    const snapshot = await getCourseQuotaSnapshot(ctx, userId);
    const cooldownApplies =
      snapshot !== null && !snapshot.unlimited && snapshot.included <= 1;

    if (cooldownApplies && course.archivedAt) {
      const elapsed = Date.now() - course.archivedAt;
      if (elapsed < ARCHIVE_COOLDOWN_MS) {
        return {
          status: 'cooldown',
          readyAt: course.archivedAt + ARCHIVE_COOLDOWN_MS,
        } as const;
      }
    }

    try {
      await consumeQuota(ctx, userId, FEATURE_IDS.COURSES, 1);
    } catch (error) {
      if (
        error instanceof ConvexError &&
        typeof error.data === 'object' &&
        error.data !== null
      ) {
        const code = (error.data as { code?: string }).code;
        if (code === 'USAGE_LIMIT' || code === 'QUOTA_NOT_SYNCED') {
          return { status: 'usage_limit' } as const;
        }
      }
      throw error;
    }

    await ctx.db.patch(args.courseId, {
      isArchived: undefined,
      archivedAt: undefined,
    });

    // Set activeCourseId if it's missing or points to an archived/deleted course
    const settings = await dbGetUserSettings(ctx, userId);
    if (settings) {
      if (!settings.activeCourseId) {
        await ctx.db.patch(settings._id, { activeCourseId: args.courseId });
      } else {
        const activeCourse = await ctx.db.get(settings.activeCourseId);
        if (!activeCourse || activeCourse.isArchived === true) {
          await ctx.db.patch(settings._id, { activeCourseId: args.courseId });
        }
      }
    }

    return { status: 'success' } as const;
  },
});

/**
 * Save onboarding progress.
 */
// Args for the onboarding-progress mutation, derived from the canonical
// `onboardingProgressFields` in convex/schema.ts (the single point where new
// wizard fields get plumbed through: schema → mutation → page). Omits
// `userId` (derived from auth) and `completedAt` (the wizard can't set it —
// only `finalizeOnboarding` does); `step` stays required.
const saveOnboardingProgressArgs = v
  .object(onboardingProgressFields)
  .omit('userId', 'completedAt');

export const saveOnboardingProgress = mutation({
  args: saveOnboardingProgressArgs.fields,
  // The returned Doc also carries `userId` and `completedAt`, so the
  // validator must accept them. `completedAt` is always undefined on rows
  // reachable by this mutation because `dbGetOnboardingProgress` filters
  // out completed rows.
  returns: onboardingProgressDocValidator,
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    // Server-side length guard for the two free-text answers. The wizard UI
    // also caps these via `maxLength`, but defend at the boundary so a
    // hand-crafted call can't bypass it.
    if (
      args.acquisitionSourceFreeText &&
      args.acquisitionSourceFreeText.length > MAX_ONBOARDING_FREE_TEXT_LENGTH
    ) {
      throw new ConvexError(
        `acquisitionSourceFreeText exceeds ${MAX_ONBOARDING_FREE_TEXT_LENGTH} characters`,
      );
    }
    if (
      args.learningGoalFreeText &&
      args.learningGoalFreeText.length > MAX_ONBOARDING_FREE_TEXT_LENGTH
    ) {
      throw new ConvexError(
        `learningGoalFreeText exceeds ${MAX_ONBOARDING_FREE_TEXT_LENGTH} characters`,
      );
    }

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
    await validateLanguageLimits(ctx, userId, args.baseLanguages, args.targetLanguages);

    const initialReviewCount =
      args.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;
    validateInitialReviewCount(initialReviewCount);

    await enforceCourseHardCap(ctx, userId);
    await consumeQuota(ctx, userId, FEATURE_IDS.COURSES, 1);

    const courseId = await ctx.db.insert('courses', {
      baseLanguages: args.baseLanguages,
      targetLanguages: args.targetLanguages,
      currentLevel: args.currentLevel,
      userId,
    });
    await createCourseStats(ctx, userId, courseId);

    let activeCollectionId: Id<'collections'> | undefined;
    if (args.currentLevel) {
      const collection = await resolveStartingCollection(ctx, args.currentLevel);
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

    // Prep translations + audio for the first 5 sentences of every level
    // collection in this language pair so drilling into any level later is
    // instant. Scheduled (not inline) because the per-collection fan-out
    // can exceed a mutation's wallclock budget on cold caches.
    await ctx.scheduler.runAfter(
      0,
      internal.features.collections.ensureFirstSentencesAcrossLevelCollections,
      {
        baseLanguages: args.baseLanguages,
        targetLanguages: args.targetLanguages,
      },
    );

    await track(ctx, userId, EVENTS.COURSE_CREATED, {
      course_id: courseId,
      base_languages: args.baseLanguages,
      target_languages: args.targetLanguages,
      current_level: args.currentLevel,
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

    const progress = await dbGetOnboardingProgress(ctx, userId);
    const existingSettings = await dbGetUserSettings(ctx, userId);

    // Idempotency: if a course was already created in a prior run of this
    // mutation (page reload mid-flow / back-nav into customizing again),
    // return the existing IDs without consuming the courses quota again.
    if (existingSettings?.activeCourseId) {
      const course = await ctx.db.get(existingSettings.activeCourseId);
      if (course) {
        const deck = await ctx.db
          .query('decks')
          .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
          .first();
        if (deck) {
          return {
            settingsId: existingSettings._id,
            courseId: course._id,
            deckId: deck._id,
          };
        }
      }
    }

    if (!progress) {
      throw new ConvexError('Onboarding progress not found');
    }

    const targetLanguages = progress.targetLanguages || [];
    const baseLanguages = progress.baseLanguages || [];
    await validateLanguageLimits(ctx, userId, baseLanguages, targetLanguages);

    await enforceCourseHardCap(ctx, userId);
    await consumeQuota(ctx, userId, FEATURE_IDS.COURSES, 1);

    const courseId = await ctx.db.insert('courses', {
      baseLanguages,
      targetLanguages,
      currentLevel: progress.currentLevel,
      userId,
    });
    await createCourseStats(ctx, userId, courseId);

    // Map the user's level to a starting collection. The precise OGTE level
    // (slider self-pick / placement-test result) wins when present; the
    // 6-bucket `currentLevel` is the fallback (prefers the active dataset
    // collection by code, falls back to the legacy CEFR row).
    const collection = await resolveStartingCollection(
      ctx,
      progress.currentLevel ?? 'beginner',
      progress.placementTest?.finalLevel,
    );

    // Create course settings in a separate table (with preselected collection and review mode).
    // `autoAddCards: true` is explicit so the default behaviour ships with the
    // new course rather than relying on the legacy `!== false` read-side
    // convention — keeps the underlying flag visible in admin tooling and
    // means future schema changes won't accidentally flip the default off.
    await upsertCourseSettings(ctx, courseId, {
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      activeCollectionId: collection?._id,
      reviewMode: progress.reviewMode,
      autoAddCards: true,
      // Match the onboarding seed batch so the auto-add fired mid-first-lesson
      // pulls the same number of cards the initial seed did. See
      // ONBOARDING_INITIAL_SEED_CARDS / ONBOARDING_FIRST_LESSON_CARDS in
      // lib/constants/onboarding.ts for the rationale.
      cardsToAddBatchSize: ONBOARDING_CARDS_BATCH_SIZE,
      dailyTimeGoalMinutes: progress.dailyTimeGoalMinutes,
    });

    // Auto-create a deck
    const deckName = `Learning ${targetLanguages.join(', ')}`;
    const deckId = await ctx.db.insert('decks', {
      courseId,
      name: deckName,
      cardCount: 0,
    });

    // Seed `ONBOARDING_INITIAL_SEED_CARDS` cards upfront. The first lesson
    // completes at `ONBOARDING_FIRST_LESSON_CARDS` reviews — the gap is
    // filled by the regular auto-add path (`autoAddCards: true` +
    // `cardsToAddBatchSize` set above) firing mid-lesson when the deck
    // empties.
    if (collection) {
      const textsToAdd = await getNextTextsFromRank(ctx, collection._id, 0, ONBOARDING_INITIAL_SEED_CARDS, { onlyCurriculum: true });

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

        await consumeQuota(ctx, userId, FEATURE_IDS.SENTENCES, textsToAdd.length);
        await updateCollectionProgress(
          ctx, userId, courseId, collection._id,
          { addedDelta: cardsInserted, frontierRank: newLastRank },
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

    // Pin the active course on userSettings. The survey answers
    // (acquisition source, learning goals, placement-test history) stay
    // on `onboardingProgress`, which is frozen (not deleted) by
    // `finalizeOnboarding` and serves as the permanent snapshot — they
    // aren't mirrored to `userSettings`. `dailyTimeGoalMinutes` was
    // already written above as a `courseSettings` field (per-course
    // pacing target). `hasCompletedOnboarding` stays whatever it was
    // (only `finalizeOnboarding` is allowed to flip it true, so mid-flow
    // reload/back-nav stays in the wizard).
    const settingsPatch = {
      hasCompletedOnboarding: existingSettings?.hasCompletedOnboarding ?? false,
      activeCourseId: courseId,
    };

    let settingsId;
    if (!existingSettings) {
      settingsId = await ctx.db.insert('userSettings', {
        userId,
        ...settingsPatch,
      });
    } else {
      await ctx.db.patch(existingSettings._id, settingsPatch);
      settingsId = existingSettings._id;
    }

    // Same level-collection content warmup as `createCourse` — see comment there.
    await ctx.scheduler.runAfter(
      0,
      internal.features.collections.ensureFirstSentencesAcrossLevelCollections,
      { baseLanguages, targetLanguages },
    );

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

    await validateLanguageLimits(
      ctx,
      userId,
      args.baseLanguages,
      args.targetLanguages,
      {
        baseLanguages: course.baseLanguages,
        targetLanguages: course.targetLanguages,
      },
    );

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
  returns: v.union(courseSettingsDocValidator, v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;

    return dbGetCourseSettings(ctx, active.course._id);
  },
});

/**
 * Persist the current "between celebrations" session id on `courseSettings`.
 * Called by the learn view (a) once on first mount when the row has none yet
 * to seed it, and (b) on each celebration dismiss to rotate the bucket.
 *
 * Server-side persistence (instead of localStorage) means the bucket survives
 * a fresh page load AND syncs across devices — a milestone earned by reviews
 * done on phone + desktop in the same session counts toward the same
 * `getNewWordsForCelebration` bucket.
 *
 * Idempotent: if `courseSettings` doesn't exist for this user+course yet, we
 * insert a row with the default `initialReviewCount` so the field has a home.
 */
export const setCurrentSessionId = mutation({
  args: {
    courseId: v.id('courses'),
    sessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError('Course not found');
    if (course.userId !== userId) {
      throw new ConvexError('Course does not belong to user');
    }

    const existing = await dbGetCourseSettings(ctx, args.courseId);
    if (existing) {
      await ctx.db.patch(existing._id, { currentSessionId: args.sessionId });
    } else {
      await ctx.db.insert('courseSettings', {
        courseId: args.courseId,
        initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
        currentSessionId: args.sessionId,
      });
    }
    return null;
  },
});

/**
 * Update the initialReviewCount for the user's active course.
 */
// The updatable settings shape (and the mutation's arg/patch key list) is
// derived from the schema's canonical `courseSettingsFields` — see
// `coursePatchableSettingsValidator` in convex/schema.ts.
type CoursePatchableSettings = Infer<typeof coursePatchableSettingsValidator>;

const PATCHABLE_KEYS = Object.keys(
  coursePatchableSettingsValidator.fields,
) as Array<keyof CoursePatchableSettings>;

export const updateCourseSettings = mutation({
  args: {
    courseId: v.id('courses'),
    ...coursePatchableSettingsValidator.fields,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    if (args.initialReviewCount !== undefined) {
      validateInitialReviewCount(args.initialReviewCount);
    }
    if (args.autoRateThresholds !== undefined) {
      validateAutoRateThresholds(args.autoRateThresholds);
    }

    const course = await ctx.db.get(args.courseId);
    if (!course) throw new ConvexError('Course not found');
    if (course.userId !== userId)
      throw new ConvexError('Course does not belong to user');

    // Build patch object with only provided fields
    const existing = await dbGetCourseSettings(ctx, args.courseId);
    const patch: Partial<CoursePatchableSettings> = {};
    for (const key of PATCHABLE_KEYS) {
      let value = args[key];
      // NaN/±Infinity survive Math.max/min/round/floor and Convex stores
      // them as float64 — a NaN goal then poisons the daily-goal ring and
      // every projection until manually repaired. Drop such values instead.
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      if (key === 'cardsToAddBatchSize' && typeof value === 'number') {
        value = Math.max(1, Math.min(MAX_CARDS_PER_BATCH, Math.floor(value)));
      }
      // "Only new" Practice-Listening limit: integer 1-10, or 0 for ∞ (always).
      // Same window for the writing-mode "Show translation on new sentences".
      if (
        (key === 'targetBeforeOnlyNewReps' ||
          key === 'showTranslationOnlyNewReps') &&
        typeof value === 'number'
      ) {
        value = Math.max(0, Math.min(10, Math.floor(value)));
      }
      // "Until rated good" needs at least one good rating — 0 would mean
      // Listening never plays rather than always, so the floor is 1.
      if (key === 'targetBeforeUntilGoodReps' && typeof value === 'number') {
        value = Math.max(1, Math.min(10, Math.floor(value)));
      }
      if (key === 'dailyTimeGoalMinutes' && typeof value === 'number') {
        value = Math.max(
          DAILY_TIME_CUSTOM_MIN,
          Math.min(DAILY_TIME_CUSTOM_MAX, Math.round(value)),
        );
      }
      if (
        (key === 'languagePlaybackSpeeds' ||
          key === 'languagePlaybackSpeedsFull' ||
          key === 'languagePlaybackSpeedsTranscribe' ||
          key === 'transcribeAfterPlaybackSpeeds' ||
          key === 'targetBeforePlaybackSpeeds') &&
        value &&
        typeof value === 'object'
      ) {
        const clamped: Record<string, number> = {};
        for (const [lang, speed] of Object.entries(value as Record<string, number>)) {
          if (typeof speed !== 'number' || !Number.isFinite(speed)) continue;
          clamped[lang] = Math.max(
            PLAYBACK_SPEED_MIN,
            Math.min(PLAYBACK_SPEED_MAX, speed),
          );
        }
        value = clamped;
      }
      // Cast: TS can't correlate `key` with `value` across the loop's union.
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }

    // Safety net for the "at least one target play position" invariant. The UI
    // enforces it (LearningModeSettings auto-enables the other toggle), but a
    // partial write or non-UI caller could otherwise persist both toggles off —
    // which drops all target audio in audio mode. If this write touches the
    // toggles and the resulting pair would be both-false, restore the historical
    // default (Practice Speaking on). Routed into the insert object below too.
    if (
      args.playTargetBeforeBase !== undefined ||
      args.playTargetAfterBase !== undefined
    ) {
      const effectiveBefore =
        args.playTargetBeforeBase ??
        existing?.playTargetBeforeBase ??
        DEFAULT_PLAY_TARGET_BEFORE_BASE;
      const effectiveAfter =
        args.playTargetAfterBase ??
        existing?.playTargetAfterBase ??
        DEFAULT_PLAY_TARGET_AFTER_BASE;
      if (!effectiveBefore && !effectiveAfter) {
        patch.playTargetAfterBase = true;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      // `patch` holds exactly the provided fields, with the loop's clamps and
      // the both-toggles-off guard already applied — so first insert enforces
      // the same ranges/invariants as the patch path. `initialReviewCount` is
      // the one field the table requires, so it gets a default.
      await ctx.db.insert('courseSettings', {
        courseId: args.courseId,
        ...patch,
        initialReviewCount:
          args.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT,
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
    tutorialId: tutorialIdValidator,
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

// ============================================================================
// CARD-ACTION PINS
// ============================================================================

/**
 * Persist the user's pinned card-action order. Server-side
 * `normalizePinnedCardActions` filters to the whitelist, dedupes, and
 * clamps to the maximum count — the client may send anything; storage is
 * always a clean array.
 */
export const updatePinnedCardActions = mutation({
  args: {
    actions: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const normalized = normalizePinnedCardActions(args.actions);
    const settings = await dbGetUserSettings(ctx, userId);
    if (settings) {
      await ctx.db.patch(settings._id, { pinnedCardActions: normalized });
    } else {
      await ctx.db.insert('userSettings', {
        userId,
        hasCompletedOnboarding: false,
        pinnedCardActions: normalized,
      });
    }
    return null;
  },
});

