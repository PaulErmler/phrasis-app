import type { Page } from "@playwright/test";

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
