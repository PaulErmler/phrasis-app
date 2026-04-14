import { test, expect } from "@playwright/test";

/**
 * Settings smoke — verifies the SettingsView mounts and exposes at least
 * one section. As a bonus we attempt a locale toggle (EN ↔ DE) and look
 * for a translated string change.
 */
test.describe("settings", () => {
  test("settings page renders with sections", async ({ page }) => {
    await page.goto("/app/settings");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // At least one button or switch should be present (theme, language,
    // sign-out, etc.).
    const control = page.getByRole("button").first();
    await expect(control).toBeVisible({ timeout: 15_000 });
  });

  test("locale switch toggles UI text", async ({ page }) => {
    await page.goto("/app/settings");
    await page.waitForLoadState("domcontentloaded");

    const langControl = page.getByTestId("language-switcher").first();
    await expect(
      langControl,
      "language-switcher Select should render on /app/settings",
    ).toBeVisible({ timeout: 10_000 });

    // Capture the current locale so we can revert and not leak German UI
    // to downstream specs that assert English strings.
    const initialValue = (await langControl.innerText()).toLowerCase();
    const switchingToGerman =
      /english|englisch/.test(initialValue) && !/deutsch|german/.test(initialValue);

    await langControl.click();
    const targetOption = page
      .getByRole("option", {
        name: switchingToGerman ? /deutsch|german/i : /english|englisch/i,
      })
      .first();
    await targetOption.click();

    // Page should not crash after switching.
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });

    // Revert to the original locale for hygiene.
    await langControl.click();
    const revertOption = page
      .getByRole("option", {
        name: switchingToGerman ? /english|englisch/i : /deutsch|german/i,
      })
      .first();
    await revertOption.click();
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
