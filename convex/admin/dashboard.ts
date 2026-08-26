import { v } from 'convex/values';
import { query } from '../_generated/server';
import { adminQuery, getAdminContext } from './lib';
import { authComponent } from '../auth';
import { deriveStreakDisplay } from '../db/courseStats';
import { getPreviousDay, resolveClientNow } from '../lib/dateUtils';
import { dateInTimezone, daysBetween } from '../../lib/dateStrings';
import { featureStateValidator } from '../usage/helpers';

// Bounded-read caps. Convex hard-fails any query execution that scans more
// than 16,384 documents, so each query below must keep its worst case under
// that. The biggest is listUsers at 3 × MAX_SCAN + 200 × 20 = 16,000. When
// these caps start clipping real data, the upgrade path is denormalized
// counters or @convex-dev/aggregate (already installed for cards).
const MAX_SCAN = 4000;

const streakValidator = v.object({
  displayStreak: v.number(),
  state: v.string(),
});

type ActivitySummary = {
  streak: { displayStreak: number; state: string };
  lastActivityDate?: string;
};

/**
 * Fold all courseStats rows into a per-user summary: best (highest) live
 * streak across the user's courses plus the most recent activity date.
 * The stored streak goes stale between activities, so each row is
 * re-derived for "today" in its own timezone.
 */
function summarizeCourseStats(
  rows: Array<{
    userId: string;
    currentStreak: number;
    lastActivityDate?: string;
    timezone?: string;
    streakFreezeUsedDate?: string;
  }>,
  now: number,
): Map<string, ActivitySummary> {
  const byUser = new Map<string, ActivitySummary>();
  for (const stats of rows) {
    const summary = byUser.get(stats.userId) ?? {
      streak: { displayStreak: 0, state: 'none' },
    };
    const derived = deriveStreakDisplay(
      stats.lastActivityDate,
      dateInTimezone(now, stats.timezone ?? 'UTC'),
      stats.currentStreak,
      stats.streakFreezeUsedDate,
    );
    if (
      derived.state !== 'none' &&
      derived.displayStreak >= summary.streak.displayStreak
    ) {
      summary.streak = { displayStreak: derived.displayStreak, state: derived.state };
    }
    if (
      stats.lastActivityDate &&
      (!summary.lastActivityDate ||
        stats.lastActivityDate > summary.lastActivityDate)
    ) {
      summary.lastActivityDate = stats.lastActivityDate;
    }
    byUser.set(stats.userId, summary);
  }
  return byUser;
}

/**
 * Frontend gate for the /app/admin routes. Never throws. Non-admins just
 * get `false`. Real protection is the `adminQuery` builder every data
 * query is registered through.
 */
export const isAdmin = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return (await getAdminContext(ctx)) !== null;
  },
});

/**
 * Daily active users over the trailing `days` window (a user is active on
 * a day if they have a dailyStats row, i.e. recorded learning activity).
 * Dates are the users' local calendar days as written by the stats
 * pipeline. Also sums review volume and study time per day for free.
 */
export const getDauSeries = adminQuery({
  // `now` per the no-wall-clock query guideline; optional for back-compat
  // (absent → server clock). See resolveClientNow.
  args: { days: v.number(), now: v.optional(v.number()) },
  returns: v.array(
    v.object({
      date: v.string(),
      activeUsers: v.number(),
      totalReps: v.number(),
      totalTimeMs: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const days = Math.max(1, Math.min(120, Math.floor(args.days)));
    // Split a fixed read budget across the window so days × cap stays under
    // the 16,384-doc scan limit (30d → 400 rows/day, 120d → 100 rows/day).
    const perDayCap = Math.floor(12000 / days);

    const dates: string[] = [];
    let d = dateInTimezone(resolveClientNow(args.now), 'UTC');
    for (let i = 0; i < days; i++) {
      dates.push(d);
      d = getPreviousDay(d);
    }
    dates.reverse();

    const series = [];
    for (const date of dates) {
      const rows = await ctx.db
        .query('dailyStats')
        .withIndex('by_date', (q) => q.eq('date', date))
        .take(perDayCap);
      const userIds = new Set<string>();
      let totalReps = 0;
      let totalTimeMs = 0;
      for (const row of rows) {
        userIds.add(row.userId);
        totalReps += row.reps;
        totalTimeMs += row.timeMs;
      }
      series.push({ date, activeUsers: userIds.size, totalReps, totalTimeMs });
    }
    return series;
  },
});

/**
 * New-user registrations per day over the trailing `days` window (UTC
 * bucketing of Better Auth signup timestamps), plus the total user count.
 */
export const getSignupSeries = adminQuery({
  // `now` per the no-wall-clock query guideline; optional for back-compat
  // (absent → server clock). See resolveClientNow.
  args: { days: v.number(), now: v.optional(v.number()) },
  returns: v.object({
    totalUsers: v.number(),
    series: v.array(v.object({ date: v.string(), signups: v.number() })),
  }),
  handler: async (ctx, args) => {
    const days = Math.max(1, Math.min(120, Math.floor(args.days)));
    const now = resolveClientNow(args.now);
    const cutoff = now - days * 24 * 60 * 60 * 1000;

    const recent = await ctx.db
      .query('userProfiles')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', cutoff))
      .take(MAX_SCAN);
    const counts = new Map<string, number>();
    for (const profile of recent) {
      const date = new Date(profile.createdAt).toISOString().slice(0, 10);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }

    const series = [];
    let d = dateInTimezone(now, 'UTC');
    for (let i = 0; i < days; i++) {
      series.push({ date: d, signups: counts.get(d) ?? 0 });
      d = getPreviousDay(d);
    }
    series.reverse();

    const totalUsers = (await ctx.db.query('userProfiles').take(MAX_SCAN * 2))
      .length;
    return { totalUsers, series };
  },
});

/**
 * How many users are currently on each plan, from the local Autumn mirror.
 * Users whose quota doc predates plan capture (or who have no attached
 * product) fall into the 'unknown' bucket until their next quota sync.
 */
export const getPlanDistribution = adminQuery({
  args: {},
  returns: v.object({
    totalWithQuotas: v.number(),
    plans: v.array(
      v.object({
        planId: v.string(),
        planName: v.string(),
        count: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const docs = await ctx.db.query('usageQuotas').take(MAX_SCAN);
    const byPlan = new Map<string, { planName: string; count: number }>();
    for (const doc of docs) {
      const planId = doc.planId ?? 'unknown';
      const entry = byPlan.get(planId) ?? {
        planName: doc.planName ?? 'Unknown',
        count: 0,
      };
      entry.count++;
      byPlan.set(planId, entry);
    }
    const plans = [...byPlan.entries()]
      .map(([planId, { planName, count }]) => ({ planId, planName, count }))
      .sort((a, b) => b.count - a.count);
    return { totalWithQuotas: docs.length, plans };
  },
});

/**
 * Which languages users are learning (target) and learning from (base),
 * plus the level distribution. Active (non-archived) courses only.
 */
export const getLanguageStats = adminQuery({
  args: {},
  returns: v.object({
    targetLanguages: v.array(v.object({ language: v.string(), count: v.number() })),
    baseLanguages: v.array(v.object({ language: v.string(), count: v.number() })),
    levels: v.array(v.object({ level: v.string(), count: v.number() })),
  }),
  handler: async (ctx) => {
    const courses = await ctx.db.query('courses').take(MAX_SCAN);
    const target = new Map<string, number>();
    const base = new Map<string, number>();
    const levels = new Map<string, number>();
    for (const course of courses) {
      if (course.isArchived) continue;
      for (const lang of course.targetLanguages) {
        target.set(lang, (target.get(lang) ?? 0) + 1);
      }
      for (const lang of course.baseLanguages) {
        base.set(lang, (base.get(lang) ?? 0) + 1);
      }
      const level = course.currentLevel ?? 'unknown';
      levels.set(level, (levels.get(level) ?? 0) + 1);
    }
    const toSorted = (m: Map<string, number>) =>
      [...m.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);
    return {
      targetLanguages: toSorted(target).map(({ key, count }) => ({ language: key, count })),
      baseLanguages: toSorted(base).map(({ key, count }) => ({ language: key, count })),
      levels: toSorted(levels).map(({ key, count }) => ({ level: key, count })),
    };
  },
});

/**
 * Onboarding funnel: how many users completed onboarding, where the
 * in-progress ones are stuck, and where completed users came from.
 */
export const getOnboardingFunnel = adminQuery({
  args: {},
  returns: v.object({
    total: v.number(),
    completed: v.number(),
    inProgressBySteps: v.array(v.object({ step: v.number(), count: v.number() })),
    acquisitionSources: v.array(v.object({ source: v.string(), count: v.number() })),
    learningGoals: v.array(v.object({ goal: v.string(), count: v.number() })),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query('onboardingProgress').take(MAX_SCAN);
    let completed = 0;
    const steps = new Map<number, number>();
    const sources = new Map<string, number>();
    const goals = new Map<string, number>();
    for (const row of rows) {
      if (row.completedAt !== undefined) {
        completed++;
      } else {
        steps.set(row.step, (steps.get(row.step) ?? 0) + 1);
      }
      if (row.acquisitionSource) {
        sources.set(row.acquisitionSource, (sources.get(row.acquisitionSource) ?? 0) + 1);
      }
      for (const goal of row.learningGoals ?? []) {
        goals.set(goal, (goals.get(goal) ?? 0) + 1);
      }
    }
    return {
      total: rows.length,
      completed,
      inProgressBySteps: [...steps.entries()]
        .map(([step, count]) => ({ step, count }))
        .sort((a, b) => a.step - b.step),
      acquisitionSources: [...sources.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      learningGoals: [...goals.entries()]
        .map(([goal, count]) => ({ goal, count }))
        .sort((a, b) => b.count - a.count),
    };
  },
});

/**
 * Filterable, sortable user list. Search matches email + name
 * (case-insensitive, via the userProfiles search index); plan and activity
 * filters plus streak/last-active sorting are computed over bounded scans
 * of the one-row-per-user summary tables (usageQuotas, courseStats) and
 * applied in memory. Heavier joins (courses) run only for the returned
 * rows. `limit` grows for "load more"; `total` is the filtered match count.
 */
export const listUsers = adminQuery({
  args: {
    limit: v.number(),
    search: v.optional(v.string()),
    // Matches planId, with 'unknown' selecting users without a synced plan.
    planIds: v.optional(v.array(v.string())),
    activity: v.optional(
      v.union(
        v.literal('active_7d'),
        v.literal('inactive_7d'),
        v.literal('inactive_30d'),
        v.literal('never'),
      ),
    ),
    sortBy: v.optional(
      v.union(v.literal('newest'), v.literal('streak'), v.literal('last_active')),
    ),
    // `now` per the no-wall-clock query guideline (drives the activity
    // filters and live streak derivation); optional for back-compat
    // (absent → server clock). See resolveClientNow.
    now: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        userId: v.string(),
        email: v.string(),
        name: v.string(),
        image: v.optional(v.string()),
        createdAt: v.number(),
        planId: v.optional(v.string()),
        planName: v.optional(v.string()),
        planStatus: v.optional(v.string()),
        features: v.optional(v.record(v.string(), featureStateValidator)),
        streak: streakValidator,
        lastActivityDate: v.optional(v.string()),
        courseCount: v.number(),
        targetLanguages: v.array(v.string()),
      }),
    ),
    total: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit)));
    const now = resolveClientNow(args.now);
    const todayUtc = dateInTimezone(now, 'UTC');

    const search = args.search?.trim().toLowerCase();
    const profiles = search
      ? await ctx.db
        .query('userProfiles')
        .withSearchIndex('search_users', (q) => q.search('searchText', search))
        .take(200)
      : await ctx.db
        .query('userProfiles')
        .withIndex('by_createdAt')
        .order('desc')
        .take(MAX_SCAN);

    const quotaDocs = await ctx.db.query('usageQuotas').take(MAX_SCAN);
    const quotaByUser = new Map(quotaDocs.map((doc) => [doc.userId, doc]));
    const statsDocs = await ctx.db.query('courseStats').take(MAX_SCAN);
    const summaryByUser = summarizeCourseStats(statsDocs, now);

    const planIds = args.planIds?.length ? new Set(args.planIds) : null;
    const filtered = profiles.filter((profile) => {
      if (planIds) {
        const planId = quotaByUser.get(profile.userId)?.planId ?? 'unknown';
        if (!planIds.has(planId)) return false;
      }
      if (args.activity) {
        const last = summaryByUser.get(profile.userId)?.lastActivityDate;
        switch (args.activity) {
        case 'active_7d':
          if (!last || daysBetween(last, todayUtc) >= 7) return false;
          break;
        case 'inactive_7d':
          if (last && daysBetween(last, todayUtc) < 7) return false;
          break;
        case 'inactive_30d':
          if (last && daysBetween(last, todayUtc) < 30) return false;
          break;
        case 'never':
          if (last) return false;
          break;
        }
      }
      return true;
    });

    const sortBy = args.sortBy ?? 'newest';
    if (sortBy === 'streak') {
      filtered.sort((a, b) => {
        const sa = summaryByUser.get(a.userId)?.streak.displayStreak ?? 0;
        const sb = summaryByUser.get(b.userId)?.streak.displayStreak ?? 0;
        return sb - sa || b.createdAt - a.createdAt;
      });
    } else if (sortBy === 'last_active') {
      filtered.sort((a, b) => {
        const la = summaryByUser.get(a.userId)?.lastActivityDate ?? '';
        const lb = summaryByUser.get(b.userId)?.lastActivityDate ?? '';
        return lb.localeCompare(la) || b.createdAt - a.createdAt;
      });
    } else {
      filtered.sort((a, b) => b.createdAt - a.createdAt);
    }

    const rows = await Promise.all(
      filtered.slice(0, limit).map(async (profile) => {
        const quota = quotaByUser.get(profile.userId);
        const summary = summaryByUser.get(profile.userId);
        const courses = await ctx.db
          .query('courses')
          .withIndex('by_userId', (q) => q.eq('userId', profile.userId))
          .take(20);
        const activeCourses = courses.filter((c) => !c.isArchived);
        return {
          userId: profile.userId,
          email: profile.email,
          name: profile.name,
          image: profile.image,
          createdAt: profile.createdAt,
          planId: quota?.planId,
          planName: quota?.planName,
          planStatus: quota?.planStatus,
          features: quota?.features,
          streak: summary?.streak ?? { displayStreak: 0, state: 'none' },
          lastActivityDate: summary?.lastActivityDate,
          courseCount: activeCourses.length,
          targetLanguages: [
            ...new Set(activeCourses.flatMap((c) => c.targetLanguages)),
          ],
        };
      }),
    );

    return { rows, total: filtered.length, hasMore: filtered.length > limit };
  },
});

const courseDetailValidator = v.object({
  courseId: v.id('courses'),
  baseLanguages: v.array(v.string()),
  targetLanguages: v.array(v.string()),
  currentLevel: v.optional(v.string()),
  isArchived: v.boolean(),
  cardCount: v.number(),
  totalRepetitions: v.number(),
  totalTimeMs: v.number(),
  streak: streakValidator,
  lastActivityDate: v.optional(v.string()),
  totalChatMessages: v.number(),
});

/**
 * Everything about one user for the admin detail page: profile, plan +
 * full feature usage, per-course stats with live streaks, onboarding
 * answers.
 */
export const getUserDetail = adminQuery({
  // `now` per the no-wall-clock query guideline (live streak derivation);
  // optional for back-compat (absent → server clock). See resolveClientNow.
  args: { userId: v.string(), now: v.optional(v.number()) },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.string(),
      email: v.string(),
      name: v.string(),
      image: v.optional(v.string()),
      createdAt: v.number(),
      hasCompletedOnboarding: v.boolean(),
      planId: v.optional(v.string()),
      planName: v.optional(v.string()),
      planStatus: v.optional(v.string()),
      quotasLastSyncedAt: v.optional(v.number()),
      features: v.optional(v.record(v.string(), featureStateValidator)),
      courses: v.array(courseDetailValidator),
      onboarding: v.optional(
        v.object({
          completedAt: v.optional(v.number()),
          acquisitionSource: v.optional(v.string()),
          learningGoals: v.optional(v.array(v.string())),
          dailyTimeGoalMinutes: v.optional(v.number()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {

    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    // Fall back to the Better Auth component doc for users that predate
    // the mirror backfill.
    const authUser = profile
      ? null
      : await authComponent.getAnyUserById(ctx, args.userId);
    if (!profile && !authUser) return null;

    const email = (profile?.email ?? authUser!.email).toLowerCase();
    const name = profile?.name ?? authUser!.name;
    const image = profile?.image ?? authUser?.image ?? undefined;
    const createdAt = profile?.createdAt ?? authUser!.createdAt;

    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    const quota = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    const onboardingRows = await ctx.db
      .query('onboardingProgress')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(5);
    const onboarding =
      onboardingRows.find((r) => r.completedAt !== undefined) ??
      onboardingRows[0];

    const courses = await ctx.db
      .query('courses')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(50);

    const courseDetails = await Promise.all(
      courses.map(async (course) => {
        const deck = await ctx.db
          .query('decks')
          .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
          .first();
        const stats = await ctx.db
          .query('courseStats')
          .withIndex('by_userId_and_courseId', (q) =>
            q.eq('userId', args.userId).eq('courseId', course._id),
          )
          .first();
        const streak = stats
          ? deriveStreakDisplay(
            stats.lastActivityDate,
            dateInTimezone(resolveClientNow(args.now), stats.timezone ?? 'UTC'),
            stats.currentStreak,
            stats.streakFreezeUsedDate,
          )
          : null;
        return {
          courseId: course._id,
          baseLanguages: course.baseLanguages,
          targetLanguages: course.targetLanguages,
          currentLevel: course.currentLevel,
          isArchived: course.isArchived ?? false,
          cardCount: deck?.cardCount ?? 0,
          totalRepetitions: stats?.totalRepetitions ?? 0,
          totalTimeMs: stats?.totalTimeMs ?? 0,
          streak: streak
            ? { displayStreak: streak.displayStreak, state: streak.state }
            : { displayStreak: 0, state: 'none' },
          lastActivityDate: stats?.lastActivityDate,
          totalChatMessages: stats?.totalChatMessages ?? 0,
        };
      }),
    );

    return {
      userId: args.userId,
      email,
      name,
      image,
      createdAt,
      hasCompletedOnboarding: settings?.hasCompletedOnboarding ?? false,
      planId: quota?.planId,
      planName: quota?.planName,
      planStatus: quota?.planStatus,
      quotasLastSyncedAt: quota?.lastSyncedAt,
      features: quota?.features,
      courses: courseDetails,
      onboarding: onboarding
        ? {
          completedAt: onboarding.completedAt,
          acquisitionSource: onboarding.acquisitionSource,
          learningGoals: onboarding.learningGoals,
          dailyTimeGoalMinutes: onboarding.dailyTimeGoalMinutes,
        }
        : undefined,
    };
  },
});
