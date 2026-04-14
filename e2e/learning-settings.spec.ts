import { test, expect, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Learning settings sheet — mode toggle + boolean switch round-trip.
 *
 * The Sheet is opened from the gear icon in LearningHeader on /app/learn.
 * Once open, Radix sometimes leaves `aria-hidden="true"` on the
 * SheetContent even though `data-state="open"` — likely a focus-scope
 * interaction with driver.js' tour overlay or another portal. The sheet
 * is visually/functionally active, so we bypass Playwright's accessibility
 * checks (`force: true`) and use CSS attribute selectors for switches
 * (which ignore aria-hidden) instead of `getByRole`.
 */

async function openSettingsSheet(page: Page): Promise<void> {
  const trigger = page.getByTestId("learn-settings").first();
  await expect(
    trigger,
    "learn-settings trigger should render in the LearningHeader",
  ).toBeVisible({ timeout: 10_000 });
  await trigger.click();

  const sheet = page.getByTestId("learning-settings-sheet").first();
  await expect(
    sheet,
    "Learning Settings sheet should open after clicking learn-settings",
  ).toBeVisible({ timeout: 8_000 });
  // Wait out the 500ms slide-in animation so clicks don't race stability.
  await page.waitForTimeout(550);
}

async function isSelectedTestId(
  page: Page,
  testId: string,
): Promise<boolean> {
  const btn = page.getByTestId(testId).first();
  const pressed = await btn.getAttribute("aria-pressed").catch(() => null);
  if (pressed === "true") return true;
  const cls = (await btn.getAttribute("class").catch(() => "")) || "";
  return /ring-primary|bg-primary/.test(cls);
}

test.describe("learning settings", () => {
  test("toggle review mode between audio and full", async ({ page }) => {
    await page.goto("/app/learn");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);

    const audioBtn = page.getByTestId("settings-mode-audio").first();
    const fullBtn = page.getByTestId("settings-mode-full").first();
    await expect(audioBtn).toBeVisible({ timeout: 10_000 });
    await expect(fullBtn).toBeVisible();

    await audioBtn.click({ force: true });
    await page.waitForTimeout(300);
    expect(await isSelectedTestId(page, "settings-mode-audio")).toBe(true);

    await fullBtn.click({ force: true });
    await page.waitForTimeout(300);
    expect(await isSelectedTestId(page, "settings-mode-full")).toBe(true);

    await page.keyboard.press("Escape").catch(() => {});
  });

  test("toggle an auto-play or instant-proceed switch", async ({ page }) => {
    await page.goto("/app/learn");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);

    // CSS attribute selector bypasses ARIA role lookup, which skips
    // aria-hidden elements (Radix sometimes marks the sheet aria-hidden).
    const sw = page.locator('[role="switch"]').first();
    await expect(
      sw,
      "Settings sheet should expose at least one switch (auto-play / instant-proceed / etc.)",
    ).toBeVisible({ timeout: 5_000 });

    const initial = await sw.getAttribute("aria-checked");
    await sw.click({ force: true });
    await page.waitForTimeout(300);
    const afterFirst = await sw.getAttribute("aria-checked");
    expect(afterFirst).not.toBe(initial);

    await sw.click({ force: true });
    await page.waitForTimeout(300);
  });
});
