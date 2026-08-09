/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import { reminderPool } from '@/convex/lib/workpools';

import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

// The sweep self-continues through `scheduler.runAfter(0, ...)` on a full
// batch; drain those chains inside the test context so their logs don't race
// vitest teardown.
drainSchedulerAfterEach();

// reminderPool is module-mocked globally (tests/convexTestSetup.ts). The sweep's
// only observable output is who it enqueued, so that mock is the assertion
// surface — the delivery action itself is a "use node" module convex-test
// cannot execute.
const enqueuedUserIds = () =>
  vi
    .mocked(reminderPool.enqueueAction)
    .mock.calls.map((c) => (c[2] as { userId: string }).userId);

beforeEach(() => {
  vi.mocked(reminderPool.enqueueAction).mockClear();
});

const BERLIN = 'Europe/Berlin';
/** 08:00 as a minute-of-day. */
const EIGHT_AM = 8 * 60;

async function seedReminder(
  t: TestConvex<typeof schema>,
  opts: {
    userId: string;
    enabled?: boolean;
    nextSendAt?: number;
    minuteLocal?: number;
    timeZone?: string;
    locale?: string;
  },
) {
  return t.run(async (ctx) =>
    ctx.db.insert('userSettings', {
      userId: opts.userId,
      hasCompletedOnboarding: true,
      reminderEnabled: opts.enabled ?? true,
      reminderMinuteLocal: opts.minuteLocal ?? EIGHT_AM,
      reminderTimeZone: opts.timeZone ?? BERLIN,
      reminderLocale: opts.locale ?? 'en',
      reminderNextSendAt: opts.nextSendAt ?? Date.now() - 1000,
    }),
  );
}

describe('features/notifications', () => {
  describe('sweep', () => {
    it('claims a due row exactly once across two back-to-back sweeps', async () => {
      const t = convexTest(schema, modules);
      await seedReminder(t, { userId: 'user_A' });

      await t.mutation(internal.features.notifications.sweep, {});
      await t.mutation(internal.features.notifications.sweep, {});

      // The claim (advancing reminderNextSendAt inside the reading
      // transaction) is the whole concurrency guard — if it regressed, the
      // second sweep would enqueue the same user again.
      expect(enqueuedUserIds()).toEqual(['user_A']);
    });

    it('advances reminderNextSendAt to the next local occurrence', async () => {
      const t = convexTest(schema, modules);
      const id = await seedReminder(t, { userId: 'user_A' });
      const before = Date.now();

      await t.mutation(internal.features.notifications.sweep, {});

      const row = await t.run(async (ctx) => ctx.db.get(id));
      expect(row?.reminderNextSendAt).toBeGreaterThan(before);
      // Next 08:00 Berlin is always within a day of now, never further.
      expect(row?.reminderNextSendAt).toBeLessThanOrEqual(
        before + 24 * 60 * 60 * 1000,
      );
      // And it stamps the local day it claimed.
      expect(row?.reminderLastClaimedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('ignores rows that are disabled or not yet due', async () => {
      const t = convexTest(schema, modules);
      await seedReminder(t, { userId: 'disabled', enabled: false });
      await seedReminder(t, {
        userId: 'future',
        nextSendAt: Date.now() + 60 * 60 * 1000,
      });
      await seedReminder(t, { userId: 'due' });

      await t.mutation(internal.features.notifications.sweep, {});

      expect(enqueuedUserIds()).toEqual(['due']);
    });

    it('disables an enabled row that has no usable timezone instead of re-claiming it forever', async () => {
      const t = convexTest(schema, modules);
      // An enabled row with a past nextSendAt but no timezone matches the index
      // range on every run. Without the guard it would be re-claimed every 15
      // minutes for the lifetime of the deployment.
      const id = await t.run(async (ctx) =>
        ctx.db.insert('userSettings', {
          userId: 'user_broken',
          hasCompletedOnboarding: true,
          reminderEnabled: true,
          reminderMinuteLocal: EIGHT_AM,
          reminderNextSendAt: Date.now() - 1000,
        }),
      );

      await t.mutation(internal.features.notifications.sweep, {});

      const row = await t.run(async (ctx) => ctx.db.get(id));
      expect(row?.reminderEnabled).toBe(false);
      expect(row?.reminderNextSendAt).toBeUndefined();
      expect(enqueuedUserIds()).toEqual([]);
    });
  });

  describe('updateReminderSettings', () => {
    it('computes reminderNextSendAt when enabling', async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await asUser.mutation(api.features.notifications.updateReminderSettings, {
        enabled: true,
        minuteLocal: EIGHT_AM,
        timeZone: BERLIN,
        locale: 'de',
      });

      const settings = await asUser.query(
        api.features.notifications.getReminderSettings,
        {},
      );
      expect(settings).toMatchObject({
        enabled: true,
        minuteLocal: EIGHT_AM,
        timeZone: BERLIN,
        locale: 'de',
        deviceCount: 0,
      });
      expect(settings?.nextSendAt).toBeGreaterThan(Date.now());
    });

    it('creates the settings row when none exists yet', async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: 'user_new' });

      await asUser.mutation(api.features.notifications.updateReminderSettings, {
        enabled: true,
        minuteLocal: EIGHT_AM,
        timeZone: BERLIN,
      });

      const row = await t.run(async (ctx) =>
        ctx.db
          .query('userSettings')
          .withIndex('by_userId', (q) => q.eq('userId', 'user_new'))
          .first(),
      );
      // Only finalizeOnboarding may flip this — a reminder must not.
      expect(row?.hasCompletedOnboarding).toBe(false);
      expect(row?.reminderEnabled).toBe(true);
    });

    it('clears reminderNextSendAt when disabling so the row leaves the sweep index', async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await asUser.mutation(api.features.notifications.updateReminderSettings, {
        enabled: true,
        minuteLocal: EIGHT_AM,
        timeZone: BERLIN,
      });

      await asUser.mutation(api.features.notifications.updateReminderSettings, {
        enabled: false,
      });

      await t.mutation(internal.features.notifications.sweep, {});
      expect(enqueuedUserIds()).toEqual([]);
    });

    it('rejects an off-step time and an invalid timezone', async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await expect(
        asUser.mutation(api.features.notifications.updateReminderSettings, {
          minuteLocal: 487,
        }),
      ).rejects.toThrow();

      await expect(
        asUser.mutation(api.features.notifications.updateReminderSettings, {
          timeZone: 'Mars/Olympus_Mons',
        }),
      ).rejects.toThrow();
    });

    it('refuses to enable without both a time and a timezone', async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: 'user_A' });

      await expect(
        asUser.mutation(api.features.notifications.updateReminderSettings, {
          enabled: true,
        }),
      ).rejects.toThrow();
    });

    it('rejects unauthenticated callers', async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.features.notifications.updateReminderSettings, {
          enabled: false,
        }),
      ).rejects.toThrow();
      expect(
        await t.query(api.features.notifications.getReminderSettings, {}),
      ).toBeNull();
    });
  });

  describe('device registry', () => {
    it('upserts on the same token rather than accumulating rows', async () => {
      const t = convexTest(schema, modules);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const keys = { p256dh: 'p', auth: 'a' };

      await asUser.mutation(api.features.notifications.registerDevice, {
        platform: 'web',
        token: 'https://push.example/abc',
        keys,
      });
      await asUser.mutation(api.features.notifications.registerDevice, {
        platform: 'web',
        token: 'https://push.example/abc',
        keys,
      });

      const settings = await asUser.query(
        api.features.notifications.getReminderSettings,
        {},
      );
      expect(settings?.deviceCount).toBe(1);
    });

    it('reassigns a token to the new owner on a shared device', async () => {
      const t = convexTest(schema, modules);
      const token = 'fcm-token-shared';
      await t
        .withIdentity({ subject: 'user_A' })
        .mutation(api.features.notifications.registerDevice, {
          platform: 'android',
          token,
        });
      await t
        .withIdentity({ subject: 'user_B' })
        .mutation(api.features.notifications.registerDevice, {
          platform: 'android',
          token,
        });

      const rows = await t.run(async (ctx) =>
        ctx.db.query('pushDevices').collect(),
      );
      expect(rows).toHaveLength(1);
      // Otherwise the previous owner keeps receiving the new owner's reminders.
      expect(rows[0].userId).toBe('user_B');
    });

    it('rejects a web registration with no encryption keys', async () => {
      const t = convexTest(schema, modules);
      await expect(
        t
          .withIdentity({ subject: 'user_A' })
          .mutation(api.features.notifications.registerDevice, {
            platform: 'web',
            token: 'https://push.example/no-keys',
          }),
      ).rejects.toThrow();
    });

    it('will not let one user unregister another user’s device', async () => {
      const t = convexTest(schema, modules);
      const token = 'fcm-token-victim';
      await t
        .withIdentity({ subject: 'owner' })
        .mutation(api.features.notifications.registerDevice, {
          platform: 'ios',
          token,
        });

      await t
        .withIdentity({ subject: 'attacker' })
        .mutation(api.features.notifications.unregisterDevice, { token });

      const rows = await t.run(async (ctx) =>
        ctx.db.query('pushDevices').collect(),
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('getDeliveryPlan', () => {
    async function seedCourseForUser(
      t: TestConvex<typeof schema>,
      userId: string,
    ) {
      return t.run(async (ctx) => {
        const courseId = await ctx.db.insert('courses', {
          userId,
          baseLanguages: ['en'],
          targetLanguages: ['de'],
        });
        const settings = await ctx.db
          .query('userSettings')
          .withIndex('by_userId', (q) => q.eq('userId', userId))
          .first();
        if (settings) {
          await ctx.db.patch(settings._id, { activeCourseId: courseId });
        }
        await ctx.db.insert('pushDevices', {
          userId,
          platform: 'android',
          token: `token-${userId}`,
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
          failureCount: 0,
        });
        return courseId;
      });
    }

    it('skips a user with no registered devices', async () => {
      const t = convexTest(schema, modules);
      await seedReminder(t, { userId: 'user_A' });

      const plan = await t.query(
        internal.features.notifications.getDeliveryPlan,
        { userId: 'user_A', now: Date.now(), force: false },
      );
      expect(plan).toEqual({ send: false, reason: 'no-devices' });
    });

    it('skips a user who already studied today, but not when forced', async () => {
      const t = convexTest(schema, modules);
      await seedReminder(t, { userId: 'user_A' });
      const courseId = await seedCourseForUser(t, 'user_A');

      const now = Date.now();
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: BERLIN,
      }).format(new Date(now));
      await t.run(async (ctx) => {
        await ctx.db.insert('dailyStats', {
          userId: 'user_A',
          courseId,
          date: today,
          reps: 4,
          newCards: 0,
          timeMs: 1000,
          cardsReviewed: 4,
          reviewsByMode: { audio: 2, full: 2 },
        });
      });

      const scheduled = await t.query(
        internal.features.notifications.getDeliveryPlan,
        { userId: 'user_A', now, force: false },
      );
      expect(scheduled).toEqual({ send: false, reason: 'already-studied' });

      // The "send test" button must still prove delivery works.
      const forced = await t.query(
        internal.features.notifications.getDeliveryPlan,
        { userId: 'user_A', now, force: true },
      );
      expect(forced.send).toBe(true);
    });

    it('sends when nothing is due — a quiet day is not a broken reminder', async () => {
      const t = convexTest(schema, modules);
      await seedReminder(t, { userId: 'user_A' });
      await seedCourseForUser(t, 'user_A');

      const plan = await t.query(
        internal.features.notifications.getDeliveryPlan,
        { userId: 'user_A', now: Date.now(), force: false },
      );
      expect(plan).toMatchObject({ send: true, dueCount: 0 });
    });
  });

  describe('recordDeliveryOutcome', () => {
    it('deletes expired devices, resets delivered ones and counts failures', async () => {
      const t = convexTest(schema, modules);
      const ids = await t.run(async (ctx) => {
        const base = {
          userId: 'user_A',
          platform: 'android' as const,
          createdAt: 1,
          lastSeenAt: 1,
        };
        return {
          gone: await ctx.db.insert('pushDevices', {
            ...base,
            token: 'gone',
            failureCount: 0,
          }),
          ok: await ctx.db.insert('pushDevices', {
            ...base,
            token: 'ok',
            failureCount: 3,
          }),
          flaky: await ctx.db.insert('pushDevices', {
            ...base,
            token: 'flaky',
            failureCount: 1,
          }),
        };
      });

      await t.mutation(internal.features.notifications.recordDeliveryOutcome, {
        delivered: [ids.ok],
        expired: [ids.gone],
        failed: [ids.flaky],
      });

      const rows = await t.run(async (ctx) => ({
        gone: await ctx.db.get(ids.gone),
        ok: await ctx.db.get(ids.ok),
        flaky: await ctx.db.get(ids.flaky),
      }));
      expect(rows.gone).toBeNull();
      // A token that just proved it works starts clean.
      expect(rows.ok?.failureCount).toBe(0);
      expect(rows.flaky?.failureCount).toBe(2);
    });

    it('tolerates a device row that vanished mid-flight', async () => {
      const t = convexTest(schema, modules);
      const id = await t.run(async (ctx) => {
        const inserted = await ctx.db.insert('pushDevices', {
          userId: 'user_A',
          platform: 'web',
          token: 'x',
          createdAt: 1,
          lastSeenAt: 1,
          failureCount: 0,
        });
        await ctx.db.delete(inserted);
        return inserted;
      });

      // The user can unregister between the send and the outcome write; a bare
      // patch/delete would throw on the missing document.
      await expect(
        t.mutation(internal.features.notifications.recordDeliveryOutcome, {
          delivered: [id],
          expired: [id],
          failed: [id],
        }),
      ).resolves.toBeNull();
    });
  });
});
