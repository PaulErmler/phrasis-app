import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '../../schema';
import { internal } from '../../_generated/api';
import { RUN_NAME } from '../../migrations/backfillRenderedForms';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * The run marker: the deploy script starts this job after every deploy, so
 * a finished run must be a no-op and an in-flight run must not be doubled.
 */
describe('migrations/backfillRenderedForms run marker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once, then reports already-done until forced', async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.migrations.backfillRenderedForms.run,
      {},
    );
    expect(first.status).toBe('started');
    // Started but not finished: a second start is refused.
    const second = await t.mutation(
      internal.migrations.backfillRenderedForms.run,
      {},
    );
    expect(second.status).toBe('running');

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const marker = await t.run((ctx) =>
      ctx.db
        .query('backfillRuns')
        .withIndex('by_name', (q) => q.eq('name', RUN_NAME))
        .unique(),
    );
    expect(marker?.finishedAt).toBeDefined();
    expect(marker?.summary).toContain('"pages":1');

    const third = await t.mutation(
      internal.migrations.backfillRenderedForms.run,
      {},
    );
    expect(third.status).toBe('already-done');

    const forced = await t.mutation(
      internal.migrations.backfillRenderedForms.run,
      { force: true },
    );
    expect(forced.status).toBe('started');
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const markers = await t.run((ctx) =>
      ctx.db.query('backfillRuns').collect(),
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].finishedAt).toBeDefined();
  });

  it('restarts a run that never finished once the grace period has passed', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('backfillRuns', {
        name: RUN_NAME,
        startedAt: Date.now() - 7 * 60 * 60 * 1000,
      });
    });
    const result = await t.mutation(
      internal.migrations.backfillRenderedForms.run,
      {},
    );
    expect(result.status).toBe('started');
  });
});
