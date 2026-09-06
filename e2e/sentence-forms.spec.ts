import { test, expect, type Page } from '@playwright/test';
import { dismissTour } from './helpers';

/**
 * The sentence-form settings in the course languages sheet
 * (components/course/CourseLanguageSettings.tsx): first-person forms as a
 * radio group, politeness as checkbox rows when a target language marks it.
 * The fixture user's course (from auth.setup.ts) is German-target, so two
 * politeness rows show and the third global level stays hidden.
 *
 * The onboarding steps themselves are covered by the wizard walker in
 * e2e/helpers.ts, which every fresh-signup spec runs through.
 */

async function openLanguagesSheet(page: Page) {
  const sheet = page.getByRole('dialog', { name: /your courses/i }).first();
  if (!(await sheet.isVisible().catch(() => false))) {
    await page.getByTestId('course-menu-trigger').first().click();
    await expect(sheet).toBeVisible({ timeout: 5_000 });
  }
  await page.getByTestId('course-settings').first().click();
  const manageSheet = page.getByTestId('course-settings-sheet').first();
  await expect(manageSheet).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(550); // slide-in
  return manageSheet;
}

test.describe('sentence-form settings', () => {
  test('first-person forms and politeness rows save and reload', async ({
    page,
  }) => {
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);
    await openLanguagesSheet(page);

    const forms = page.getByTestId('course-forms');
    await expect(forms).toBeVisible({ timeout: 10_000 });

    // Legacy display: nothing stored yet shows "both".
    await expect(page.getByTestId('course-forms-both')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByTestId('course-forms-feminine').click();
    await expect(page.getByTestId('course-forms-feminine')).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 10_000 },
    );

    // A German-only target shows two rows (casual = du, formal = Sie), both
    // ticked for a course without a stored set. Unticking one keeps the
    // other; unticking the last is refused.
    const rows = page.locator('[data-testid^="politeness-"][role="checkbox"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'false', {
      timeout: 10_000,
    });
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');

    // Survives a reload: the values come back from the server.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);
    await openLanguagesSheet(page);
    await expect(page.getByTestId('course-forms-feminine')).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 10_000 },
    );
    await expect(
      page.locator('[data-testid^="politeness-"][role="checkbox"]').nth(1),
    ).toHaveAttribute('aria-checked', 'false');

    // Restore the defaults so later specs see the pre-feature behaviour.
    await page.getByTestId('course-forms-both').click();
    await page
      .locator('[data-testid^="politeness-"][role="checkbox"]')
      .nth(1)
      .click();
  });
});
