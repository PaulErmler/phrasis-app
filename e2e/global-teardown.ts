import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { extractJsonResult } from './cli-json-output';
import { unregisterRun } from './run-lock';
import { assertDevDeployment } from './deployment-guard';
import type { PurgeResult } from '../convex/features/e2eCleanup';

const REPO_ROOT = path.resolve(__dirname, '..');

/** Accounts purged per `convex run`; the loop below re-invokes until dry. */
const PURGE_BATCH = 8;
/** Backstop so a wedged purge cannot hang the teardown indefinitely. */
const MAX_PASSES = 40;

/** Run a Convex function on the dev deployment and parse its JSON result. */
function convexRun(fn: string, args: Record<string, unknown>): unknown {
  // The purge deletes accounts; never issue it toward anything but dev.
  assertDevDeployment('global-teardown');
  const out = execFileSync(
    'pnpm',
    ['exec', 'convex', 'run', fn, JSON.stringify(args)],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return extractJsonResult(out);
}

/**
 * Delete every Playwright fixture account on the deployment.
 *
 * Each run signs up throwaway users and, before this existed, left them
 * behind. They are not inert: every fixture user is handed the same shared
 * curriculum texts, so the per-text card count climbs until the `.take(...)`
 * ceilings in the test hooks truncate past the current user's own row. At ~360
 * leftover users that silently broke curriculum-edit-flag.spec.ts, which read
 * its own card count as zero.
 *
 * Sweeps by address pattern rather than tracking this run's signups, so a
 * killed run's leftovers get collected by the next one. That also means a
 * partial run (`--project=... --no-deps`) removes the fixture user it just
 * reused; set `E2E_SKIP_USER_CLEANUP=1` while iterating on a single spec to
 * keep the saved storageState usable.
 *
 * Best-effort throughout: a failure here must not turn a green suite red.
 */
function purgeFixtureUsers(): void {
  if (process.env.E2E_SKIP_USER_CLEANUP === '1') {
    console.log('E2E_SKIP_USER_CLEANUP=1 — leaving fixture accounts in place.');
    return;
  }

  // Accounts that refuse to purge go on an explicit exclusion list, so one
  // wedged fixture cannot head-of-line block later passes. By email, not by
  // scan position: an offset would presume the backend's scan order stable
  // across calls, which nothing enforces.
  const excluded: string[] = [];
  let totalPurged = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let result: PurgeResult;
    try {
      result = convexRun('features/e2eCleanup:purgeFixtureUsers', {
        limit: PURGE_BATCH,
        excludeEmails: excluded,
      }) as PurgeResult;
    } catch (error) {
      console.warn('Fixture-account cleanup failed — skipping:', error);
      return;
    }
    if (!result || typeof result.remaining !== 'number') {
      console.warn('Fixture-account cleanup returned no result — skipping.');
      return;
    }

    totalPurged += result.purged.length;
    for (const failure of result.failed) {
      console.warn(`Could not purge ${failure.email}: ${failure.error}`);
      excluded.push(failure.email);
    }

    // `remaining` still counts the excluded accounts, so compare against the
    // exclusion list rather than zero.
    if (result.remaining <= excluded.length) break;
    if (result.purged.length === 0 && result.failed.length === 0) break;
  }

  console.log(`Purged ${totalPurged} Playwright fixture account(s).`);
  if (excluded.length > 0) {
    console.warn(
      `${excluded.length} fixture account(s) refused to purge — retry with ` +
        '`pnpm exec convex run features/e2eCleanup:purgeFixtureUsers`.',
    );
  }
}

/**
 * Counterpart to global-setup.ts: delete the accounts this run's signups
 * created, then remove the E2E_TEST_HOOKS flag so the dev deployment goes
 * back to sending real auth emails. Order matters — the cleanup hook is
 * itself gated on the flag.
 *
 * Best-effort. A cleanup failure must not turn a green suite red — with one
 * deliberate exception: the dev-deployment gate below throws, because
 * purging accounts against anything but a dev deployment is worse than a
 * red run. global-setup runs the same gate, so tripping it here means the
 * environment changed mid-run and deserves the noise.
 */
export default function globalTeardown() {
  assertDevDeployment('global-teardown');
  if (!unregisterRun()) {
    console.log(
      'Leaving E2E_TEST_HOOKS set — another Playwright run is still active.',
    );
    return;
  }

  purgeFixtureUsers();

  try {
    execFileSync(
      'pnpm',
      ['exec', 'convex', 'env', 'remove', 'E2E_TEST_HOOKS'],
      {
        cwd: REPO_ROOT,
        stdio: 'inherit',
      },
    );
  } catch (error) {
    console.warn(
      'Failed to remove E2E_TEST_HOOKS after the test run — remove it ' +
        'manually with `pnpm exec convex env remove E2E_TEST_HOOKS`:',
      error,
    );
  }
}
