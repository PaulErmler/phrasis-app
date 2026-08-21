import { test, expect } from '@playwright/test';
import { dismissTour } from './helpers';

/**
 * Mutating tests for the content-source filter dropdown. Runs in the
 * chromium-serial project because flipping the filter mid-test changes
 * shared user state. Concurrent tests would race for the value.
 *
 * Each test resets the filter to "Both" in afterEach so subsequent specs
 * see the same baseline.
 *
 * NOTE: the `home_tour` driver.js overlay highlights the very element
 * these tests click (`[data-tutorial="content-source-filter"]`, see
 * `lib/tutorials/home-tour.ts`). Without an explicit dismiss the SVG
 * backdrop intercepts every click. `beforeEach` lands on `/app` once and
 * tears the overlay down before any per-test interaction begins.
 */

test.describe(
  'content filter — mutating dropdown flows (live)',
  { tag: '@live' },
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/app');
      await page.waitForLoadState('domcontentloaded');
      await dismissTour(page, 'home_tour');
    });

    test.afterEach(async ({ page }) => {
      // Best-effort reset. The test body may have re-fired the tour (a
      // route bounce, re-mount, etc.); strip it again before touching the
      // trigger so the SVG backdrop doesn't intercept the click.
      await dismissTour(page).catch(() => {});
      const trigger = page.getByTestId('content-filter-trigger');
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click();
        const bothOpt = page.getByTestId('content-filter-option-both');
        if (await bothOpt.isVisible().catch(() => false)) {
          await bothOpt.click();
          await page.waitForTimeout(200);
        } else {
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
    });

    test('trigger keeps a fixed width across all three selections', async ({
      page,
    }) => {
      const trigger = page.getByTestId('content-filter-trigger');
      await expect(trigger).toBeVisible({ timeout: 10_000 });

      const widths: number[] = [];
      for (const optionTestId of [
        'content-filter-option-both',
        'content-filter-option-custom',
        'content-filter-option-course',
      ]) {
        await trigger.click();
        await page.getByTestId(optionTestId).click();
        await page.waitForTimeout(200);
        const box = await trigger.boundingBox();
        expect(box).not.toBeNull();
        widths.push(box!.width);
      }

      // All three widths should be within ~1px of each other. The trigger's
      // fixed-width class is the contract being verified.
      const min = Math.min(...widths);
      const max = Math.max(...widths);
      expect(max - min).toBeLessThan(2);
    });

    test("setting filter to 'course' shows the Off pill on the Custom tab only", async ({
      page,
    }) => {
      const trigger = page.getByTestId('content-filter-trigger');
      await expect(trigger).toBeVisible({ timeout: 10_000 });

      await trigger.click();
      await page.getByTestId('content-filter-option-course').click();
      await page.waitForTimeout(300);

      // Exactly one Off pill, on the excluded (Custom Content) tab.
      await expect(page.getByTestId('source-badge-off')).toHaveCount(1);
    });

    test("setting filter to 'custom' shows the Off pill on the Course tab only", async ({
      page,
    }) => {
      const trigger = page.getByTestId('content-filter-trigger');
      await expect(trigger).toBeVisible({ timeout: 10_000 });

      await trigger.click();
      await page.getByTestId('content-filter-option-custom').click();
      await page.waitForTimeout(300);

      await expect(page.getByTestId('source-badge-off')).toHaveCount(1);
    });

    test('clicking the Off pill on the currently-selected tab opens a re-enable popover', async ({
      page,
    }) => {
      // Set filter to 'custom' → Course tab gets the Off pill.
      const trigger = page.getByTestId('content-filter-trigger');
      await trigger.click();
      await page.getByTestId('content-filter-option-custom').click();
      await page.waitForTimeout(300);

      const offPill = page.getByTestId('source-badge-off');
      await expect(offPill).toBeVisible();

      // The default selected tab is 'premade' (Course). Pill should open the
      // popover instead of switching tabs (no tab switch happens because we
      // were already on the Course tab, verify the re-enable CTA appears).
      await offPill.click();
      await expect(page.getByTestId('source-badge-reenable')).toBeVisible({
        timeout: 5_000,
      });

      // Clicking re-enable wipes the Off pill and resets the filter to 'both'.
      await page.getByTestId('source-badge-reenable').click();
      await page.waitForTimeout(300);
      await expect(page.getByTestId('source-badge-off')).toHaveCount(0);
    });
  },
);
