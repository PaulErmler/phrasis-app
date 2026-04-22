import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Known tutorial identifiers, matching convex/features/tutorialIds.ts plus
 * the two ad-hoc driver instances launched from use-tutorial.ts.
 * Each value maps 1:1 to the `popoverClass` set in `launchDriver` /
 * `showChatStep` / `showCompletionStep` (prefixed with `phrasis-tutorial-`).
 */
export type TourId =
  | "home_tour"
  | "audio_review_intro"
  | "full_review_intro"
  | "chat"
  | "completion";

/**
 * Dismiss a driver.js onboarding popover. When `id` is provided, only the
 * matching tour (by `popoverClass="phrasis-tutorial-<id>"`) is targeted;
 * otherwise any `.driver-popover` is dismissed. Always strips any lingering
 * `.driver-overlay` SVG so the backdrop never intercepts subsequent clicks.
 */
export async function dismissTour(
  page: Page,
  id?: TourId,
  waitMs = 2500,
): Promise<void> {
  const selector = id
    ? `.driver-popover.phrasis-tutorial-${id}`
    : ".driver-popover";

  const nukeOverlays = () =>
    page
      .evaluate(() => {
        document.querySelectorAll(".driver-overlay").forEach((el) => el.remove());
      })
      .catch(() => {});

  const popover = page.locator(selector).first();

  try {
    await popover.waitFor({ state: "visible", timeout: waitMs });
  } catch {
    await nukeOverlays();
    return;
  }

  const closeBtn = popover.locator(".driver-popover-close-btn").first();
  if (await closeBtn.count()) {
    await closeBtn.click().catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await popover.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});

  const overlay = page.locator(".driver-overlay").first();
  await overlay
    .waitFor({ state: "detached", timeout: 3_000 })
    .catch(nukeOverlays);
}

/**
 * Open the card batch-import UI: navigate, dismiss the home tour, switch to
 * the "import" tab and wait for the paste textarea to render. Shared by the
 * UI-only and live import specs.
 */
export async function openCardImport(page: Page): Promise<void> {
  await page.goto("/app/content/add-cards");
  // `domcontentloaded` fires before client-side route resolves in Next dev —
  // wait for the URL to actually equal the target, then for AddCardsView to
  // mount. The individual tab is the default mode; its presence proves the
  // switcher is rendered (i.e. `isAddCardsRoute` is true in MainLayout).
  await page.waitForURL("**/app/content/add-cards", { timeout: 20_000 });
  await dismissTour(page);
  const individualTab = page.getByTestId("add-cards-mode-individual");
  try {
    await expect(individualTab).toBeVisible({ timeout: 20_000 });
  } catch (err) {
    // One retry: in Next dev, the first hit of a route can stall on
    // on-demand compilation under parallel worker load. A hard reload picks
    // up the now-compiled bundle instantly.
    await page.reload();
    await page.waitForURL("**/app/content/add-cards", { timeout: 20_000 });
    await dismissTour(page);
    await expect(individualTab).toBeVisible({ timeout: 20_000 });
  }
  await page.getByTestId("add-cards-mode-import").click();
  await expect(page.getByTestId("import-paste")).toBeVisible({ timeout: 20_000 });
}

/**
 * Fill the import paste textarea and wait until the controller has parsed
 * the input (step 1 becomes enabled once at least one row is detected).
 */
export async function pasteImport(page: Page, text: string): Promise<void> {
  await page.getByTestId("import-paste").fill(text);
  await expect(page.getByTestId("import-step-1")).toBeEnabled({
    timeout: 10_000,
  });
}
