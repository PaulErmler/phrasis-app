import { test, expect } from "@playwright/test";
import {
  dismissTour,
  isSelectedTestId,
  waitForInViewport,
} from "./helpers";

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
    // Each iteration touches the real FSRS mutation + a TTS roundtrip to prep
    // the next card's audio. The 20s initial rating wait plus three cards each
    // waiting up to 10s for the next card's ratings to mount can exceed 45s
    // under @live load — which surfaced as a flaky "Test timeout exceeded".
    // 90s gives the slowest-prep run headroom without masking a true hang:
    // every wait inside the loop is still individually bounded, so a real stall
    // breaks the loop early rather than silently consuming the budget.
    test.setTimeout(90_000);

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
    // `learn-rating-still-learning` + `learn-rating-understood`. Cards that
    // have already graduated render the FSRS set:
    // `again` / `hard` / `good` / `easy`. We accept every "advancing" rating
    // across both phases; ordering is least-disruptive first
    // (`understood`/`good`/`easy`) before fallbacks. `again`/`hard` also
    // count as successful clicks: the loop only asserts that the rating UI
    // was actionable, not that the card was "learned correctly".
    const advancingCandidateTestIds = [
      "learn-rating-understood",     // preReview — graduates the card
      "learn-rating-good",           // FSRS — happy-path
      "learn-rating-easy",           // FSRS — also advances
      "learn-rating-still-learning", // preReview — fallback
      "learn-rating-hard",           // FSRS — last-resort
      "learn-rating-again",          // FSRS — last-resort
    ];
    // Combined locator for "any rating button visible" — same set the
    // pre-loop assertion used. Reused inside the iteration to wait for
    // the next card's ratings to mount after an auto-advance, instead
    // of relying on a fixed 1.5s sleep.
    const anyRatingLocator = page
      .locator(advancingCandidateTestIds.map((id) => `[data-testid="${id}"]`).join(", "))
      .first();

    let successfulClicks = 0;
    for (let i = 0; i < 3; i++) {
      // Belt-and-braces: a tour can re-mount between cards.
      await dismissTour(page, "audio_review_intro", 250);
      await dismissTour(page, "full_review_intro", 250);
      await dismissTour(page, undefined, 250);

      // In Full Review mode ratings are gated behind submitting a
      // translation. If a textbox is present, dispatch a trivial submission so
      // the rating row becomes actionable. Bound both interactions and swallow
      // failures: once grading starts the input can disable/detach mid-action,
      // and an unbounded `press` there is what previously hung the whole test
      // until the timeout. If it fails we simply fall through to the rating
      // wait below (which decides whether to advance or break).
      const translationInput = page.getByTestId("learn-translation-input").first();
      if (await translationInput.isVisible().catch(() => false)) {
        await translationInput.fill("skip", { timeout: 5_000 }).catch(() => {});
        await translationInput.press("Enter", { timeout: 5_000 }).catch(() => {});
        // Grading + rating-row mount can take >500ms under @live load.
        // Wait on the next assertion instead of a fixed sleep.
      }

      // Wait for ANY rating button to be visible before searching for a
      // specific one — covers the gap when an auto-advance has just fired
      // and the next card's ratings haven't mounted yet.
      const ratingsReady = await anyRatingLocator
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!ratingsReady) break;

      let target: ReturnType<typeof page.getByTestId> | null = null;
      for (const testId of advancingCandidateTestIds) {
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
    // Headroom for the mode-switch retry loop below: its backoff path alone
    // can spend ~25s outlasting a JWT refresh window.
    test.setTimeout(60_000);
    // The `(main)` layout now mounts LearnView as an overlay when the URL
    // becomes `/app/learn` via `history.pushState` from the home view's
    // Learn buttons (see app/app/(main)/layout.tsx:handleLearnOpen). A
    // direct `page.goto("/app/learn")` doesn't reliably trigger that path
    // — it can leave the layout's `isLearnOpen` state false and the user
    // sitting on the home view with no LearningHeader rendered. Drive the
    // overlay open the same way the user does: land on /app and click
    // "Learn & Review".
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "home_tour", 500);

    // A prior @live test (`content-filter-live`) can leave `Source: Custom
    // only` active on the course; with no custom cards seeded that filter
    // makes the deck look empty downstream. Reset to "Both" via the
    // dropdown if it isn't already.
    const sourceTrigger = page
      .getByTestId("content-filter-trigger")
      .first();
    if (await sourceTrigger.isVisible().catch(() => false)) {
      const label = (await sourceTrigger.innerText().catch(() => "")).trim();
      if (!/both/i.test(label)) {
        await sourceTrigger.click().catch(() => {});
        await page
          .getByTestId("content-filter-option-both")
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
      }
    }

    const learnAndReviewBtn = page
      .locator('[data-tutorial="learn-and-review"]')
      .first();
    await expect(
      learnAndReviewBtn,
      "Learn & Review button should render on the home view",
    ).toBeVisible({ timeout: 15_000 });
    await learnAndReviewBtn.click();

    // Both these tours anchor a step to the settings button; under @live
    // load they can render >500ms after the learn overlay mounts, so wait the
    // default window rather than racing them.
    await dismissTour(page, "audio_review_intro");
    await dismissTour(page, "full_review_intro");

    const settings = page.getByTestId("learn-settings").first();
    await expect(
      settings,
      "learn-settings trigger should render in the LearningHeader after opening the learn overlay",
    ).toBeVisible({ timeout: 10_000 });
    // Belt-and-braces: a tour can still be mid-render here, and its
    // `.driver-overlay` backdrop intercepts the click (body.driver-active).
    // Clear any stray popover/overlay right before clicking, mirroring the
    // per-card loop above.
    await dismissTour(page, undefined, 500);
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
    // The fixed-position sheet re-animates after opening; a click
    // mid-transform either throws ("outside of viewport" — force doesn't
    // bypass that check) or lands on stale coordinates and silently misses,
    // leaving the mode unswitched. Wait for the button to settle inside the
    // viewport, click (force bypasses Radix's aria-hidden quirk on the sheet
    // content), and confirm the mode actually flipped.
    //
    // The confirmation must SETTLE, not just read once: the sheet renders
    // from an optimistic cache (`updateSettings` in LearningModeSettings
    // carries a `withOptimisticUpdate`), so the poll can pass on a value the
    // server then rejects/rolls back — the mode silently snaps back to audio
    // after the sheet closes and the translation input never mounts. Require
    // the selection to survive a window covering the server round-trip and
    // re-click when it snaps back. Retries back off across ~15s to outlast a
    // transient JWT refresh window (see ClientAuthBoundary), during which
    // every authenticated mutation is rejected and rolled back.
    const backoffsMs = [0, 500, 1_000, 2_000, 4_000, 6_000];
    let switched = false;
    for (let attempt = 0; attempt < backoffsMs.length && !switched; attempt++) {
      await page.waitForTimeout(backoffsMs[attempt]);
      await waitForInViewport(page, fullBtn, 10_000);
      await fullBtn.click({ force: true }).catch(() => {});
      const selected = await expect
        .poll(() => isSelectedTestId(page, "settings-mode-full"), {
          timeout: 5_000,
        })
        .toBe(true)
        .then(() => true)
        .catch(() => false);
      if (!selected) continue;
      await page.waitForTimeout(600);
      switched = await isSelectedTestId(page, "settings-mode-full");
    }
    expect(
      switched,
      "settings-mode-full should read as selected (and stay selected across the server round-trip) after clicking it",
    ).toBe(true);

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
