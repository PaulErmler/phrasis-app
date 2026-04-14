import { test, expect } from "@playwright/test";

/**
 * Onboarding flow smoke.
 *
 * The test user in this suite has already completed onboarding (see
 * e2e/auth.setup.ts), so navigating to /app/onboarding/onboarding_steps
 * should ALWAYS redirect away. That's the behavior we assert — onboarding
 * must be gated for already-onboarded users.
 */
test.describe("onboarding wizard", () => {
  test("already-onboarded user is redirected away from onboarding", async ({
    page,
  }) => {
    await page.goto("/app/onboarding");
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    await expect
      .poll(() => /onboarding/.test(page.url()), { timeout: 10_000 })
      .toBe(false);
    expect(page.url()).toMatch(/\/app\b/);
  });
});
