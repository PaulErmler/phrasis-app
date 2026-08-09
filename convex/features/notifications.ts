/**
 * Daily reminder notifications: settings, device registry, and the sweep that
 * decides who is due.
 *
 * Delivery itself lives in `features/notificationDelivery.ts`, which needs the
 * Node runtime for Web Push payload encryption and therefore cannot live in
 * this file alongside queries and mutations.
 *
 * Shape of the whole feature:
 *
 *   crons.ts (every 15 min)
 *     -> sweep                        internalMutation, claims due rows
 *        -> reminderPool.enqueueAction
 *           -> deliverDailyReminder   internalAction ("use node")
 *              -> getDeliveryPlan     internalQuery, content + devices
 *              -> [web push / FCM]
 *              -> recordDeliveryOutcome  internalMutation, prune + counters
 *
 * The claim is the concurrency guard: `sweep` advances `reminderNextSendAt`
 * inside the same transaction that reads it, so an overlapping or retried sweep
 * finds nothing to claim and cannot double-send. The cost of that ordering is
 * that a failed delivery means a missed day rather than a retried one, which is
 * the right trade for a notification — see `reminderPool` in lib/workpools.ts.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId } from '../db/decks';
import { deriveStreakDisplay, getCourseStats } from '../db/courseStats';
import { cardsByDueDate } from '../db/stats/cardAggregates';
import { displayedActiveReviews, getDailyStats } from '../db/stats/dailyStats';
import { getUserSettings, requireAuthUserId } from '../db/users';
import { isE2EFixtureAddress } from '../lib/authEmails';
import { isValidTimezone } from '../lib/dateUtils';
import { reminderPool } from '../lib/workpools';
import { pushPlatformValidator, streakStateValidator } from '../types';
import { dateInTimezone } from '../../lib/dateStrings';
import {
  isValidReminderMinute,
  nextOccurrence,
} from '../../lib/reminderSchedule';

/**
 * Rows claimed per sweep transaction.
 *
 * Bounded because a mutation is a transaction with document and byte limits: at
 * some user count every-due-row-at-once stops fitting. A full batch schedules a
 * continuation in a fresh transaction (the documented pattern for work that
 * outgrows one mutation), so throughput is unbounded while any single
 * transaction stays small.
 */
const SWEEP_BATCH = 100;

/**
 * Devices considered per user per send.
 *
 * A person realistically has a handful. The cap exists so one account with a
 * pathological number of stale subscriptions cannot dominate a pool worker;
 * dead ones get pruned on their next delivery failure regardless.
 */
const MAX_DEVICES_PER_USER = 20;

const deviceValidator = v.object({
  id: v.id('pushDevices'),
  platform: pushPlatformValidator,
  token: v.string(),
  keys: v.optional(v.object({ p256dh: v.string(), auth: v.string() })),
});

/** What the settings screen renders. */
export const getReminderSettings = query({
  args: {},
  returns: v.union(
    v.object({
      enabled: v.boolean(),
      minuteLocal: v.union(v.number(), v.null()),
      timeZone: v.union(v.string(), v.null()),
      locale: v.union(v.string(), v.null()),
      nextSendAt: v.union(v.number(), v.null()),
      deviceCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await ctx.auth
      .getUserIdentity()
      .then((identity) => identity?.subject ?? null);
    if (!userId) return null;

    const settings = await getUserSettings(ctx, userId);
    const devices = await ctx.db
      .query('pushDevices')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(MAX_DEVICES_PER_USER);

    return {
      enabled: settings?.reminderEnabled === true,
      minuteLocal: settings?.reminderMinuteLocal ?? null,
      timeZone: settings?.reminderTimeZone ?? null,
      locale: settings?.reminderLocale ?? null,
      nextSendAt: settings?.reminderNextSendAt ?? null,
      deviceCount: devices.length,
    };
  },
});

/**
 * Write the reminder preference and recompute the next send instant.
 *
 * Every field is optional so the client can send a partial update — the
 * settings screen writes the time alone, while the mount-time freshness check
 * writes only the timezone and locale after travel or a DST rule change.
 * `reminderNextSendAt` is always re-derived from the merged result rather than
 * accepted from the client, so a stale or hostile caller cannot schedule itself
 * into the past (which would make the sweep re-claim the row every run).
 */
export const updateReminderSettings = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    minuteLocal: v.optional(v.number()),
    timeZone: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const settings = await getUserSettings(ctx, userId);

    if (
      args.minuteLocal !== undefined &&
      !isValidReminderMinute(args.minuteLocal)
    ) {
      throw new ConvexError({
        code: 'INVALID_REMINDER_TIME',
        message: `Reminder time must be a whole quarter-hour minute-of-day, got ${args.minuteLocal}.`,
      });
    }
    if (args.timeZone !== undefined && !isValidTimezone(args.timeZone)) {
      throw new ConvexError({
        code: 'INVALID_TIMEZONE',
        message: `Invalid IANA timezone: "${args.timeZone}".`,
      });
    }

    const enabled = args.enabled ?? settings?.reminderEnabled ?? false;
    const minuteLocal = args.minuteLocal ?? settings?.reminderMinuteLocal;
    const timeZone = args.timeZone ?? settings?.reminderTimeZone;
    const locale = args.locale ?? settings?.reminderLocale;

    // Enabling without both a time and a zone is a client bug: the UI resolves
    // the zone from the browser and defaults the time before it ever offers
    // the toggle. Refuse rather than persist a row the sweep can never act on.
    if (enabled && (minuteLocal === undefined || timeZone === undefined)) {
      throw new ConvexError({
        code: 'INCOMPLETE_REMINDER',
        message: 'Enabling reminders requires both a time and a timezone.',
      });
    }

    const nextSendAt =
      enabled && minuteLocal !== undefined && timeZone !== undefined
        ? nextOccurrence(timeZone, minuteLocal, Date.now())
        : undefined;

    const patch = {
      reminderEnabled: enabled,
      reminderMinuteLocal: minuteLocal,
      reminderTimeZone: timeZone,
      reminderLocale: locale,
      reminderNextSendAt: nextSendAt,
    };

    if (settings) {
      await ctx.db.patch(settings._id, patch);
      return null;
    }

    // No settings row yet — same patch-or-insert shape as
    // `features/consent.setAnalyticsConsent`. Only `finalizeOnboarding` may
    // flip `hasCompletedOnboarding`, so a fresh row starts false.
    await ctx.db.insert('userSettings', {
      userId,
      hasCompletedOnboarding: false,
      ...patch,
    });
    return null;
  },
});

/**
 * Record a delivery target, replacing any existing row for the same token.
 *
 * Upsert rather than insert because the client re-registers on every mount: a
 * browser hands back the same endpoint until it rotates, and Capacitor replays
 * the same FCM token to its `registration` listener on each launch. Keying on
 * the token also transfers a device cleanly between accounts on a shared phone
 * — the old owner's row is overwritten, not left to receive someone else's
 * reminders.
 */
export const registerDevice = mutation({
  args: {
    platform: pushPlatformValidator,
    token: v.string(),
    keys: v.optional(v.object({ p256dh: v.string(), auth: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    if (args.token.length === 0) {
      throw new ConvexError({
        code: 'INVALID_PUSH_TOKEN',
        message: 'Push token must not be empty.',
      });
    }
    // Web Push cannot be encrypted without the subscription's key pair, so a
    // 'web' row without them would fail on every send. Reject at the door.
    if (args.platform === 'web' && !args.keys) {
      throw new ConvexError({
        code: 'INVALID_PUSH_TOKEN',
        message: 'Web push registration requires p256dh and auth keys.',
      });
    }

    const now = Date.now();
    const existing = await ctx.db
      .query('pushDevices')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        platform: args.platform,
        keys: args.keys,
        lastSeenAt: now,
        // A token that just proved it exists starts clean, so a run of
        // transient failures doesn't accumulate across weeks.
        failureCount: 0,
      });
      return null;
    }

    await ctx.db.insert('pushDevices', {
      userId,
      platform: args.platform,
      token: args.token,
      keys: args.keys,
      createdAt: now,
      lastSeenAt: now,
      failureCount: 0,
    });
    return null;
  },
});

/** Drop a delivery target (user turned notifications off on this device). */
export const unregisterDevice = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const existing = await ctx.db
      .query('pushDevices')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
    // Ownership check: the token is client-supplied, so without this any
    // authenticated user could delete another account's device row.
    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

/**
 * Send a reminder to the caller's devices right now, bypassing the schedule.
 *
 * Powers the "send test" button. `force` skips the enabled check and the
 * already-studied check — the user explicitly asked for this one, and the point
 * is to prove delivery works, which a silent skip would not.
 */
export const sendTestNotification = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    await reminderPool.enqueueAction(
      ctx,
      internal.features.notificationDelivery.deliverDailyReminder,
      { userId, force: true },
    );
    return null;
  },
});

/**
 * Claim every row whose send time has arrived and hand each to the pool.
 *
 * Reads through `by_reminderEnabled_and_reminderNextSendAt`, so the cost tracks
 * users who are actually due rather than the size of the user table. The patch
 * happens before the enqueue and in the same transaction as the read, which is
 * what makes the claim safe under overlapping runs.
 */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    const due = await ctx.db
      .query('userSettings')
      .withIndex('by_reminderEnabled_and_reminderNextSendAt', (q) =>
        q.eq('reminderEnabled', true).lte('reminderNextSendAt', now),
      )
      .take(SWEEP_BATCH);

    for (const settings of due) {
      const timeZone = settings.reminderTimeZone;
      const minuteLocal = settings.reminderMinuteLocal;

      // A row that cannot be scheduled would otherwise match `lte(now)`
      // forever and be re-claimed every 15 minutes. Disable it instead of
      // leaving a hot row in the index; the user's next settings write
      // (which validates both fields) revives it.
      if (
        timeZone === undefined ||
        minuteLocal === undefined ||
        !isValidTimezone(timeZone) ||
        !isValidReminderMinute(minuteLocal)
      ) {
        await ctx.db.patch(settings._id, {
          reminderEnabled: false,
          reminderNextSendAt: undefined,
        });
        continue;
      }

      await ctx.db.patch(settings._id, {
        reminderNextSendAt: nextOccurrence(timeZone, minuteLocal, now),
        reminderLastClaimedDate: dateInTimezone(now, timeZone),
      });

      await reminderPool.enqueueAction(
        ctx,
        internal.features.notificationDelivery.deliverDailyReminder,
        { userId: settings.userId, force: false },
      );
    }

    // A full batch means more rows may be due. Continue in a fresh transaction
    // rather than waiting 15 minutes for the next cron tick. Terminates because
    // every row processed above had its `reminderNextSendAt` moved past `now`.
    if (due.length === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.notifications.sweep,
        {},
      );
    }
    return null;
  },
});

/**
 * Everything the delivery action needs, in one read.
 *
 * Deliberately one query rather than several: an action's calls into queries
 * are separate transactions, so splitting this would let the user's state
 * change underneath the decision. `now` is an argument rather than a wall-clock
 * read because queries are not re-run as time passes.
 *
 * Takes `userId` explicitly, which is why it is internal — there is no
 * authenticated identity inside a cron-driven pool worker. This is not an
 * authorization boundary; the public surface above resolves the caller from
 * `ctx.auth` before anything reaches here.
 */
export const getDeliveryPlan = internalQuery({
  args: { userId: v.string(), now: v.number(), force: v.boolean() },
  returns: v.union(
    v.object({ send: v.literal(false), reason: v.string() }),
    v.object({
      send: v.literal(true),
      locale: v.union(v.string(), v.null()),
      dueCount: v.number(),
      streakState: streakStateValidator,
      streakDays: v.number(),
      devices: v.array(deviceValidator),
      /**
       * True for a Playwright fixture account. The delivery action refuses to
       * send for real when this is set and capture mode is off — a reminder is
       * recurring, so unlike a one-shot signup email it keeps firing every day
       * long after `e2e/global-teardown.ts` cleared `E2E_TEST_HOOKS`, against
       * whatever device the test happened to register.
       */
      isE2EFixtureUser: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const settings = await getUserSettings(ctx, args.userId);
    if (!settings) return { send: false as const, reason: 'no-settings' };
    if (!args.force && settings.reminderEnabled !== true) {
      return { send: false as const, reason: 'disabled' };
    }

    const timeZone = settings.reminderTimeZone;
    if (timeZone === undefined || !isValidTimezone(timeZone)) {
      return { send: false as const, reason: 'no-timezone' };
    }

    const devices = await ctx.db
      .query('pushDevices')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(MAX_DEVICES_PER_USER);
    if (devices.length === 0) {
      return { send: false as const, reason: 'no-devices' };
    }

    const active = await getActiveCourseForUser(ctx, args.userId);
    if (!active) return { send: false as const, reason: 'no-active-course' };
    const courseId = active.course._id;

    const today = dateInTimezone(args.now, timeZone);

    // Already practised today — the reminder has nothing left to prompt, so
    // sending it would be pure noise. This is the one skip that survives
    // `force`: a test notification is still worth delivering, but a scheduled
    // one is not.
    const daily = await getDailyStats(ctx, args.userId, courseId, today);
    if (!args.force && displayedActiveReviews(daily) > 0) {
      return { send: false as const, reason: 'already-studied' };
    }

    const deck = await getDeckByCourseId(ctx, courseId);
    const dueCount = deck
      ? await cardsByDueDate.count(ctx, {
          namespace: deck._id,
          bounds: { upper: { key: args.now, inclusive: true } },
        })
      : 0;

    const stats = await getCourseStats(ctx, args.userId, courseId);
    const streak = deriveStreakDisplay(
      stats?.lastActivityDate,
      today,
      stats?.currentStreak ?? 0,
      stats?.streakFreezeUsedDate,
    );

    // Read the address from the app-owned mirror rather than the Better Auth
    // component. `userProfiles` exists precisely so app queries can see
    // email/name without a cross-component read, and importing convex/auth.ts
    // here would drag its module-load `SITE_URL` requirement into every caller
    // and every test that touches notifications.
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    // Note there is no "nothing due" skip. The user asked for a nudge at a
    // specific time; going silent on quiet days would read as broken, and
    // free study and new cards are always available. `renderDailyReminder`
    // has copy for the zero case.
    return {
      send: true as const,
      locale: settings.reminderLocale ?? null,
      dueCount,
      streakState: streak.state,
      streakDays: streak.displayStreak,
      devices: devices.map((d) => ({
        id: d._id,
        platform: d.platform,
        token: d.token,
        keys: d.keys,
      })),
      isE2EFixtureUser: profile ? isE2EFixtureAddress(profile.email) : false,
    };
  },
});

/**
 * Apply what the transports reported: delete permanently-dead targets, count
 * transient failures, and stamp success.
 *
 * One mutation for the whole fan-out rather than one per device, so a user with
 * several devices costs a single transaction.
 */
export const recordDeliveryOutcome = internalMutation({
  args: {
    delivered: v.array(v.id('pushDevices')),
    /** Gone for good — HTTP 404/410, or FCM UNREGISTERED/INVALID_ARGUMENT. */
    expired: v.array(v.id('pushDevices')),
    /** Retryable — throttling or a provider 5xx. */
    failed: v.array(v.id('pushDevices')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const id of args.expired) {
      // Tolerate a row that vanished between the send and here (the user
      // unregistered mid-flight): delete would throw on a missing document.
      const row = await ctx.db.get(id);
      if (row) await ctx.db.delete(id);
    }

    for (const id of args.delivered) {
      const row = await ctx.db.get(id);
      if (row) await ctx.db.patch(id, { lastSeenAt: now, failureCount: 0 });
    }

    for (const id of args.failed) {
      const row = await ctx.db.get(id);
      if (row) await ctx.db.patch(id, { failureCount: row.failureCount + 1 });
    }
    return null;
  },
});
