/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import schema from '../../schema';
import { internal } from '../../_generated/api';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * The fixture-account sweep behind the E2E_TEST_HOOKS gate: address
 * filtering, the exclusion list the teardown loop feeds back, dryRun, and
 * the audit-row collection. The destructive purge path itself (per-user
 * `admin/deleteUser:run`) is covered by deleteUser.test.ts; here it never
 * runs — every case is either read-only, dryRun, or the gate refusing.
 */

const FIXTURE = (n: number) => `e2e-spec-17${n}-abcdefabcdef@flexling.com`;
const REAL = 'person@example.com';

async function seedProfiles(t: TestConvex<typeof schema>, emails: string[]) {
  await t.run(async (ctx) => {
    let at = 1_000;
    for (const email of emails) {
      await ctx.db.insert('userProfiles', {
        userId: `user_${email}`,
        email,
        name: 'x',
        createdAt: at++,
        searchText: email,
      });
    }
  });
}

describe('features/e2eCleanup', () => {
  describe('without E2E_TEST_HOOKS', () => {
    beforeEach(() => {
      delete process.env.E2E_TEST_HOOKS;
    });

    it('refuses every entry point', async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.query(internal.features.e2eCleanup.listFixtureUsers, {}),
      ).rejects.toThrow(/test hooks are disabled/);
      await expect(
        t.mutation(internal.features.e2eCleanup.purgeFixtureAuditRows, {}),
      ).rejects.toThrow(/test hooks are disabled/);
      await expect(
        t.action(internal.features.e2eCleanup.purgeFixtureUsers, {
          dryRun: true,
        }),
      ).rejects.toThrow(/test hooks are disabled/);
    });
  });

  describe('with E2E_TEST_HOOKS=1', () => {
    beforeEach(() => {
      process.env.E2E_TEST_HOOKS = '1';
    });
    afterEach(() => {
      delete process.env.E2E_TEST_HOOKS;
    });

    it('lists only fixture addresses, oldest first', async () => {
      const t = convexTest(schema, modules);
      await seedProfiles(t, [FIXTURE(1), REAL, FIXTURE(2)]);

      const result = await t.query(
        internal.features.e2eCleanup.listFixtureUsers,
        {},
      );
      expect(result.users.map((u) => u.email)).toEqual([
        FIXTURE(1),
        FIXTURE(2),
      ]);
      expect(result.matched).toBe(2);
      expect(result.scanTruncated).toBe(false);
    });

    it('bounds the batch by limit while matched reports the full count', async () => {
      const t = convexTest(schema, modules);
      await seedProfiles(t, [FIXTURE(1), FIXTURE(2), FIXTURE(3)]);

      const result = await t.query(
        internal.features.e2eCleanup.listFixtureUsers,
        { limit: 2 },
      );
      expect(result.users).toHaveLength(2);
      expect(result.matched).toBe(3);
    });

    it('skips excluded emails but still counts them in matched', async () => {
      // The teardown loop feeds failures back through excludeEmails and
      // stops when remaining <= excluded.length; matched counting the
      // excluded rows is what makes that termination test correct.
      const t = convexTest(schema, modules);
      await seedProfiles(t, [FIXTURE(1), FIXTURE(2), FIXTURE(3)]);

      const result = await t.query(
        internal.features.e2eCleanup.listFixtureUsers,
        { excludeEmails: [FIXTURE(1), FIXTURE(3)] },
      );
      expect(result.users.map((u) => u.email)).toEqual([FIXTURE(2)]);
      expect(result.matched).toBe(3);
    });

    it('dryRun reports the batch without deleting anything', async () => {
      const t = convexTest(schema, modules);
      await seedProfiles(t, [FIXTURE(1), REAL]);

      const result = await t.action(
        internal.features.e2eCleanup.purgeFixtureUsers,
        { dryRun: true },
      );
      expect(result.purged).toEqual([FIXTURE(1)]);
      expect(result.failed).toEqual([]);
      expect(result.remaining).toBe(1);

      const profiles = await t.run(async (ctx) =>
        ctx.db.query('userProfiles').collect(),
      );
      expect(profiles).toHaveLength(2);
    });

    it('collects only completed fixture audit rows', async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.db.insert('accountDeletions', {
          userId: 'u1',
          email: FIXTURE(1),
          status: 'completed',
        });
        await ctx.db.insert('accountDeletions', {
          userId: 'u2',
          email: FIXTURE(2),
          status: 'running', // in-flight purge: deleting it would strand the run
        });
        await ctx.db.insert('accountDeletions', {
          userId: 'u3',
          email: REAL,
          status: 'completed', // real account: the record IS the point
        });
      });

      const result = await t.mutation(
        internal.features.e2eCleanup.purgeFixtureAuditRows,
        {},
      );
      expect(result.deleted).toBe(1);
      expect(result.remaining).toBe(0);

      const left = await t.run(async (ctx) =>
        ctx.db.query('accountDeletions').collect(),
      );
      expect(left.map((row) => row.email).sort()).toEqual([FIXTURE(2), REAL]);
    });
  });
});
