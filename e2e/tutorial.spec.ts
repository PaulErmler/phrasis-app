import { test, expect } from "@playwright/test";

/**
 * Home tour ("Welcome to Flexling!") — a multi-step driver.js popover that
 * appears on the first /app visit of a fresh user.
 *
 * The tour was recently split into per-area steps (welcome → Learn New →
 * Review+Learn → Radio (audio mode only) → Audio/Full toggle → content
 * source → difficulty selection). Total step count therefore depends on
 * the active review mode at first landing, so this spec asserts behavior
 * generically: the popover appears, advances through at least two steps,
 * then is dismissable via the X.
 *
 * The tour's completion state persists to Convex `userSettings` as soon
 * as any step fires `onDestroyStarted`. That makes "step-through" and
 * "close" mutually exclusive per user — we can only exercise ONE path
 * per run. This spec runs in the dedicated `tutorial` Playwright project
 * BEFORE any spec that calls dismissTour() and marks the tour complete.
 */
test.describe("tutorial (home tour)", () => {
  test("home tour appears, advances at least one step, and dismisses", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");

    const popover = page.locator(".driver-popover.phrasis-tutorial-home_tour").first();
    await expect(
      popover,
      "home_tour popover should appear on first /app visit (fresh user)",
    ).toBeVisible({ timeout: 15_000 });

    // The progress indicator reads "<i> of <n>" — capture the total once
    // and use it to drive a single Next click before exercising the close
    // path. (Stepping through all of them and then closing would be ideal
    // but the per-step DOM resolution can stall on slow CI, and the close
    // path is what matters for the gate.)
    const progressText = await popover
      .locator(".driver-popover-progress-text")
      .first()
      .textContent()
      .catch(() => null);
    expect(progressText, "popover should show progress text").toMatch(
      /\d+\s*of\s*\d+/i,
    );

    // Advance one step to prove Next works.
    await popover.getByRole("button", { name: /next/i }).first().click();
    await expect(
      popover.locator(".driver-popover-progress-text").first(),
    ).not.toHaveText(progressText ?? "", { timeout: 5_000 });

    // Close via the X — completes the tour.
    await popover.locator(".driver-popover-close-btn").first().click();
    await expect(popover).toBeHidden({ timeout: 5_000 });
  });
});
