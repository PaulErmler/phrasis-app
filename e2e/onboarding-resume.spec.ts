import { test, expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { completeEmailVerification } from './helpers';
import { convexRun } from './convex-hooks';

/**
 * Two onboarding behaviours no finished fixture user can show:
 *
 *   1. The "other" free text on the prior-apps step belongs to the "other"
 *      option. Dropping that option (or picking "none") drops the text, so
 *      the signup notification never reads `none, "Memrise"`.
 *   2. A progress row saved under an older step order resumes on the right
 *      step. Step 7 was review-mode before `prior-apps` was inserted at 3;
 *      such rows carry no `priorApps`, and the wizard must reopen on
 *      review-mode, not on the level picker (which would overwrite a
 *      finished placement with the slider). No UI can produce such a row
 *      any more, so the E2E hook plants one.
 *
 * Own fresh user, empty storageState, never finishes onboarding. Requires
 * E2E_TEST_HOOKS=1 (global-setup) for the auth-email capture and the hook.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const random = crypto.randomBytes(6).toString('hex');
const creds = {
  // Shape is load-bearing: see `isE2EFixtureAddress` in convex/lib/authEmails.ts.
  email: `e2e-resume-${Date.now()}-${random}@flexling.com`,
  password: `E2ePass!${random}`,
  name: `E2E resume ${random}`,
};

/** Sign up and verify, landing on the first wizard step. */
async function signUpWithoutOnboarding(page: Page): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.waitForLoadState('domcontentloaded');
  const nameField = page.getByLabel(/^name$/i);
  if (await nameField.count()) await nameField.first().fill(creds.name);
  await page.getByLabel(/email/i).first().fill(creds.email);
  const passwordFields = page.getByLabel(/password/i);
  const passwordCount = await passwordFields.count();
  for (let i = 0; i < passwordCount; i++) {
    await passwordFields.nth(i).fill(creds.password);
  }
  const acceptCookies = page.getByTestId('consent-accept').first();
  await acceptCookies
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => acceptCookies.click())
    .catch(() => {});
  await page
    .getByRole('button', {
      name: /create an account|create account|^sign\s*up$/i,
    })
    .click();
  await completeEmailVerification(page, creds.email);
  await expect(page.getByTestId('onboarding-step-language-pair')).toBeVisible({
    timeout: 30_000,
  });
}

/** Each test starts from an empty storage state, so the second signs in. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.waitForLoadState('domcontentloaded');
  const acceptCookies = page.getByTestId('consent-accept').first();
  await acceptCookies
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => acceptCookies.click())
    .catch(() => {});
  await page.getByLabel(/email/i).first().fill(creds.email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(creds.password);
  await page.getByRole('button', { name: /^(login|sign in)$/i }).click();
  await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 30_000 });
}

test.describe('onboarding resume', () => {
  test('deselecting "other" on the prior-apps step clears its free text', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signUpWithoutOnboarding(page);

    // Walk to the prior-apps step the same way the fixture setup does.
    await page.getByTestId('language-option-es').first().click();
    await page.getByTestId('language-option-en').first().click();
    await page.getByTestId('onboarding-continue').click();
    await expect(page.getByTestId('onboarding-step-acquisition')).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId('acquisition-option-other').click();
    await page.getByTestId('onboarding-continue').click();
    await expect(page.getByTestId('onboarding-step-prior-apps')).toBeVisible({
      timeout: 20_000,
    });

    const other = page.getByTestId('prior-apps-option-other');
    const input = page.getByTestId('prior-apps-other-input');
    await other.click();
    await expect(input).toBeVisible();
    await input.fill('Memrise');
    await expect(input).toHaveValue('Memrise');

    // Picking "none" drops every other option, "other" included, and the
    // text with it.
    await page.getByTestId('prior-apps-option-none').click();
    await expect(input).toBeHidden();
    await other.click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('');

    // Deselecting "other" directly clears it too.
    await input.fill('Anki');
    await other.click();
    await expect(input).toBeHidden();
    await other.click();
    await expect(input).toHaveValue('');
  });

  test('a legacy step-7 row resumes on review-mode, not the level picker', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    convexRun('features/onboardingTesting:seedLegacyProgress', {
      email: creds.email,
      step: 7,
    });

    await signIn(page);
    await page.goto('/app/onboarding');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('onboarding-step-review-mode')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('onboarding-step-cefr-pick')).toHaveCount(0);
  });
});
