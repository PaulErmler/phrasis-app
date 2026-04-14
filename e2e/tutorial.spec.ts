import { test, expect } from "@playwright/test";

/**
 * Onboarding tour ("Welcome to Flexling!") — a multi-step driver.js popover
 * that appears on the first /app visit of a fresh user.
 *
 * The tour's completion state persists to Convex `userSettings` as soon as
 * any step fires `onDestroyStarted`. That makes "step-through" and "close"
 * mutually exclusive per user — we can only exercise ONE path per run.
 *
 * This file must run in the dedicated `tutorial` Playwright project (see
 * playwright.config.ts) so it executes BEFORE any spec that calls
 * dismissTour() and marks the tour complete.
 */
test.describe("tutorial (welcome tour)", () => {
  test("welcome tour appears, steps through, and dismisses", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");

    const popover = page.locator(".driver-popover.phrasis-tutorial-home_tour").first();
    await expect(
      popover,
      "home_tour popover should appear on first /app visit (fresh user)",
    ).toBeVisible({ timeout: 10_000 });

    // Step 1 — welcome.
    await expect(popover.getByText(/1\s*of\s*3/i)).toBeVisible();
    await popover.getByRole("button", { name: /next/i }).first().click();

    // Step 2.
    await expect(popover.getByText(/2\s*of\s*3/i)).toBeVisible({
      timeout: 5_000,
    });

    // Close from step 2 via the X button — exercises the close path without
    // needing a second test (which couldn't re-see the tour anyway).
    await popover.locator(".driver-popover-close-btn").first().click();
    await expect(popover).toBeHidden({ timeout: 5_000 });
  });
});
