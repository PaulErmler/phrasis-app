import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  completeEmailVerification,
  completeOnboardingFresh,
  neutralizeTours,
  signUpFreshUser,
} from './helpers';

/**
 * Full account-deletion lifecycle against the real dev deployment:
 *
 *   1. Fresh signup + onboarding (course, deck, cards, first-lesson reviews).
 *   2. The purge REFUSES to run before the user has requested deletion
 *      in-app, and refuses a mismatched email (the two operator guards).
 *   3. The user requests deletion from settings (writes the durable
 *      `accountDeletions` request row, signs them out).
 *   4. The operator command (`admin/deleteUser:run`) dry-runs, then really
 *      purges: app tables, chat, auth user, Autumn customer (404-tolerant —
 *      this user never opened a billing surface).
 *   5. The same email signs up again from zero: verification works,
 *      onboarding starts at step one (the proof nothing survived: existing
 *      accounts never land back in the wizard), and the new account works.
 *
 * Own fresh user, empty storageState (own Playwright project, chained after
 * email-auth so its signups never race the fixture users' warmup fan-out).
 * Requires E2E_TEST_HOOKS=1 (global-setup) only for auth-email capture.
 */

const REPO_ROOT = path.resolve(__dirname, '..');

test.use({ storageState: { cookies: [], origins: [] } });

/** Run a Convex function on the dev deployment and parse its JSON result. */
function convexRun(fn: string, args: Record<string, unknown>): unknown {
  const out = execFileSync(
    'pnpm',
    ['exec', 'convex', 'run', fn, JSON.stringify(args)],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  const lines = out.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    try {
      return JSON.parse(lines.slice(i).join('\n'));
    } catch {
      /* keep scanning upwards */
    }
  }
  return undefined;
}

async function requestDeletionFromSettings(page: Page): Promise<void> {
  await page.goto('/app/settings');
  // Testid-free section: match the translated copy loosely.
  await page
    .getByRole('button', { name: /delete account|konto löschen/i })
    .click();
  await page
    .getByRole('button', { name: /delete my account|konto endgültig|löschen/i })
    .click();
  // Filing the request signs the user out and lands on the marketing page.
  await page.waitForURL(/\/(\?.*)?$|\/auth\//, { timeout: 30_000 });
}

test.describe('account deletion', () => {
  test.describe.configure({ mode: 'serial' });
  // Two full signups + onboarding walks plus the purge itself.
  test.setTimeout(600_000);

  test('request → operator purge → same email restarts from zero', async ({
    page,
  }) => {
    await neutralizeTours(page);

    // ── 1. A real account with real data ─────────────────────────────────
    const creds = await signUpFreshUser(page, {
      prefix: 'delete',
      storageStatePath: 'e2e/.auth/account-deletion-user.json',
      credentialsPath: 'e2e/.auth/account-deletion-user-credentials.json',
    });

    const userId = convexRun('usage/testing:resolveUserId', {
      email: creds.email,
    }) as string;
    expect(typeof userId).toBe('string');

    // ── 2. Guards: no request on file → refused; wrong email → refused ───
    expect(() =>
      convexRun('admin/deleteUser:run', { userId, email: creds.email }),
    ).toThrow(/deletion request|request/i);
    expect(() =>
      convexRun('admin/deleteUser:run', {
        userId,
        email: 'someone-else@flexling.com',
        overrideNoRequest: true,
      }),
    ).toThrow(/mismatch/i);

    // ── 3. The user requests deletion in-app ─────────────────────────────
    await requestDeletionFromSettings(page);
    const requested = convexRun('admin/deleteUser:purgeStatus', { userId }) as {
      status: string;
    };
    expect(requested.status).toBe('requested');

    // ── 4. Operator: dry-run, then the real purge ────────────────────────
    const dry = convexRun('admin/deleteUser:run', {
      userId,
      email: creds.email,
      dryRun: true,
    }) as {
      dryRun: boolean;
      wouldRun: boolean;
      inventory: { courses: number; cards: number };
    };
    expect(dry.wouldRun).toBe(true);
    expect(dry.inventory.courses).toBeGreaterThan(0);
    expect(dry.inventory.cards).toBeGreaterThan(0);

    const result = convexRun('admin/deleteUser:run', {
      userId,
      email: creds.email,
    }) as { deleted: boolean; docsDeleted: number };
    expect(result.deleted).toBe(true);
    expect(result.docsDeleted).toBeGreaterThan(10);

    const completed = convexRun('admin/deleteUser:purgeStatus', { userId }) as {
      status: string;
      phase: string | null;
    };
    expect(completed.status).toBe('completed');

    // Re-running is refused: the account is gone and stays gone.
    expect(() =>
      convexRun('admin/deleteUser:run', { userId, email: creds.email }),
    ).toThrow(/already deleted/i);

    // ── 5. The old session is dead ───────────────────────────────────────
    await page.goto('/app');
    await page.waitForURL(/\/auth\/|\/(\?.*)?$/, { timeout: 30_000 });

    // ── 6. Same email, brand-new life ────────────────────────────────────
    await page.goto('/auth/sign-up');
    await page.waitForLoadState('domcontentloaded');
    const nameField = page.getByLabel(/^name$/i);
    if (await nameField.count()) {
      await nameField.first().fill('Reborn User');
    }
    await page.getByLabel(/email/i).first().fill(creds.email);
    const passwordFields = page.getByLabel(/password/i);
    const passwordCount = await passwordFields.count();
    for (let i = 0; i < passwordCount; i++) {
      await passwordFields.nth(i).fill(`${creds.password}-new`);
    }
    await page
      .getByRole('button', { name: /create an account|create account|^sign\s*up$/i })
      .click();
    // A NEW verification code arrives (the purge wiped the old captures);
    // completing it proves the address was genuinely freed for re-use.
    await completeEmailVerification(page, creds.email);

    // Landing in the onboarding wizard IS the fresh-start assertion:
    // accounts with an existing course are routed straight to the app.
    // Walking it to /app/learn proves the recreated account fully works.
    await completeOnboardingFresh(page, { target: 'fr' });

    const newUserId = convexRun('usage/testing:resolveUserId', {
      email: creds.email,
    }) as string;
    expect(newUserId).not.toBe(userId);
  });
});
