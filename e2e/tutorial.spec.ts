import { test, expect } from '@playwright/test';

/**
 * Home tour ("Welcome to Flexling!"), a multi-step driver.js popover that
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
 * "close" mutually exclusive per user. We can only exercise ONE path
 * per run. This spec runs in the dedicated `tutorial` Playwright project
 * BEFORE any spec that calls dismissTour() and marks the tour complete.
 */
test.describe('tutorial (home tour)', () => {
  test('home tour appears, advances at least one step, and dismisses', async ({
    page,
  }) => {
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');

    const popover = page
      .locator('.driver-popover.phrasis-tutorial-home_tour')
      .first();
    await expect(
      popover,
      'home_tour popover should appear on first /app visit (fresh user)',
    ).toBeVisible({ timeout: 15_000 });

    // The progress indicator reads "<i> of <n>". Capture the total once
    // and use it to drive a single Next click before exercising the close
    // path. (Stepping through all of them and then closing would be ideal
    // but the per-step DOM resolution can stall on slow CI, and the close
    // path is what matters for the gate.)
    const progressText = await popover
      .locator('.driver-popover-progress-text')
      .first()
      .textContent()
      .catch(() => null);
    expect(progressText, 'popover should show progress text').toMatch(
      /\d+\s*of\s*\d+/i,
    );

    // The tour recently grew mode-aware free-play, due-counts and
    // projections steps. A shrunken total means a step silently fell out
    // of the registry (welcome, Learn New, Learn+Review, Radio/Free Study,
    // mode toggle, content source, due counts, projections, difficulty,
    // closing CTA ⇒ 10 in audio mode).
    const totalSteps = Number(progressText!.match(/of\s*(\d+)/i)?.[1] ?? 0);
    expect(
      totalSteps,
      'home tour should include the due-counts and projections steps',
    ).toBeGreaterThanOrEqual(9);

    // Advance one step to prove Next works.
    await popover.getByRole('button', { name: /next/i }).first().click();
    await expect(
      popover.locator('.driver-popover-progress-text').first(),
    ).not.toHaveText(progressText ?? '', { timeout: 5_000 });

    // Close via the X. Completes the tour.
    await popover.locator('.driver-popover-close-btn').first().click();
    await expect(popover).toBeHidden({ timeout: 5_000 });

    // Regression ("Dashboard tutorial shows up again", 2026-08-03): a
    // completed tour must STAY completed. The suppress-complete path added
    // for mid-tour navigation must not swallow real dismissals. Reload and
    // give the auto-start delay (1.2s) plus margin to prove it stays away.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);
    await expect(
      page.locator('.driver-popover.phrasis-tutorial-home_tour'),
      'home tour must not re-show after being completed',
    ).toBeHidden();
  });
});
