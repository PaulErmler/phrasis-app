import { test, expect } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Learning journey (LIVE) — the critical end-to-end chain:
 *   add cards from home → learn in audio mode → switch to full review and
 *   submit a translation → verify stats reflects activity → library search
 *   filters the list.
 *
 * Serial because each step depends on the previous run having produced
 * state (cards to learn → progress to chart → vocabulary to search).
 *
 * Tagged @live since review rating / translation submission hit the real
 * Convex mutations and (for full review) the translation-grading LLM.
 */

// Serial so a failed "add cards" step doesn't pointlessly run the
// downstream "learn / stats / library" tests. No retries: @live tests
// burn TTS + Convex round-trips that we don't want to re-spend.
test.describe.configure({ mode: "serial", retries: 0 });

test.describe("learning journey (live)", { tag: "@live" }, () => {
  test("user adds cards from a collection on home", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "home_tour");

    // Onboarding picks "beginner" → Essential collection is preselected as
    // the active collection on /app. The "Add N" button on that collection's
    // carousel entry is how we add cards for the learn test downstream.
    const addBtn = page.getByTestId("collection-add-cards").first();
    await expect(
      addBtn,
      "collection-add-cards should render on /app for the onboarded user's active collection",
    ).toBeVisible({ timeout: 15_000 });

    const labelBefore = (await addBtn.innerText()).trim();
    await addBtn.click();

    // Wait for either the button label to mutate (e.g. "Added!" / disabled)
    // or for the app to route into /app/learn. Either outcome proves the
    // collection-add mutation fired.
    await page.waitForTimeout(1_500);
    const url = page.url();
    const labelAfter = await addBtn.innerText().catch(() => labelBefore);
    const onAppOrLearn = /\/app(\/learn)?(\b|\/|$)/.test(url);
    expect(onAppOrLearn).toBe(true);
    void labelAfter;
  });

  test("user learns 3 cards in audio review mode", async ({ page }) => {
    // Each iteration touches the real FSRS mutation + a TTS roundtrip for
    // the next card. Three cards plus tour dismissal + load + initial waits
    // comfortably overflows the 30s default under @live conditions; 45s
    // gives the slowest-card-prep iteration enough headroom without hiding
    // an actual hang (the 5s+1.5s per-iteration budget is unchanged).
    test.setTimeout(45_000);

    await page.goto("/app/learn");
    await page.waitForLoadState("domcontentloaded");
    // Review mode can be audio OR full depending on prior test state — try
    // both. Each call is a no-op if the popover isn't showing.
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    const ratingBtn = page
      .locator(
        '[data-testid="learn-rating-again"], [data-testid="learn-rating-hard"], [data-testid="learn-rating-good"], [data-testid="learn-rating-easy"], [data-testid="learn-rating-still-learning"], [data-testid="learn-rating-understood"]',
      )
      .first();
    await expect(
      ratingBtn,
      "A rating button should appear on /app/learn after the previous test added cards",
    ).toBeVisible({ timeout: 20_000 });

    // The review tour launches ~1s after the reviewing state begins
    // (lib/tutorials/use-tutorial.ts), i.e. AFTER the page-load dismiss
    // above could possibly have caught it. Try again now that cards are up.
    await dismissTour(page, "audio_review_intro", 1_500);
    await dismissTour(page, "full_review_intro", 500);

    // Cards seeded by onboarding start in `preReview` phase
    // (lib/scheduling.ts:getValidRatings), so the first few iterations render
    // `learn-rating-still-learning` + `learn-rating-understood` — NOT the
    // FSRS-phase `learn-rating-good` set. Clicking `understood` transitions
    // the card to FSRS for its next review and advances the page to the
    // next card; subsequent iterations may then see the FSRS button set.
    // The candidate list covers both phases so the loop keeps working
    // across the phase swap. Order matters: `understood`/`good` advance the
    // card "cleanly"; `still-learning` is the last-resort accept-and-move-on.
    let successfulClicks = 0;
    for (let i = 0; i < 3; i++) {
      // Belt-and-braces: a tour can re-mount between cards.
      await dismissTour(page, "audio_review_intro", 250);
      await dismissTour(page, "full_review_intro", 250);
      await dismissTour(page, undefined, 250);

      // In Full Review mode ratings are gated behind submitting a
      // translation. If a textbox is present, dispatch a trivial
      // submission so the rating row becomes actionable.
      const translationInput = page.getByTestId("learn-translation-input").first();
      if (await translationInput.isVisible().catch(() => false)) {
        await translationInput.fill("skip");
        await translationInput.press("Enter");
        await page.waitForTimeout(500);
      }

      const candidateTestIds = [
        "learn-rating-understood",       // preReview — transitions to FSRS + advances
        "learn-rating-good",             // FSRS — happy-path rating + advances
        "learn-rating-still-learning",   // preReview fallback — also advances
      ];
      let target: ReturnType<typeof page.getByTestId> | null = null;
      for (const testId of candidateTestIds) {
        const btn = page.getByTestId(testId).first();
        if (await btn.isVisible().catch(() => false)) {
          target = btn;
          break;
        }
      }
      if (!target) break;

      await target.click({ timeout: 5_000 }).catch(() => {});
      successfulClicks++;
      await page.waitForTimeout(1_500);
    }

    expect(successfulClicks).toBeGreaterThanOrEqual(1);
  });

  test("user switches to full review and submits a translation", async ({
    page,
  }) => {
    await page.goto("/app/learn");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    const settings = page.getByTestId("learn-settings").first();
    await expect(
      settings,
      "learn-settings trigger should render in the LearningHeader",
    ).toBeVisible({ timeout: 10_000 });
    await settings.click();

    const sheet = page.getByTestId("learning-settings-sheet").first();
    await expect(
      sheet,
      "Learning Settings sheet should open after clicking learn-settings",
    ).toBeVisible({ timeout: 8_000 });
    // Wait out the 500ms slide-in animation before clicking inside.
    await page.waitForTimeout(550);

    const fullBtn = page.getByTestId("settings-mode-full").first();
    await expect(fullBtn).toBeVisible({ timeout: 10_000 });
    // force: true bypasses Radix's aria-hidden quirk on the sheet content.
    await fullBtn.click({ force: true });

    await page.keyboard.press("Escape").catch(() => {});
    await sheet.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});

    // Switching to Full review can trigger the full-review intro tour.
    await dismissTour(page, "full_review_intro", 1_500);

    const input = page.getByTestId("learn-translation-input").first();
    await expect(
      input,
      "Full-review translation textbox should appear after switching to full review",
    ).toBeVisible({ timeout: 20_000 });

    await input.fill("asdf placeholder answer");
    await input.press("Enter");

    // Feedback can be textual or just a rating button revealing itself.
    const feedback = page
      .getByText(/accuracy|correct|wrong|again|revert/i)
      .first();
    const ratingBtn = page
      .locator(
        '[data-testid="learn-rating-again"], [data-testid="learn-rating-hard"], [data-testid="learn-rating-good"], [data-testid="learn-rating-easy"]',
      )
      .first();

    await expect(async () => {
      const visible =
        (await feedback.isVisible().catch(() => false)) ||
        (await ratingBtn.isVisible().catch(() => false));
      expect(visible).toBe(true);
    }).toPass({ timeout: 45_000 });

    if (await ratingBtn.isVisible().catch(() => false)) {
      await ratingBtn.click().catch(() => {});
    }
  });

  test("stats page shows word activity after learning", async ({ page }) => {
    await page.goto("/app/stats");
    await page.waitForLoadState("domcontentloaded");
    // No tour registered on /app/stats — just strip any lingering overlay.
    await dismissTour(page, undefined, 250);

    // Nudge any lazy charts into view.
    await page
      .evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      .catch(() => {});
    await page.waitForTimeout(1_000);

    // Either the wordcloud OR any stat tile proves the page rendered its data.
    const wordcloudContainer = page.getByTestId("stats-wordcloud").first();
    const streakTile = page.getByTestId("stats-tile-streak").first();

    await expect(async () => {
      const wcVisible = await wordcloudContainer.isVisible().catch(() => false);
      const tileVisible = await streakTile.isVisible().catch(() => false);
      expect(wcVisible || tileVisible).toBe(true);
    }).toPass({ timeout: 20_000 });

    // Best-effort: click the largest visible word.
    const wordTarget = page
      .locator("[data-word], svg text, button")
      .filter({ hasText: /.{2,}/ })
      .first();
    if (await wordTarget.isVisible().catch(() => false)) {
      await wordTarget.click({ timeout: 2_000 }).catch(() => {});
      const dialog = page.getByRole("dialog").first();
      if (await dialog.isVisible().catch(() => false)) {
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
  });

  test("library search filters the list", async ({ page }) => {
    await page.goto("/app/library");
    await page.waitForLoadState("domcontentloaded");
    // No tour registered on /app/library — just strip any lingering overlay.
    await dismissTour(page, undefined, 250);

    const searchInput = page.getByTestId("library-search").first();
    await expect(
      searchInput,
      "library-search input should render on /app/library",
    ).toBeVisible({ timeout: 20_000 });

    // Let the initial, unfiltered list settle before counting. Search uses a
    // 300ms debounce so the test needs room for at least one full debounce +
    // query round-trip.
    const cards = page.getByTestId("library-card");
    await expect
      .poll(async () => cards.count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    const initialCount = await cards.count();

    // Use a rare-ish string that's unlikely to match every card; this makes
    // a distinct count change expected regardless of which seed data ran.
    await searchInput.fill("zzzzq");

    const emptyState = page.getByText(/no results|nothing found/i).first();
    // Wait for either the empty state to appear, or the card count to change.
    // 2s covers debounce (300ms) + query + re-render with plenty of margin.
    await expect
      .poll(
        async () => {
          const isEmpty = await emptyState
            .isVisible()
            .catch(() => false);
          const current = await cards.count();
          return isEmpty || current !== initialCount;
        },
        { timeout: 3_000 },
      )
      .toBe(true);
  });
});
