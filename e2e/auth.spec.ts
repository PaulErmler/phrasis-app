import { test, expect } from "@playwright/test";

/**
 * Auth page smoke — verifies the Better Auth sign-in form mounts.
 *
 * We deliberately browse from a logged-out state; the storage state used
 * by the chromium project would otherwise redirect to /app/onboarding.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("auth pages", () => {
  test("sign-in renders email + password + submit", async ({ page }) => {
    await page.goto("/auth/sign-in");

    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in|log in/i }),
    ).toBeVisible();
  });

  test("sign-up renders form with terms footer", async ({ page }) => {
    await page.goto("/auth/sign-up");

    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 });
    // The TermsFooter component renders links to AGB and Privacy.
    await expect(
      page.getByRole("link", { name: /terms|agb/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /privacy|datenschutz/i }).first(),
    ).toBeVisible();
  });
});
