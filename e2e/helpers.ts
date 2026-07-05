import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Choices the onboarding helper can take at each step. Defaults match the
 * fastest happy-path the auth fixture uses (English → Spanish, brand-new
 * learner, skip the embedded lesson). Override per test to exercise other
 * branches without duplicating the walk.
 */
export interface OnboardingWalkOptions {
  source?: string; // ISO code, default "en"
  target?: string; // ISO code, default "es"
  acquisition?:
    | "reddit"
    | "chatgpt"
    | "gemini"
    | "claude"
    | "google"
    | "friend"
    | "appstore"
    | "other";
  acquisitionOtherText?: string;
  // The goal step is multi-select; pass a non-empty array.
  goals?: Array<"travel" | "family" | "work" | "curiosity" | "exam" | "other">;
  goalOtherText?: string;
  // Either a preset minute count or "custom" + value.
  dailyTime?: 5 | 10 | 20 | 30 | { custom: number };
  // Branch picker: "new" lands on customizing instantly, "self-pick" walks
  // through the CEFR slider + confirm dialog (Start here), and "test" runs
  // the placement test answering everything as "I didn't know" — yielding
  // the lowest level (~1) deterministically.
  proficiency?: "new" | "self-pick" | "test";
  // Number of placement-test questions to answer before the strategy resolves.
  // The default staircase strategy ends after ~7–10 reversals; we'll cap at
  // `placementMaxQuestions` to bail if something goes wrong.
  placementAnswer?: "knew" | "didnt"; // applied to every question
  placementMaxQuestions?: number;
  // First lesson — default skips (faster, doesn't depend on TTS readiness).
  // Set `mode` to drive a real lesson via Audio or Full Review.
  firstLesson?: "skip" | { mode: "audio" | "full"; cardsToRate?: number };
  // Plan pick — default uses the "Maybe later" link (stays on Free).
  planPick?: "skip";
}

/**
 * Walk the new onboarding wizard end-to-end using ONLY data-testid
 * selectors (no copy or role matching), then wait for the post-wizard
 * redirect to /app. Used by both the auth.setup.ts fixture (for the
 * shared session) and the dedicated onboarding spec (one per branch).
 *
 * Step path (see app/app/onboarding/page.tsx for the canonical order):
 *   language-pair → acquisition → goal → daily-time → proficiency →
 *   (cefr-pick + dialog | placement-test + result | none) →
 *   customizing (auto) → first-lesson → stats-recap → word-projection →
 *   feature-tour → plan-pick → /app.
 */
export async function completeOnboardingFresh(
  page: Page,
  opts: OnboardingWalkOptions = {},
): Promise<void> {
  const {
    source = "en",
    target = "es",
    acquisition = "other",
    acquisitionOtherText,
    goals = ["curiosity"],
    goalOtherText,
    dailyTime = 5,
    proficiency = "new",
    placementAnswer = "didnt",
    placementMaxQuestions = 15,
    firstLesson = "skip",
    planPick = "skip",
  } = opts;

  // Helper: click a testid and assert the wizard's next step rendered.
  const advance = async (
    actions: (() => Promise<void>) | null,
    nextStepTestId: string,
  ) => {
    if (actions) await actions();
    await page.getByTestId("onboarding-continue").click();
    await expect(page.getByTestId(nextStepTestId)).toBeVisible({
      timeout: 20_000,
    });
  };

  // 1. Language pair — source first, then target. The selector hides + re-
  //    reveals between picks, so we re-query each time.
  await expect(page.getByTestId("onboarding-step-language-pair")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId(`language-option-${source}`).first().click();
  await page.getByTestId(`language-option-${target}`).first().click();
  await advance(null, "onboarding-step-acquisition");

  // 2. Acquisition source.
  await page.getByTestId(`acquisition-option-${acquisition}`).click();
  if (acquisition === "other" && acquisitionOtherText) {
    await page.getByTestId("acquisition-other-input").fill(acquisitionOtherText);
  }
  await advance(null, "onboarding-step-goal");

  // 3. Learning goal — multi-select, at least one.
  for (const goal of goals) {
    await page.getByTestId(`goal-option-${goal}`).click();
  }
  if (goals.includes("other") && goalOtherText) {
    await page.getByTestId("goal-other-input").fill(goalOtherText);
  }
  await advance(null, "onboarding-step-daily-time");

  // 4. Daily time goal.
  if (typeof dailyTime === "number") {
    await page.getByTestId(`daily-time-option-${dailyTime}`).click();
  } else {
    await page.getByTestId("daily-time-option-custom").click();
    await page.getByTestId("daily-time-custom-input").fill(String(dailyTime.custom));
  }
  await advance(null, "onboarding-step-proficiency");

  // 5. Proficiency branch. Picking a branch only selects it — Continue is
  // what actually advances the wizard. All three sub-branches click it.
  await page.getByTestId(`proficiency-branch-${proficiency}`).click();
  await page.getByTestId("onboarding-continue").click();
  if (proficiency === "new") {
    // Lands on customizing directly — the next assertion below picks it up.
  } else if (proficiency === "self-pick") {
    await expect(page.getByTestId("onboarding-step-cefr-pick")).toBeVisible({
      timeout: 20_000,
    });
    // Default slider position is fine for the walk — confirm + start.
    await page.getByTestId("onboarding-continue").click();
    await expect(page.getByTestId("cefr-confirm-dialog")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("cefr-confirm-start-here").click();
  } else {
    // proficiency === "test" — run the placement test deterministically.
    await expect(page.getByTestId("onboarding-step-placement-test")).toBeVisible({
      timeout: 20_000,
    });
    const answerTestId =
      placementAnswer === "knew"
        ? "placement-test-knew-it"
        : "placement-test-didnt-know";
    // Loop until the result screen renders or we hit the cap.
    for (let q = 0; q < placementMaxQuestions; q++) {
      const resultVisible = await page
        .getByTestId("onboarding-step-placement-result")
        .isVisible()
        .catch(() => false);
      if (resultVisible) break;
      await page.getByTestId("placement-test-reveal").click();
      await page.getByTestId(answerTestId).click();
    }
    await expect(
      page.getByTestId("onboarding-step-placement-result"),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("placement-result-continue").click();
  }

  // 6. Customizing — auto-advances after the bar + completeOnboarding mutation.
  await expect(page.getByTestId("onboarding-step-customizing")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("onboarding-step-first-lesson-intro"),
  ).toBeVisible({ timeout: 60_000 });

  // 7. First lesson intro (mode picker → Start or Skip).
  // Skip jumps straight to feature-tour (stats-recap + word-projection are
  // only shown when the user actually rated cards — see
  // app/app/onboarding/page.tsx onSkipLesson).
  if (firstLesson === "skip") {
    await page.getByTestId("first-lesson-skip").click();
  } else {
    await page.getByTestId(`first-lesson-mode-${firstLesson.mode}`).click();
    await page.getByTestId("first-lesson-start").click();
    // Driving real cards is opt-in — leave that to the dedicated spec.
    // If the caller asked for it, rate the requested number of cards then
    // wait for the stats-recap.
    const cardsToRate = firstLesson.cardsToRate ?? 0;
    for (let i = 0; i < cardsToRate; i++) {
      // Dismiss whichever onboarding tutorial popover is on screen first.
      await dismissTour(page).catch(() => {});
      // Hit the audio "Next" / rating "Good" — best-effort, since this
      // depends on real card content being ready, which is brittle for
      // the auth fixture. Suites that drive real cards should manage
      // their own per-card flow.
      const next = page
        .getByRole("button", { name: /^next$|^good$/i })
        .first();
      await next.click({ timeout: 10_000 }).catch(() => {});
    }

    // 8. Stats recap.
    await expect(page.getByTestId("onboarding-step-stats-recap")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("progress-display-continue").click();

    // 9. Word projection.
    await expect(
      page.getByTestId("onboarding-step-word-projection"),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("word-projection-continue").click();
  }

  // 10. Feature tour — click Next until the Done button appears, then Done.
  await expect(page.getByTestId("onboarding-step-feature-tour")).toBeVisible({
    timeout: 20_000,
  });
  for (let i = 0; i < 10; i++) {
    const done = page.getByTestId("feature-tour-done");
    if (await done.isVisible().catch(() => false)) {
      await done.click();
      break;
    }
    await page.getByTestId("feature-tour-next").click();
  }

  // 11. Plan pick — skip onto Free.
  await expect(page.getByTestId("onboarding-step-plan-pick")).toBeVisible({
    timeout: 20_000,
  });
  if (planPick === "skip") {
    await page.getByTestId("plan-pick-skip").click();
  }

  // 12. Wait for the post-wizard redirect to /app.
  await page.waitForURL(
    (url) => /\/app(\/|$)/.test(url.pathname) && !/onboarding/.test(url.pathname),
    { timeout: 30_000 },
  );
}

// Re-exported so spec files can reach in for individual testid locators if
// they want to assert step transitions without driving the full walk.
export function onboardingStep(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

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

/**
 * True when the testid'd button reads as selected (aria-pressed or the
 * ring/bg-primary selection classes the settings mode buttons use).
 */
export async function isSelectedTestId(
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
 * Necessary for elements inside fixed-position Sheets: while the sheet
 * (re-)animates, the element is mid-transform for ~500ms. `force: true`
 * doesn't bypass Playwright's viewport check, and `position: fixed` defeats
 * auto-scroll — polling the bounding box waits the animation out
 * deterministically.
 */
export async function waitForInViewport(
  page: Page,
  locator: Locator,
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
