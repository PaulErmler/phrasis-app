import { test, expect, type Page, type Locator } from "@playwright/test";
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

/**
 * Poll until a locator's bounding box is fully inside the viewport.
 * Necessary for elements inside the Sheet: between mode-button clicks the
 * Sheet briefly re-animates (likely Radix focus-management round-tripping
 * the `data-state` attribute), leaving the next mode button mid-transform
 * for ~500ms. `force: true` doesn't bypass the viewport check, and the
 * element is `position: fixed` so Playwright's auto-scroll can't bring it
 * in. Polling the bounding box lets us wait out the animation deterministically.
 */
async function waitForInViewport(
  page: Page,
  locator: ReturnType<Page["getByTestId"]>,
  timeoutMs = 5_000,
): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        if (!box) return false;
        return (
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width &&
          box.y + box.height <= viewport.height
        );
      },
      { timeout: timeoutMs, intervals: [100, 200, 400] },
    )
    .toBe(true);
}

/** Ensure the settings sheet is in Audio review mode (the Practice Listening /
 *  Speaking toggles only render there). No-op if already selected. */
async function ensureAudioMode(page: Page): Promise<void> {
  const audioBtn = page.getByTestId("settings-mode-audio").first();
  await expect(audioBtn).toBeVisible({ timeout: 10_000 });
  if (!(await isSelectedTestId(page, "settings-mode-audio"))) {
    await waitForInViewport(page, audioBtn);
    await audioBtn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, "settings-mode-audio"), {
        timeout: 5_000,
      })
      .toBe(true);
  }
}

// The two Practice toggles are Radix switches; target them by their `id`
// (CSS selectors ignore the aria-hidden Radix sometimes sets on the sheet).
function practiceSwitch(page: Page, which: "before" | "after"): Locator {
  return page.locator(
    which === "before" ? "#playTargetBeforeBase" : "#playTargetAfterBase",
  );
}

async function isSwitchOn(
  page: Page,
  which: "before" | "after",
): Promise<boolean> {
  return (
    (await practiceSwitch(page, which).getAttribute("aria-checked")) === "true"
  );
}

/** Poll the switch's checked state (toggles persist via a Convex mutation, so
 *  the rendered state settles asynchronously after the click). */
async function expectSwitch(
  page: Page,
  which: "before" | "after",
  on: boolean,
): Promise<void> {
  await expect.poll(() => isSwitchOn(page, which), { timeout: 8_000 }).toBe(on);
}

/** Click the switch and wait until it reaches the desired checked state. Turning
 *  a switch ON never disables the other, so this is safe for normalization. */
async function setSwitch(
  page: Page,
  which: "before" | "after",
  on: boolean,
): Promise<void> {
  if ((await isSwitchOn(page, which)) === on) return;
  await practiceSwitch(page, which).click({ force: true });
  await expectSwitch(page, which, on);
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

    // Wait for both buttons to be fully in viewport before each click.
    // The Sheet may re-animate after a mode change (see waitForInViewport
    // docstring) so the second click in particular needs to wait for the
    // Sheet to settle, not just for a fixed 300ms.
    await waitForInViewport(page, audioBtn);
    await audioBtn.click({ force: true });
    await page.waitForTimeout(300);
    expect(await isSelectedTestId(page, "settings-mode-audio")).toBe(true);

    await waitForInViewport(page, fullBtn);
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
    // The sheet is position:fixed and re-animates on open, so `force: true`
    // alone can't bring the switch into the viewport — wait for it to settle
    // (same guard the mode-toggle test uses on its buttons).
    await waitForInViewport(page, sw);
    await sw.click({ force: true });
    await page.waitForTimeout(300);
    const afterFirst = await sw.getAttribute("aria-checked");
    expect(afterFirst).not.toBe(initial);

    await waitForInViewport(page, sw);
    await sw.click({ force: true });
    await page.waitForTimeout(300);
  });

  test("Practice Listening / Speaking toggles render and persist", async ({
    page,
  }) => {
    await page.goto("/app/learn");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);
    await ensureAudioMode(page);

    // Both toggles are present in audio mode.
    await expect(practiceSwitch(page, "before")).toBeVisible({ timeout: 8_000 });
    await expect(practiceSwitch(page, "after")).toBeVisible();

    // Start from the default-ish state (Listening off, Speaking on).
    await setSwitch(page, "after", true);
    await setSwitch(page, "before", false);

    // Enable Practice Listening, then confirm it survives a sheet close/reopen.
    await practiceSwitch(page, "before").click({ force: true });
    await expectSwitch(page, "before", true);

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    await openSettingsSheet(page);
    await ensureAudioMode(page);
    await expectSwitch(page, "before", true);

    // Restore the default so later serial specs start clean.
    await practiceSwitch(page, "before").click({ force: true });
    await expectSwitch(page, "before", false);
    await expectSwitch(page, "after", true);

    await page.keyboard.press("Escape").catch(() => {});
  });

  test("Practice toggles keep at least one enabled (mutual exclusion)", async ({
    page,
  }) => {
    await page.goto("/app/learn");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);
    await ensureAudioMode(page);

    // Normalize to BOTH on (turning a switch on never disables the other).
    await setSwitch(page, "before", true);
    await setSwitch(page, "after", true);
    await expectSwitch(page, "before", true);
    await expectSwitch(page, "after", true);

    // Turn Listening off — Speaking is unaffected (not the last-on toggle).
    await setSwitch(page, "before", false);
    await expectSwitch(page, "after", true);

    // Turn Speaking off while Listening is already off → Listening auto-enables
    // (the invariant: the two can never both be off).
    await practiceSwitch(page, "after").click({ force: true });
    await expectSwitch(page, "after", false);
    await expectSwitch(page, "before", true);

    // And the mirror: turning the now-last-on Listening off re-enables Speaking.
    await practiceSwitch(page, "before").click({ force: true });
    await expectSwitch(page, "before", false);
    await expectSwitch(page, "after", true); // back to the default → clean state

    await page.keyboard.press("Escape").catch(() => {});
  });
});
