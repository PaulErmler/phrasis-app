import { test, expect } from '@playwright/test';

/**
 * Learn surface smoke. The Learn overlay opens on top of the home view.
 *
 * Visiting /app/learn directly causes MainLayout to mount with isLearnOpen,
 * pushing the LearnView component. We assert the overlay container and
 * either a card surface or an empty-state appears.
 */
test.describe('learn view', () => {
  test('learn overlay mounts at /app/learn', async ({ page }) => {
    await page.goto('/app/learn');
    // Wait for app shell. The bottom nav is rendered by MainLayout.
    await page.waitForLoadState('domcontentloaded');

    // The overlay should expose either:
    //   - a "back" / close affordance (always present in LearnView)
    //   - an empty-state ("nothing to review" / "alles erledigt")
    //   - a card front (a button labelled with the prompt language audio)
    const back = page
      .getByRole('button', { name: /back|zurück|close/i })
      .first();
    const empty = page
      .getByText(/nothing to review|all done|fertig|nichts/i)
      .first();
    const reviewControl = page
      .getByRole('button', { name: /show|reveal|good|again|easy|hard/i })
      .first();

    // Wait for any of the three to appear.
    await expect(async () => {
      const visible =
        (await back.isVisible().catch(() => false)) ||
        (await empty.isVisible().catch(() => false)) ||
        (await reviewControl.isVisible().catch(() => false));
      expect(visible).toBe(true);
    }).toPass({ timeout: 20_000 });
  });

  test('shortcuts overlay opens from the header ? icon', async ({ page }) => {
    // Read-only smoke for the keyboard-shortcut legend that shipped with the
    // R/T/Shift+R/← shortcuts: the ? icon in the LearningHeader opens a
    // dialog listing the key chips.
    await page.goto('/app/learn');
    await page.waitForLoadState('domcontentloaded');

    const helpTrigger = page
      .getByRole('button', { name: /help|hilfe/i })
      .first();
    await expect(helpTrigger).toBeVisible({ timeout: 20_000 });
    await helpTrigger.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    // The legend lists the new shortcuts as <kbd> chips. R, T and ← must
    // all be present.
    await expect(
      dialog.locator('kbd', { hasText: /^R$/ }).first(),
    ).toBeVisible();
    await expect(
      dialog.locator('kbd', { hasText: /^T$/ }).first(),
    ).toBeVisible();
    await expect(dialog.locator('kbd', { hasText: '←' }).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });
});
