import { test, expect } from '@playwright/test';

/**
 * Auth page smoke. Verifies the Better Auth sign-in form mounts.
 *
 * We deliberately browse from a logged-out state; the storage state used
 * by the chromium project would otherwise redirect to /app/onboarding.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('auth pages', () => {
  test('sign-in renders email + password + submit', async ({ page }) => {
    await page.goto('/auth/sign-in');

    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/password/i)).toBeVisible();
    // The email/password submit is labeled "Login" (better-auth-ui's
    // SIGN_IN_ACTION default). Anchor the regex so it can never collide with
    // the "Sign in with Google" / "Sign in with Apple" social buttons. The
    // old unanchored /sign in|log in/i actually matched those, never the
    // submit, and went strict-mode-ambiguous when Apple became the second
    // provider.
    await expect(
      page.getByRole('button', { name: /^(login|log in|sign in)$/i }),
    ).toBeVisible();
    // Web auth deliberately offers redirect-based social sign-in (the
    // Capacitor shell swaps these for NativeSocialButtons' token flow).
    await expect(
      page.getByRole('button', { name: /^sign in with google$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^sign in with apple$/i }),
    ).toBeVisible();
    // Entry point of the password-reset flow (email-auth.spec.ts covers
    // the journey itself).
    await expect(
      page.getByRole('link', { name: /forgot.*password|passwort vergessen/i }),
    ).toBeVisible();
  });

  test('forgot-password renders email + submit', async ({ page }) => {
    await page.goto('/auth/forgot-password');

    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /forgot|reset|send/i }),
    ).toBeVisible();
  });

  test('sign-up renders form with terms footer', async ({ page }) => {
    await page.goto('/auth/sign-up');

    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 });
    // The TermsFooter component renders links to AGB and Privacy.
    await expect(
      page.getByRole('link', { name: /terms|agb/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /privacy|datenschutz/i }).first(),
    ).toBeVisible();
  });
});
