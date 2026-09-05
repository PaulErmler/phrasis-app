import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

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
    | 'reddit'
    | 'chatgpt'
    | 'gemini'
    | 'claude'
    | 'google'
    | 'friend'
    | 'appstore'
    | 'other';
  acquisitionOtherText?: string;
  // The prior-apps step is multi-select; pass a non-empty array. "none" is
  // exclusive with the rest, so pass it alone.
  priorApps?: Array<
    | 'anki'
    | 'glossika'
    | 'clozemaster'
    | 'babbel'
    | 'duolingo'
    | 'other'
    | 'none'
  >;
  priorAppsOtherText?: string;
  // The goal step is multi-select; pass a non-empty array.
  goals?: Array<'travel' | 'family' | 'work' | 'curiosity' | 'exam' | 'other'>;
  goalOtherText?: string;
  // Either a preset minute count or "custom" + value.
  dailyTime?: 5 | 10 | 20 | 30 | { custom: number };
  // Branch picker: "new" lands on customizing instantly, "self-pick" walks
  // through the CEFR slider + confirm dialog (Start here), and "test" runs
  // the placement test answering everything as "I didn't know", yielding
  // the lowest level (~1) deterministically.
  proficiency?: 'new' | 'self-pick' | 'test';
  // Number of placement-test questions to answer before the strategy resolves.
  // The default staircase strategy ends after ~7–10 reversals; we'll cap at
  // `placementMaxQuestions` to bail if something goes wrong.
  placementAnswer?: 'knew' | 'didnt'; // applied to every question
  placementMaxQuestions?: number;
  // Final step: review-mode pick. Shadowing (audio) is the default;
  // translate/transcribe both land in the writing mode with that input style.
  reviewMode?: 'audio' | 'translate' | 'transcribe';
}

/**
 * Walk the onboarding wizard end-to-end using ONLY data-testid selectors
 * (no copy or role matching), then wait for the wizard's handoff into the
 * real learning mode at /app/learn. Used by both the auth.setup.ts fixture
 * (for the shared session) and the dedicated onboarding spec.
 *
 * Step path (see app/app/onboarding/page.tsx for the canonical order):
 *   language-pair → acquisition → prior-apps → goal → daily-time →
 *   proficiency →
 *   (cefr-pick | placement-test + result | none) →
 *   review-mode → Start learning → /app/learn.
 */
export async function completeOnboardingFresh(
  page: Page,
  opts: OnboardingWalkOptions = {},
): Promise<void> {
  const {
    source = 'en',
    target = 'es',
    acquisition = 'other',
    acquisitionOtherText,
    priorApps = ['none'],
    priorAppsOtherText,
    goals = ['curiosity'],
    goalOtherText,
    dailyTime = 5,
    proficiency = 'new',
    placementAnswer = 'didnt',
    placementMaxQuestions = 15,
    reviewMode = 'audio',
  } = opts;

  // Helper: click a testid and assert the wizard's next step rendered.
  const advance = async (
    actions: (() => Promise<void>) | null,
    nextStepTestId: string,
  ) => {
    if (actions) await actions();
    await page.getByTestId('onboarding-continue').click();
    await expect(page.getByTestId(nextStepTestId)).toBeVisible({
      timeout: 20_000,
    });
  };

  // 1. Language pair. Target (learn) first, then source (already speak).
  //    The selector hides + re-reveals between picks, so we re-query each time.
  await expect(page.getByTestId('onboarding-step-language-pair')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId(`language-option-${target}`).first().click();
  await page.getByTestId(`language-option-${source}`).first().click();
  await advance(null, 'onboarding-step-acquisition');

  // 2. Acquisition source.
  await page.getByTestId(`acquisition-option-${acquisition}`).click();
  if (acquisition === 'other' && acquisitionOtherText) {
    await page
      .getByTestId('acquisition-other-input')
      .fill(acquisitionOtherText);
  }
  await advance(null, 'onboarding-step-prior-apps');

  // 3. Prior apps. Multi-select, at least one.
  for (const app of priorApps) {
    await page.getByTestId(`prior-apps-option-${app}`).click();
  }
  if (priorApps.includes('other') && priorAppsOtherText) {
    await page.getByTestId('prior-apps-other-input').fill(priorAppsOtherText);
  }
  await advance(null, 'onboarding-step-goal');

  // 4. Learning goal. Multi-select, at least one.
  for (const goal of goals) {
    await page.getByTestId(`goal-option-${goal}`).click();
  }
  if (goals.includes('other') && goalOtherText) {
    await page.getByTestId('goal-other-input').fill(goalOtherText);
  }
  await advance(null, 'onboarding-step-daily-time');

  // 5. Daily time goal.
  if (typeof dailyTime === 'number') {
    await page.getByTestId(`daily-time-option-${dailyTime}`).click();
  } else {
    await page.getByTestId('daily-time-option-custom').click();
    await page
      .getByTestId('daily-time-custom-input')
      .fill(String(dailyTime.custom));
  }
  await advance(null, 'onboarding-step-proficiency');

  // 6. Proficiency branch. Picking a branch only selects it. Continue is
  // what actually advances the wizard. All three sub-branches click it.
  await page.getByTestId(`proficiency-branch-${proficiency}`).click();
  await page.getByTestId('onboarding-continue').click();
  if (proficiency === 'new') {
    // Lands on customizing directly. The next assertion below picks it up.
  } else if (proficiency === 'self-pick') {
    await expect(page.getByTestId('onboarding-step-cefr-pick')).toBeVisible({
      timeout: 20_000,
    });
    // Default slider position is fine for the walk. Continue starts the
    // course at the picked level directly (no confirmation dialog).
    await page.getByTestId('onboarding-continue').click();
  } else {
    // proficiency === "test". Run the placement test deterministically.
    await expect(
      page.getByTestId('onboarding-step-placement-test'),
    ).toBeVisible({
      timeout: 20_000,
    });
    const answerTestId =
      placementAnswer === 'knew'
        ? 'placement-test-knew-it'
        : 'placement-test-didnt-know';
    // Loop until the result screen renders or we hit the cap.
    for (let q = 0; q < placementMaxQuestions; q++) {
      const resultVisible = await page
        .getByTestId('onboarding-step-placement-result')
        .isVisible()
        .catch(() => false);
      if (resultVisible) break;
      await page.getByTestId('placement-test-reveal').click();
      await page.getByTestId(answerTestId).click();
    }
    await expect(
      page.getByTestId('onboarding-step-placement-result'),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('placement-result-continue').click();
  }

  // 7. Review mode. The final step. Continue ("Start learning") runs
  // completeOnboarding (course + deck + seeded cards) inline behind a
  // spinner, then finalizeOnboarding, then hands off to /app/learn. Under
  // @live load a transient backend error can crash the wizard into the view
  // error boundary mid-transition; retry through it. Wizard progress is
  // server-persisted, so a remount resumes where it left off.
  await expect
    .poll(
      async () => {
        await dismissErrorBoundary(page);
        return page
          .getByTestId('onboarding-step-review-mode')
          .isVisible()
          .catch(() => false);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.getByTestId(`review-mode-${reviewMode}`).click();
  await page.getByTestId('onboarding-continue').click();

  // 8. Wait for the handoff into the real learning mode.
  await page.waitForURL(
    (url) =>
      /\/app(\/|$)/.test(url.pathname) && !/onboarding/.test(url.pathname),
    { timeout: 60_000 },
  );

  // The first real session greets a fresh user with the intro tip
  // walkthrough (use-milestone-tips). Dismiss it so the saved storageState
  // starts sessions clean; the completion is persisted to localStorage
  // synchronously, so it travels with the storage state even if the Convex
  // write hasn't landed yet.
  await dismissTour(page, undefined, 6_000).catch(() => {});

  // Retire the REST of the one-time learning-mode UI for this fixture user:
  // milestone tips fire mid-session at 2/5/8/11/15 lifetime reviews and the
  // difficulty check intercepts the first auto-add. Each would block
  // clicks at an unpredictable point of whichever spec happens to cross the
  // threshold (seen 2026-08-17: learning-undo blocked by the chat tip,
  // course-settings-sweep by the card-options tip). Their behavior is
  // covered by unit/convex tests; e2e fixture users skip them. Written into
  // the per-user localStorage cache, which the saved storageState carries
  // into every spec context. `home_tour` is deliberately NOT marked.
  // tutorial.spec depends on it being armed for a fresh user.
  // Keep the id list in sync with convex/features/tutorialIds.ts.
  const RETIRED_ONE_TIME_UI_IDS = [
    'tip_concept_card',
    'tip_concept_reveal',
    'tip_concept_rating_audio',
    'tip_concept_rating_full',
    'tip_concept_audio_controls',
    'tip_concept_shown_translation',
    'tip_concept_input',
    'tip_concept_autoadd',
    'tip_card_actions',
    'tip_chat',
    'tip_word_tap',
    'tip_mode_switch',
    'tip_settings',
    'difficulty_check',
  ];
  // The per-user key (`phrasis_completed_tutorials_<userId>`) is created by
  // the intro-tip dismissal above; poll briefly for it and fall back to the
  // pre-auth key so the write never lands nowhere.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Object.keys(localStorage).some((k) =>
            k.startsWith('phrasis_completed_tutorials_'),
          ),
        ),
      { timeout: 5_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true)
    .catch(() => {});
  await page.evaluate((ids) => {
    const PREFIX = 'phrasis_completed_tutorials';
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
    if (keys.length === 0) keys.push(PREFIX);
    for (const key of keys) {
      let current: string[];
      try {
        current = JSON.parse(localStorage.getItem(key) ?? '[]');
      } catch {
        current = [];
      }
      localStorage.setItem(
        key,
        JSON.stringify(Array.from(new Set([...current, ...ids]))),
      );
    }
  }, RETIRED_ONE_TIME_UI_IDS);

  // 13. Confirm the server actually committed finalizeOnboarding before
  // returning. The redirect above is driven by the mutation's OPTIMISTIC
  // update (see app/app/onboarding/page.tsx), so at this point the server may
  // not have the write yet, and callers immediately save storageState and
  // close the context, which kills the websocket and DROPS any un-acked
  // mutation. A dropped finalize leaves the user onboarding-incomplete, and
  // the next session bounces every /app route back into the wizard.
  //
  // Probe from a SECOND page (fresh Convex client → reads server truth) while
  // this page stays alive so its websocket can still deliver the mutation:
  // cold-load /app and see whether OnboardingGuard bounces it to the wizard.
  const probe = await page.context().newPage();
  try {
    await expect
      .poll(
        async () => {
          await probe.goto('/app');
          await probe.waitForLoadState('domcontentloaded');
          return probe.waitForURL(/\/app\/onboarding/, { timeout: 2_500 }).then(
            () => 'bounced-to-onboarding',
            () => 'stayed-on-app',
          );
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe('stayed-on-app');
  } finally {
    await probe.close();
  }
}

// Re-exported so spec files can reach in for individual testid locators if
// they want to assert step transitions without driving the full walk.
export function onboardingStep(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

/**
 * Known tutorial/tip identifiers. Tours (`useTutorial`) set
 * `popoverClass="phrasis-tutorial-<id>"`; the learning-mode tips
 * (`useMilestoneTips`) set `popoverClass="phrasis-tip-<id>"`. The legacy
 * `audio_review_intro`/`full_review_intro` names are kept as aliases for the
 * intro tip walkthroughs that replaced those tours, so existing spec calls
 * keep dismissing the equivalent popover.
 */
export type TourId =
  | 'home_tour'
  | 'audio_review_intro'
  | 'full_review_intro'
  | 'chat'
  | 'completion'
  | 'tip_card_actions'
  | 'tip_chat'
  | 'tip_word_tap'
  | 'tip_mode_switch'
  | 'tip_settings';

/** CSS classes (without the leading dot) a TourId may appear under. */
const TOUR_POPOVER_CLASSES: Record<TourId, string[]> = {
  home_tour: ['phrasis-tutorial-home_tour'],
  audio_review_intro: ['phrasis-tip-intro_audio'],
  full_review_intro: ['phrasis-tip-intro_full'],
  chat: ['phrasis-tutorial-chat', 'phrasis-tip-tip_chat'],
  completion: ['phrasis-tutorial-completion'],
  tip_card_actions: ['phrasis-tip-tip_card_actions'],
  tip_chat: ['phrasis-tip-tip_chat'],
  tip_word_tap: ['phrasis-tip-tip_word_tap'],
  tip_mode_switch: ['phrasis-tip-tip_mode_switch'],
  tip_settings: ['phrasis-tip-tip_settings'],
};

/**
 * Best-effort recovery from the per-segment view error boundary
 * ("Something went wrong" + "Try again"). Under @live load the local Convex
 * dev backend can transiently error a query. Every OpenRouter/TTS action
 * retrying with backoff saturates it, which crashes whatever view is open
 * into the boundary. Clicking retry remounts the segment exactly like a
 * user would; persistent crashes still fail the spec at its next assertion.
 */
export async function dismissErrorBoundary(page: Page): Promise<void> {
  const retry = page.getByRole('button', { name: /try again/i }).first();
  if (await retry.isVisible().catch(() => false)) {
    await retry.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

/**
 * Fail fast with a self-explanatory message when the saved storage state no
 * longer holds a valid session. The app then silently redirects protected
 * routes to /auth/sign-in and specs otherwise time out ~20s later on some
 * unrelated domain assertion (a rating button, a pill, …), which reads like
 * a feature bug. Call right after the first goto('/app...') of a spec.
 */
export async function expectSignedIn(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  const onAuthScreen = page.url().includes('/auth/');
  if (onAuthScreen) {
    throw new Error(
      'Storage state is stale — the app redirected to the sign-in page. ' +
        'Re-run the `setup` project (drop --no-deps / delete e2e/.auth) so ' +
        'auth.setup.ts mints fresh fixture users for this deployment.',
    );
  }
}

/**
 * Navigate to an authed `/app` route and wait for `ready` to appear.
 * Under parallel-suite load the Next loading splash (layout preloads /
 * AuthBoundary) can sit until Convex warms; one reload picks up the
 * compiled path. Used by billing/settings specs that otherwise time out
 * on the Flexling splash with no pricing table or heading in the DOM.
 */
export async function gotoAuthedApp(
  page: Page,
  appPath: string,
  ready: Locator,
  timeoutMs = 30_000,
): Promise<void> {
  const go = async () => {
    await page.goto(appPath);
    await page.waitForURL(`**${appPath}`, { timeout: 20_000 });
    await expectSignedIn(page);
  };
  await go();
  try {
    await expect(ready).toBeVisible({ timeout: Math.min(8_000, timeoutMs) });
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await expectSignedIn(page);
    await expect(ready).toBeVisible({ timeout: timeoutMs });
  }
}

/**
 * The one LIVE app tree, as a scope for testid lookups.
 *
 * During a navigation React streams the app layout in a hidden
 * `<div hidden id="S:0">` container and swaps it into place a moment
 * later, so the document briefly holds TWO copies of the whole layout —
 * `<main>` and all — one of them showing the other view's (stale) state.
 * A bare `page.getByTestId(...)` sees both: `toBeVisible` fails the strict
 * check with "resolved to 2 elements", and `toHaveCount(0)` counts the
 * stale copy (both observed on settings.spec's forecast test, 2026-08-27).
 *
 * The staging container carries the `hidden` attribute, so its subtree is
 * out of the accessibility tree — which is exactly what a role selector
 * filters on. `getByRole('main')` therefore resolves to the live tree and
 * only the live tree, mid-swap included. Scope home/settings assertions
 * through it rather than waiting the window out: there is no load state
 * that reliably brackets the swap.
 *
 * `.first()` because the open learn overlay renders its own `<main>` as a
 * SIBLING of the layout's (see `(main)/layout.tsx`), and document order puts
 * the layout's first. This is therefore the tab views' container — home,
 * library, stats, settings — not the learn overlay; locate inside that
 * overlay directly.
 */
export function appMain(page: Page): Locator {
  return page.getByRole('main').first();
}

/**
 * Drive one or more settings Switches to the given on/off states and
 * confirm the SERVER actually saved them. Callers must already be on a
 * page where the toggles are mounted (e.g. /app/settings) with the
 * toggles reflecting server state (fresh goto or reload), and must scope
 * the toggle locators through `appMain` — an unscoped one can read the
 * stale mid-swap copy and hand this loop a state the server never had.
 *
 * Why not click → reload → poll aria-checked? That pattern is a lost-write
 * race: the switch flips from the optimistic patch in the same frame, but
 * `page.reload()` tears down the Convex websocket, and an un-acked
 * mutation dies with it. The old poll then waited on a server state that
 * could never arrive (showDueCounts and settings.spec both failed exactly
 * there under post-@live backend load, 2026-08-27; settings failed BOTH
 * attempts). Instead retry the whole cycle: click toward the desired
 * state, give the mutation a bounded flush window, reload, re-read. A
 * write the reload killed is simply re-issued on the next pass.
 */
export async function ensureTogglesSaved(
  page: Page,
  expected: Array<{ toggle: Locator; on: boolean }>,
  timeoutMs = 45_000,
): Promise<void> {
  // Once ANY click happened, only a post-reload read proves persistence —
  // before that, aria-checked may be the optimistic patch of a write that
  // is still in flight (or already lost).
  let everClicked = false;
  await expect(async () => {
    let clickedThisPass = false;
    for (const { toggle, on } of expected) {
      await expect(toggle).toBeVisible({ timeout: 15_000 });
      if ((await toggle.getAttribute('aria-checked')) !== String(on)) {
        await toggle.click();
        clickedThisPass = true;
        everClicked = true;
      }
    }
    if (!everClicked) return; // server state already matched; nothing to prove
    // Bounded flush window so the mutation can reach the server before
    // the reload below kills the websocket.
    if (clickedThisPass) await page.waitForTimeout(1_000);
    await page.reload();
    for (const { toggle, on } of expected) {
      await expect(toggle).toBeVisible({ timeout: 15_000 });
      expect(await toggle.getAttribute('aria-checked')).toBe(String(on));
    }
  }).toPass({ timeout: timeoutMs, intervals: [500, 1_000, 2_000] });
}

/**
 * Turn on "Show how many cards are due" so home due-count pills render.
 * The pills are hidden by default (showing is an explicit opt-in); specs
 * that assert on them must opt in first.
 */
export async function showDueCounts(page: Page): Promise<void> {
  await page.goto('/app/settings');
  await page.waitForLoadState('domcontentloaded');
  // Scoped to the live tree: mid-navigation the document can hold a second,
  // stale copy of the switch (see `appMain`).
  const sw = appMain(page).locator('#showDueCounts');
  await ensureTogglesSaved(page, [{ toggle: sw, on: true }]);
}

/**
 * Best-effort dismissal of the cookie-consent banner. The banner is fixed,
 * bottom-anchored and z-100, so while visible it intercepts clicks on any
 * bottom-of-viewport control (the import wizard's Next/Submit, the learn
 * CTA, …). It only mounts while PostHog reports consent 'pending'. Normally
 * never in specs, because `signUpAndOnboard` records the decision into the
 * saved storageState, but a spec running with fresh or stale storage can
 * still get it at any moment after the PostHog SDK boots.
 */
export async function dismissConsent(page: Page): Promise<void> {
  const accept = page.getByTestId('consent-accept').first();
  if (await accept.isVisible().catch(() => false)) {
    await accept.click().catch(() => {});
    await accept.waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
  }
}

/**
 * Confirm-away the one-time difficulty-check dialog (fires the first time
 * new cards are auto-added for a fresh user) by clicking its keep/confirm
 * button. Safe no-op when the dialog isn't up. Folded into `dismissTour`
 * so every card-rating loop that already clears popovers also clears this.
 */
export async function dismissDifficultyCheck(page: Page): Promise<void> {
  const confirm = page.getByTestId('difficulty-check-confirm').first();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click().catch(() => {});
    await page
      .getByTestId('difficulty-check-dialog')
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => {});
  }
}

/**
 * Dismiss a driver.js onboarding popover. When `id` is provided, only the
 * matching tour (by `popoverClass="phrasis-tutorial-<id>"`) is targeted;
 * otherwise any `.driver-popover` is dismissed. Always strips any lingering
 * `.driver-overlay` SVG so the backdrop never intercepts subsequent clicks.
 * Also clears the consent banner (see `dismissConsent`), every spec that
 * needs overlays gone calls this helper, and the tour wait doubles as time
 * for the PostHog SDK to boot and mount the banner. The one-time
 * difficulty-check dialog is cleared on both paths too.
 */
export async function dismissTour(
  page: Page,
  id?: TourId,
  waitMs = 2500,
): Promise<void> {
  const selector = id
    ? TOUR_POPOVER_CLASSES[id].map((cls) => `.driver-popover.${cls}`).join(', ')
    : '.driver-popover';

  const nukeOverlays = () =>
    page
      .evaluate(() => {
        document
          .querySelectorAll('.driver-overlay')
          .forEach((el) => el.remove());
      })
      .catch(() => {});

  const popover = page.locator(selector).first();

  try {
    await popover.waitFor({ state: 'visible', timeout: waitMs });
  } catch {
    await nukeOverlays();
    await dismissConsent(page);
    await dismissErrorBoundary(page);
    await dismissDifficultyCheck(page);
    return;
  }

  const closeBtn = popover.locator('.driver-popover-close-btn').first();
  if (await closeBtn.count()) {
    await closeBtn.click().catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }

  await popover.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

  const overlay = page.locator('.driver-overlay').first();
  await overlay
    .waitFor({ state: 'detached', timeout: 3_000 })
    .catch(nukeOverlays);
  await dismissConsent(page);
  await dismissErrorBoundary(page);
  await dismissDifficultyCheck(page);
}

/**
 * Open the card batch-import UI: navigate, dismiss the home tour, switch to
 * the "import" tab and wait for the paste textarea to render. Shared by the
 * UI-only and live import specs.
 */
export async function openCardImport(page: Page): Promise<void> {
  await page.goto('/app/content/add-cards');
  // `domcontentloaded` fires before client-side route resolves in Next dev.
  // Wait for the URL to actually equal the target, then for AddCardsView to
  // mount. The individual tab is the default mode; its presence proves the
  // switcher is rendered (i.e. `isAddCardsRoute` is true in MainLayout).
  await page.waitForURL('**/app/content/add-cards', { timeout: 20_000 });
  await dismissTour(page);
  const individualTab = page.getByTestId('add-cards-mode-individual');
  try {
    // Short first probe so a compile stall retries inside the default 30s
    // test budget. The retry below is the one that actually waits.
    await expect(individualTab).toBeVisible({ timeout: 8_000 });
  } catch {
    // One retry: in Next dev, the first hit of a route can stall on
    // on-demand compilation under parallel worker load. A hard reload picks
    // up the now-compiled bundle instantly. 'domcontentloaded', not the
    // default 'load': when the local Convex backend is struggling, pending
    // requests hold the load event open past the test timeout, turning a
    // recoverable stall into a guaranteed one (seen 2026-08-17, backend
    // saturation run).
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForURL('**/app/content/add-cards', { timeout: 20_000 });
    await dismissTour(page);
    await expect(individualTab).toBeVisible({ timeout: 20_000 });
  }
  await page.getByTestId('add-cards-mode-import').click();
  await expect(page.getByTestId('import-paste')).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Fill the import paste textarea and wait until the controller has parsed
 * the input (step 1 becomes enabled once at least one row is detected).
 */
export async function pasteImport(page: Page, text: string): Promise<void> {
  await page.getByTestId('import-paste').fill(text);
  await expect(page.getByTestId('import-step-1')).toBeEnabled({
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
  const pressed = await btn.getAttribute('aria-pressed').catch(() => null);
  if (pressed === 'true') return true;
  const cls = (await btn.getAttribute('class').catch(() => '')) || '';
  return /ring-primary|bg-primary/.test(cls);
}

/**
 * Poll until a locator's bounding box is fully inside the viewport.
 * Necessary for elements inside fixed-position Sheets: while the sheet
 * (re-)animates, the element is mid-transform for ~500ms. `force: true`
 * doesn't bypass Playwright's viewport check, and `position: fixed` defeats
 * auto-scroll. Polling the bounding box waits the animation out
 * deterministically.
 *
 * Each iteration re-issues `scrollIntoView` before checking: a settings
 * re-render (Convex subscription update) can reset the sheet's inner scroll
 * position after a caller's one-shot scroll, leaving the element below the
 * fold forever if the poll only reads the bounding box.
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
        await locator
          .evaluate((el) => el.scrollIntoView({ block: 'center' }))
          .catch(() => {}); // detached mid-render — next interval retries
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

// ---------------------------------------------------------------------------
// Billing-spec helpers (shared by billing.spec.ts and payment-overdue.spec.ts)
// ---------------------------------------------------------------------------

/** Standard Stripe test cards. 0341 attaches fine but fails every charge. */
export const STRIPE_TEST_CARD_OK = '4242 4242 4242 4242';
export const STRIPE_TEST_CARD_CHARGE_FAILS = '4000 0000 0000 0341';

export interface FreshUserPaths {
  /** e.g. "billing" → e2e-billing-<ts>-<rand>@flexling.com */
  prefix: string;
  storageStatePath: string;
  credentialsPath: string;
}

/**
 * Sign up a brand-new user, walk the default onboarding, and persist the
 * session + credentials to the given paths. Mirrors auth.setup.ts (which
 * cannot be imported because it registers its own test() calls). Used by
 * billing-state specs that need a fresh identity per invocation: billing
 * state lives in Autumn/Stripe and survives suite runs, so shared fixture
 * users can never be reused for it (and there is intentionally no cleanup;
 * operators can purge stragglers via admin/deleteUser:run).
 */
export async function signUpFreshUser(
  page: Page,
  { prefix, storageStatePath, credentialsPath }: FreshUserPaths,
): Promise<{ email: string; password: string; name: string }> {
  const crypto = await import('node:crypto');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const random = crypto.randomBytes(6).toString('hex');
  const creds = {
    // Shape is load-bearing. See `isE2EFixtureAddress` in
    // convex/lib/authEmails.ts (pinned by convex/tests/lib/authEmails.test.ts).
    email: `e2e-${prefix}-${Date.now()}-${random}@flexling.com`,
    password: `E2ePass!${random}`,
    name: `E2E ${prefix} ${random}`,
  };

  await page.goto('/auth/sign-up');
  await page.waitForLoadState('domcontentloaded');
  const nameField = page.getByLabel(/^name$/i);
  if (await nameField.count()) {
    await nameField.first().fill(creds.name);
  }
  await page.getByLabel(/email/i).first().fill(creds.email);
  const passwordFields = page.getByLabel(/password/i);
  const passwordCount = await passwordFields.count();
  for (let i = 0; i < passwordCount; i++) {
    await passwordFields.nth(i).fill(creds.password);
  }
  // Locale-proof: the banner copy is translated (en/de), so match the testid
  // rather than the accessible name. The banner mounts only after the
  // PostHog SDK boots (async), so an instant count() check races it. Wait a
  // bounded moment instead. Recording the decision here matters beyond this
  // page: PostHog persists it into localStorage, so the saved storageState
  // carries it and the banner never overlays (and steals clicks from)
  // bottom-anchored controls in dependent specs.
  const acceptCookies = page.getByTestId('consent-accept').first();
  await acceptCookies
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => acceptCookies.click())
    .catch(() => {}); // no banner: PostHog key absent or already answered
  await page
    .getByRole('button', {
      name: /create an account|create account|^sign\s*up$/i,
    })
    .click();
  // Email verification is required (convex/auth.ts), so the submit alone
  // does not create a session. Enter the captured 6-digit code to land
  // logged-in on /app/onboarding.
  await completeEmailVerification(page, creds.email);

  await completeOnboardingFresh(page, {});

  fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
  await page.context().storageState({ path: storageStatePath });
  fs.writeFileSync(
    credentialsPath,
    JSON.stringify({ ...creds, createdAt: new Date().toISOString() }, null, 2),
  );
  return creds;
}

// ---------------------------------------------------------------------------
// Auth-email helpers (email verification + password reset)
// ---------------------------------------------------------------------------

export interface CapturedAuthEmail {
  id: string;
  /** Reset link. Present on 'reset' emails. */
  url?: string;
  /** 6-digit verification code. Present on 'verify' emails. */
  otp?: string;
  subject: string;
}

/**
 * Read the most recent captured auth email for an address via the
 * E2E_TEST_HOOKS-gated Convex hook (convex/features/authEmailTesting.ts).
 * While that flag is set on the dev deployment, the backend captures
 * verification codes / reset links into a table instead of sending real
 * mail, so specs can use them. Polls until an email newer than
 * `opts.afterId` appears (pass the previous capture's id to wait for a
 * re-send), then returns it.
 */
export async function fetchAuthEmail(
  email: string,
  kind: 'verify' | 'reset',
  opts: { afterId?: string; timeoutMs?: number } = {},
): Promise<CapturedAuthEmail> {
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const repoRoot = path.resolve(__dirname, '..');
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = execFileSync(
      'pnpm',
      [
        'exec',
        'convex',
        'run',
        'features/authEmailTesting:latestAuthEmail',
        JSON.stringify({ email, kind }),
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    // `convex run` prints the function's return value (JSON) on stdout,
    // possibly surrounded by CLI noise. Parse the last JSON-looking chunk.
    const lines = out.trim().split('\n');
    let result: CapturedAuthEmail | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      try {
        result = JSON.parse(lines.slice(i).join('\n'));
        break;
      } catch {
        /* keep scanning upwards */
      }
    }
    if (result?.id && result.id !== opts.afterId) return result;
    if (Date.now() >= deadline) {
      throw new Error(
        `No ${kind} auth email captured for ${email} within ${timeoutMs}ms ` +
          '(is E2E_TEST_HOOKS=1 set on the dev deployment?)',
      );
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Complete the email-verification step after submitting the sign-up form.
 * better-auth-ui navigates to /auth/email-verification, where entering the
 * emailed 6-digit code verifies the address AND creates a session
 * (autoSignInAfterVerification in convex/auth.ts), landing the user on
 * /app/onboarding.
 */
export async function completeEmailVerification(
  page: Page,
  email: string,
): Promise<void> {
  await page.waitForURL(/\/auth\/email-verification/, { timeout: 30_000 });
  const { otp } = await fetchAuthEmail(email, 'verify');
  if (!otp) throw new Error('Captured verification email has no otp code');
  // input-otp renders a single hidden input; filling all 6 digits
  // auto-submits the form (see better-auth-ui's EmailVerificationForm).
  await page.locator('input[data-input-otp]').fill(otp);
  await page.waitForURL(/\/app\/onboarding/, { timeout: 30_000 });
}

/**
 * Neutralize driver.js tours for every document this page loads. A tour
 * can mount at ANY moment after hydration and `body.driver-active`
 * disables pointer events page-wide; injecting CSS before every document
 * load wins all of those races at once (see billing.spec.ts history).
 */
export async function neutralizeTours(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `
      .driver-overlay, .driver-popover { display: none !important; }
      body.driver-active, body.driver-active * { pointer-events: auto !important; }
    `;
    document.addEventListener('DOMContentLoaded', () =>
      document.head.appendChild(style),
    );
  });
}

/**
 * Fill Stripe's hosted test-mode checkout with the given test card and
 * submit, then wait to be redirected off the Stripe domain. Handles both
 * the plain-DOM and iframe-hosted card-field variants of the hosted page.
 */
export async function completeStripeTestCheckout(
  page: Page,
  {
    cardNumber = STRIPE_TEST_CARD_OK,
    email,
  }: { cardNumber?: string; email?: string } = {},
) {
  // "commit", not the default "load": Stripe's checkout page can hold the
  // load event open on a slow connection; the element waits below cover
  // actual readiness.
  await page.waitForURL(/checkout\.stripe\.com/, {
    timeout: 30_000,
    waitUntil: 'commit',
  });

  const emailField = page.locator('input#email');
  if (
    email &&
    (await emailField.count()) &&
    (await emailField.isEditable().catch(() => false))
  ) {
    await emailField.fill(email);
  }

  // The inline card form only renders once the "Card" payment-method
  // radio is checked, and the accordion renders asynchronously, so
  // selecting the radio is part of the retry loop. Normal clicks on the
  // styled row time out (the Link iframe overlays the hit area);
  // force-checking the radio input works.
  type CardFields = {
    number: ReturnType<Page['locator']>;
    expiry: ReturnType<Page['locator']>;
    cvc: ReturnType<Page['locator']>;
  };
  let fields: CardFields | undefined;
  await expect(async () => {
    const domFields = (): CardFields => ({
      number: page.locator('input#cardNumber'),
      expiry: page.locator('input#cardExpiry'),
      cvc: page.locator('input#cardCvc'),
    });
    if (await page.locator('input#cardNumber').count()) {
      fields = domFields();
      return;
    }
    const cardRadio = page.getByRole('radio', { name: /^card$/i }).first();
    if (await cardRadio.count()) {
      await cardRadio.check({ force: true, timeout: 2_000 }).catch(() => {});
      if (await page.locator('input#cardNumber').count()) {
        fields = domFields();
        return;
      }
    }
    for (const frame of page.frames()) {
      const inFrame = frame.locator('input[name="number"]');
      if (await inFrame.count().catch(() => 0)) {
        fields = {
          number: inFrame,
          expiry: frame.locator('input[name="expiry"]'),
          cvc: frame.locator('input[name="cvc"]'),
        };
        return;
      }
    }
    throw new Error('Stripe card fields not rendered yet');
  }).toPass({ timeout: 45_000, intervals: [1_000] });

  await fields!.number.fill(cardNumber);
  await fields!.expiry.fill('12 / 34');
  await fields!.cvc.fill('123');

  const name = page.locator('input#billingName');
  if ((await name.count()) && (await name.isVisible().catch(() => false))) {
    await name.fill('E2E Billing Test');
  }
  const country = page.locator('select#billingCountry');
  if (await country.count()) {
    await country.selectOption('DE').catch(() => {});
  }
  const postal = page.locator('input#billingPostalCode');
  if ((await postal.count()) && (await postal.isVisible().catch(() => false))) {
    await postal.fill('10115');
  }

  // Submit. Retried until the page actually leaves Stripe. The hosted page
  // has variants (classic, Link, and the Managed Payments layout with its
  // "Subscribe with obligation to pay" button) that mount or re-render the
  // pay button late, so a single early `.first()` click can land on the
  // wrong submit (or on nothing) while the form silently stays put, which
  // is exactly how the MoR variant made this helper time out. Prefer the
  // button by its pay wording, fall back to the classic locator, re-click
  // until the redirect happens.
  const offStripe = () => !/checkout\.stripe\.com/.test(page.url());
  await expect(async () => {
    if (offStripe()) return;
    const byText = page
      .locator('button.SubmitButton, button[type=submit]')
      .filter({ hasText: /subscribe|obligation to pay|pay now|start trial/i })
      .first();
    const target = (await byText.count())
      ? byText
      : page.locator('button.SubmitButton, button[type=submit]').first();
    await target.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForURL((url) => !/checkout\.stripe\.com/.test(url.href), {
      timeout: 20_000,
    });
  }).toPass({ timeout: 150_000, intervals: [1_000] });
}
