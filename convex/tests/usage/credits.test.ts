/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../../schema';
import { api, internal } from '../../_generated/api';
import { drainSchedulerAfterEach } from '../lib/drainScheduler';

const modules = import.meta.glob('/convex/**/*.ts');

// Quota consumption fans out through 0ms scheduler hops whose console output
// otherwise races vitest's teardown. An intermittent
// `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`
// that failed the whole run (exit 1) while every test passed.
drainSchedulerAfterEach();

async function seedCourse(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const courseId = await ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['es'],
    });
    await ctx.db.insert('userSettings', {
      userId: 'user_A',
      hasCompletedOnboarding: true,
      activeCourseId: courseId,
    });
    return { courseId };
  });
}

async function seedQuotas(
  t: TestConvex<typeof schema>,
  features: Record<
    string,
    { balance: number; included: number; used: number; unlimited: boolean }
  >,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('usageQuotas', {
      userId: 'user_A',
      features,
      lastSyncedAt: Date.now(),
    });
  });
}

async function seedPendingApproval(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) =>
    ctx.db.insert('cardApprovals', {
      threadId: 'thread_1',
      messageId: 'm1',
      toolCallId: 'tc1',
      translations: [
        { language: 'en', text: 'Hello' },
        { language: 'es', text: 'Hola' },
      ],
      userId: 'user_A',
      status: 'pending',
    }),
  );
}

async function getQuotas(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', 'user_A'))
      .first(),
  );
}

describe('usage/credits', () => {
  describe('consumeQuota via credit system', () => {
    it('decrements the credits balance for credit-consuming features', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      // New-plan quota doc: no per-feature balance, only credits.
      await seedQuotas(t, {
        credits: { balance: 30, included: 30, used: 0, unlimited: false },
      });
      const approvalId = await seedPendingApproval(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      expect(res.success).toBe(true);

      const quota = await getQuotas(t);
      expect(quota?.features.credits.balance).toBe(29);
      expect(quota?.features.credits.used).toBe(1);
    });

    it('throws USAGE_LIMIT when the credits balance is exhausted', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      await seedQuotas(t, {
        credits: { balance: 0, included: 30, used: 30, unlimited: false },
      });
      const approvalId = await seedPendingApproval(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      await expect(
        asUser.mutation(api.features.chat.cardApprovals.approveCard, {
          approvalId,
        }),
      ).rejects.toThrow(/USAGE_LIMIT|limit/i);
    });

    it('keeps the legacy per-feature path for users without a credits balance', async () => {
      const t = convexTest(schema, modules);
      await seedCourse(t);
      // Grandfathered quota doc: per-feature balance, no credits entry.
      await seedQuotas(t, {
        custom_sentences: {
          balance: 5,
          included: 5,
          used: 0,
          unlimited: false,
        },
      });
      const approvalId = await seedPendingApproval(t);
      const asUser = t.withIdentity({ subject: 'user_A' });
      const res = await asUser.mutation(
        api.features.chat.cardApprovals.approveCard,
        { approvalId },
      );
      expect(res.success).toBe(true);

      const quota = await getQuotas(t);
      expect(quota?.features.custom_sentences.balance).toBe(4);
      expect(quota?.features.credits).toBeUndefined();
    });
  });

  describe('chargeExtraChatCredits', () => {
    it('decrements credits without a balance check (may go negative)', async () => {
      const t = convexTest(schema, modules);
      await seedQuotas(t, {
        credits: { balance: 2, included: 30, used: 28, unlimited: false },
      });
      await t.mutation(internal.usage.helpers.chargeExtraChatCredits, {
        userId: 'user_A',
        extraMessageUnits: 3,
      });
      const quota = await getQuotas(t);
      expect(quota?.features.credits.balance).toBe(-1);
      expect(quota?.features.credits.used).toBe(31);
    });

    it('is a no-op for legacy users without a credits balance', async () => {
      const t = convexTest(schema, modules);
      await seedQuotas(t, {
        chat_messages: { balance: 5, included: 5, used: 0, unlimited: false },
      });
      await t.mutation(internal.usage.helpers.chargeExtraChatCredits, {
        userId: 'user_A',
        extraMessageUnits: 3,
      });
      const quota = await getQuotas(t);
      expect(quota?.features.chat_messages.balance).toBe(5);
    });

    it('is a no-op for zero extra credits', async () => {
      const t = convexTest(schema, modules);
      await seedQuotas(t, {
        credits: { balance: 10, included: 30, used: 20, unlimited: false },
      });
      await t.mutation(internal.usage.helpers.chargeExtraChatCredits, {
        userId: 'user_A',
        extraMessageUnits: 0,
      });
      const quota = await getQuotas(t);
      expect(quota?.features.credits.balance).toBe(10);
    });
  });
});
