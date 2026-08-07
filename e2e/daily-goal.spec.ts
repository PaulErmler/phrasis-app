import { test, expect, type Page } from '@playwright/test';
import { dismissConsent, dismissTour, expectSignedIn } from './helpers';

/**
 * Daily-goal ring + quick-edit on the home screen (chromium-serial: mutates
 * the shared user's course settings; every test restores what it changed).
 *
 * The goal row (`daily-goal-row`, or `daily-goal-set-cta` when unset) opens
 * the DailyGoalQuickEdit popover: preset tiles apply immediately, the custom
 * input applies on Set. Writes go through updateCourseSettings with an
 * optimistic update, so the row re-renders instantly and persists.
 */

async function openHome(page: Page): Promise<void> {
  await page.goto('/app');
  await expectSignedIn(page);
  await dismissConsent(page);
  await dismissTour(page, undefined, 500);
}

/** The goal row's "N / M min" label → M (the goal), or null on the set-CTA. */
async function readGoalMinutes(page: Page): Promise<number | null> {
  const row = page.getByTestId('daily-goal-row');
  if (!(await row.isVisible().catch(() => false))) return null;
  const text = await row.innerText();
  const match = text.match(/\/\s*(\d+)\s*min/i);
  return match ? Number(match[1]) : null;
}

async function openQuickEdit(page: Page): Promise<void> {
  const trigger = page
    .getByTestId('daily-goal-row')
    .or(page.getByTestId('daily-goal-set-cta'))
    .first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  await expect(page.getByTestId('daily-goal-popover')).toBeVisible({
    timeout: 8_000,
  });
}

test.describe('daily goal quick-edit', () => {
  test('preset applies instantly, persists across reload, and restores', async ({
    page,
  }) => {
    await openHome(page);
    const original = await readGoalMinutes(page);

    // Pick a preset that differs from the current goal.
    const target = original === 30 ? 10 : 30;
    await openQuickEdit(page);
    await page.getByTestId(`daily-goal-preset-${target}`).click();
    await expect
      .poll(() => readGoalMinutes(page), { timeout: 8_000 })
      .toBe(target);

    // Server persistence, not just the optimistic cache.
    await page.reload();
    await dismissTour(page, undefined, 500);
    await expect
      .poll(() => readGoalMinutes(page), { timeout: 15_000 })
      .toBe(target);

    // Leave the shared user as found (original may be a non-preset custom
    // value — restore via the custom input to cover any value).
    if (original != null && original !== target) {
      await openQuickEdit(page);
      const custom = page.getByTestId('daily-goal-custom-input');
      await custom.fill(String(original));
      await page
        .getByTestId('daily-goal-popover')
        .getByRole('button', { name: /set/i })
        .click();
      await expect
        .poll(() => readGoalMinutes(page), { timeout: 8_000 })
        .toBe(original);
    }
  });

  test('custom value applies via the Set button and restores', async ({
    page,
  }) => {
    await openHome(page);
    const original = await readGoalMinutes(page);
    test.skip(
      original == null,
      'course has no goal set — covered by the CTA state',
    );

    await openQuickEdit(page);
    const custom = page.getByTestId('daily-goal-custom-input');
    await custom.fill('45');
    await page
      .getByTestId('daily-goal-popover')
      .getByRole('button', { name: /set/i })
      .click();
    await expect.poll(() => readGoalMinutes(page), { timeout: 8_000 }).toBe(45);

    // Restore.
    await openQuickEdit(page);
    await custom.fill(String(original));
    await page
      .getByTestId('daily-goal-popover')
      .getByRole('button', { name: /set/i })
      .click();
    await expect
      .poll(() => readGoalMinutes(page), { timeout: 8_000 })
      .toBe(original);
  });
});
