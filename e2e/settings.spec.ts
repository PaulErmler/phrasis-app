import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ensureTogglesSaved, neutralizeTours } from './helpers';

/**
 * Settings smoke. Verifies the SettingsView mounts and exposes at least
 * one section. As a bonus we attempt a locale toggle (EN ↔ DE) and look
 * for a translated string change. Also covers the change-password dialog
 * using the shared fixture user's saved credentials (the password is
 * changed and then changed back, so downstream state stays intact).
 *
 * Lives in the `settings-serial` Playwright project (workers:1, after
 * chromium-serial) because changePassword uses revokeOtherSessions and
 * must not race other shared-fixture specs.
 */
test.describe('settings', () => {
  // driver.js tours can mount at any moment after hydration and their
  // overlay intercepts pointer events page-wide (see helpers.ts).
  test.beforeEach(async ({ page }) => {
    await neutralizeTours(page);
  });

  test('settings page renders with sections', async ({ page }) => {
    await page.goto('/app/settings');
    await page.waitForLoadState('domcontentloaded');

    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // At least one button or switch should be present (theme, language,
    // sign-out, etc.).
    const control = page.getByRole('button').first();
    await expect(control).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('#showDueCounts')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('the workload forecast has its own visibility switch, independent of due counts', async ({
    page,
  }) => {
    // Four reload-confirmed toggle cycles plus four home visits do not fit
    // the 30s default when the local backend is still digesting the @live
    // serial phase.
    test.setTimeout(120_000);

    // Ensure a known starting state: both Show toggles on. (Both surfaces
    // are hidden by default; showing is an explicit opt-in.)
    // `ensureTogglesSaved` clicks toward the desired state and re-issues
    // the click if the confirming reload killed the un-acked mutation —
    // see the helper's comment for the lost-write race this replaces.
    await page.goto('/app/settings');
    const dueToggle = page.locator('#showDueCounts');
    const forecastToggle = page.locator('#showWorkloadForecast');
    await expect(dueToggle).toBeVisible({ timeout: 15_000 });
    await expect(forecastToggle).toBeVisible();

    await ensureTogglesSaved(page, [
      { toggle: dueToggle, on: true },
      { toggle: forecastToggle, on: true },
    ]);

    // The forecast card is on home whenever its own toggle is on.
    await page.goto('/app');
    await expect(page.getByTestId('due-counts-pills')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('workload-forecast')).toBeVisible();

    // Turning the due-counts toggle back off hides the pills but leaves
    // the forecast alone.
    await page.goto('/app/settings');
    await ensureTogglesSaved(page, [{ toggle: dueToggle, on: false }]);
    await page.goto('/app');
    await expect(page.getByTestId('due-counts-pills')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('workload-forecast')).toBeVisible();

    // Turning the forecast's own switch off removes the card.
    await page.goto('/app/settings');
    await ensureTogglesSaved(page, [{ toggle: forecastToggle, on: false }]);
    await page.goto('/app');
    await expect(page.getByTestId('workload-forecast')).toHaveCount(0, {
      timeout: 15_000,
    });

    // Turn both back on so downstream shared-fixture specs that assert on
    // the pills (via the showDueCounts helper) start from a visible state
    // (same courtesy as the change-password test).
    await page.goto('/app/settings');
    await ensureTogglesSaved(page, [
      { toggle: dueToggle, on: true },
      { toggle: forecastToggle, on: true },
    ]);
    await page.goto('/app');
    await expect(page.getByTestId('due-counts-pills')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('change password via the settings dialog', async ({ page }) => {
    // Three live better-auth round trips (wrong password, change, change
    // back) plus the consent-banner wait don't reliably fit the 30s default.
    test.setTimeout(60_000);

    // The shared fixture user was created by auth.setup.ts, which saves
    // its credentials next to the storage state.
    const credsPath = path.resolve(__dirname, '.auth/credentials-a.json');
    const { password } = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
      password: string;
    };
    const tempPassword = `${password}X1`;

    // Locale-proof: field/toast copy is translated, so drive the dialog by
    // testids and input ids.
    const currentField = () => page.locator('#current-password');
    const newField = () => page.locator('#new-password');
    const confirmField = () => page.locator('#confirm-password');
    const save = () => page.getByTestId('settings-change-password-save');

    const changePassword = async (from: string, to: string) => {
      // The dialog has a 200ms exit animation and Radix keeps the content
      // mounted (plus `pointer-events: none` on <body>) for its duration.
      // Flipping `open` back to true inside that window leaves Presence
      // stuck. The click lands, but the content never re-mounts. Wait for
      // the previous instance to be fully gone before re-opening.
      await expect(currentField()).toBeHidden({ timeout: 10_000 });
      await page.getByTestId('settings-change-password').click();
      await expect(currentField()).toBeVisible({ timeout: 10_000 });
      await currentField().fill(from);
      await newField().fill(to);
      await confirmField().fill(to);
      await save().click();
      await expect(
        page.getByText(/password changed|passwort geändert/i).first(),
      ).toBeVisible({ timeout: 15_000 });
      // Success closes the dialog.
      await expect(currentField()).toBeHidden({ timeout: 10_000 });
    };

    await page.goto('/app/settings');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('settings-change-password')).toBeVisible({
      timeout: 15_000,
    });

    // The consent banner is fixed to the bottom edge and intercepts clicks
    // on the dialog's footer buttons when it mounts (PostHog boots async.
    // Bounded wait, same pattern as auth.setup.ts). Accepting here also
    // persists the decision into the storageState saved below.
    const acceptCookies = page.getByTestId('consent-accept').first();
    await acceptCookies
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => acceptCookies.click())
      .catch(() => {}); // no banner: PostHog key absent or already answered

    // Wrong current password → error toast, dialog stays open.
    await page.getByTestId('settings-change-password').click();
    await currentField().fill(`wrong-${password}`);
    await newField().fill(tempPassword);
    await confirmField().fill(tempPassword);
    await save().click();
    await expect(
      page.getByText(/could not change|konnte nicht geändert/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(currentField()).toBeVisible();
    // Close and retry cleanly with the real password.
    await page.keyboard.press('Escape');

    await changePassword(password, tempPassword);
    // Change it back so the saved credentials stay valid.
    await changePassword(tempPassword, password);

    // CRITICAL: changePassword with revokeOtherSessions rotates the
    // session cookie. The stored fixture still holds the old, now-revoked
    // token, which would silently log out every later spec. Persist the
    // fresh session over it. This file runs in the settings-serial project
    // (after chromium-serial) so the revoke cannot race concurrent live specs.
    await page.context().storageState({
      path: path.resolve(__dirname, '.auth/user.json'),
    });
  });

  test('locale switch toggles UI text', async ({ page }) => {
    await page.goto('/app/settings');
    await page.waitForLoadState('domcontentloaded');

    const langControl = page.getByTestId('language-switcher').first();
    await expect(
      langControl,
      'language-switcher Select should render on /app/settings',
    ).toBeVisible({ timeout: 10_000 });

    // Capture the current locale so we can revert and not leak German UI
    // to downstream specs that assert English strings.
    const initialValue = (await langControl.innerText()).toLowerCase();
    const switchingToGerman =
      /english|englisch/.test(initialValue) &&
      !/deutsch|german/.test(initialValue);

    await langControl.click();
    const targetOption = page
      .getByRole('option', {
        name: switchingToGerman ? /deutsch|german/i : /english|englisch/i,
      })
      .first();
    await targetOption.click();

    // A real translated string must change, not just "the page didn't
    // crash": the UI-settings section heading is stable copy in both
    // locales (en "UI Settings" / de "UI-Einstellungen").
    await expect(
      page.getByText(switchingToGerman ? 'UI-Einstellungen' : 'UI Settings', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });

    // Revert to the original locale for hygiene.
    await langControl.click();
    const revertOption = page
      .getByRole('option', {
        name: switchingToGerman ? /english|englisch/i : /deutsch|german/i,
      })
      .first();
    await revertOption.click();
    await expect(
      page.getByText(switchingToGerman ? 'UI Settings' : 'UI-Einstellungen', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
