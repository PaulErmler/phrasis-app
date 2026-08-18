import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  dismissDifficultyCheck,
  dismissErrorBoundary,
  dismissTour,
  gotoAuthedApp,
  isSelectedTestId,
  waitForInViewport,
} from "./helpers";

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
  // A Convex query error under @live suite load replaces LearnView with the
  // view error boundary ("Something went wrong") — the settings gear is gone
  // until retry remounts the subtree. The difficulty-check dialog also
  // aria-hides the header. Clear both before looking for the trigger.
  await dismissErrorBoundary(page);
  await dismissDifficultyCheck(page);

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

/** Ensure the settings sheet is in Audio review mode (the Practice Listening /
 *  Speaking toggles only render there) and that the mode has SETTLED there.
 *
 *  The sheet renders from an optimistic cache (`updateSettings` in
 *  LearningModeSettings carries a `withOptimisticUpdate`), so a single
 *  "audio selected" reading can be a value the server later rolls back to
 *  'full' — unmounting the practice switches mid-test. Require the selection
 *  to survive a settle window (covering the server round-trip) and re-click
 *  when it snaps back.
 *
 *  Retries back off across ~15s: the known cause of a persistent snap-back is
 *  a transient JWT refresh window (see ClientAuthBoundary), during which every
 *  authenticated mutation is rejected and its optimistic update rolled back —
 *  the loop must outlast the window, not just re-click inside it. */
async function ensureAudioMode(page: Page): Promise<void> {
  const audioBtn = page.getByTestId("settings-mode-audio").first();
  await expect(audioBtn).toBeVisible({ timeout: 10_000 });
  const backoffsMs = [0, 500, 1_000, 2_000, 4_000, 6_000];
  for (let attempt = 0; ; attempt++) {
    if (!(await isSelectedTestId(page, "settings-mode-audio"))) {
      if (attempt >= backoffsMs.length) {
        throw new Error(
          "settings-mode-audio kept snapping back to full — reviewMode write rejected across every retry (auth refresh window should have passed by now)",
        );
      }
      await page.waitForTimeout(backoffsMs[attempt]);
      // The sheet may be scrolled down to a lower section; the mode switcher
      // sits at the top, so bring it back into view before waiting on it.
      await audioBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await waitForInViewport(page, audioBtn);
      await audioBtn.click({ force: true });
      await expect
        .poll(() => isSelectedTestId(page, "settings-mode-audio"), {
          timeout: 5_000,
        })
        .toBe(true);
    }
    await page.waitForTimeout(600);
    if (await isSelectedTestId(page, "settings-mode-audio")) return;
  }
}

/** Mirror of ensureAudioMode for the Writing ("full") review mode — the
 *  writing-style sub-switcher and writing-only settings render there. Same
 *  optimistic-rollback/backoff rationale, see ensureAudioMode. */
async function ensureFullMode(page: Page): Promise<void> {
  const fullBtn = page.getByTestId("settings-mode-full").first();
  await expect(fullBtn).toBeVisible({ timeout: 10_000 });
  const backoffsMs = [0, 500, 1_000, 2_000, 4_000, 6_000];
  for (let attempt = 0; ; attempt++) {
    if (!(await isSelectedTestId(page, "settings-mode-full"))) {
      if (attempt >= backoffsMs.length) {
        throw new Error(
          "settings-mode-full kept snapping back to audio — reviewMode write rejected across every retry",
        );
      }
      await page.waitForTimeout(backoffsMs[attempt]);
      await fullBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await waitForInViewport(page, fullBtn);
      await fullBtn.click({ force: true });
      await expect
        .poll(() => isSelectedTestId(page, "settings-mode-full"), {
          timeout: 5_000,
        })
        .toBe(true);
    }
    await page.waitForTimeout(600);
    if (await isSelectedTestId(page, "settings-mode-full")) return;
  }
}

/** Ensure the Writing style sub-toggle is on the given style. The sheet must
 *  already be in Writing mode (call ensureFullMode first). */
async function ensureWritingStyle(
  page: Page,
  style: "translate" | "transcribe",
): Promise<void> {
  const btn = page.getByTestId(`settings-writing-${style}`).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  if (await isSelectedTestId(page, `settings-writing-${style}`)) return;
  await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await waitForInViewport(page, btn);
  await btn.click({ force: true });
  await expect
    .poll(() => isSelectedTestId(page, `settings-writing-${style}`), {
      timeout: 8_000,
    })
    .toBe(true);
}

// Generic switch access by DOM id (CSS selectors ignore the aria-hidden Radix
// sometimes sets on the sheet). Used for the per-mode auto-play switch and the
// writing-mode hide-base pair.
function switchById(page: Page, id: string): Locator {
  return page.locator(`#${id}`);
}

async function isSwitchOnById(page: Page, id: string): Promise<boolean> {
  return (
    (await switchById(page, id).getAttribute("aria-checked")) === "true"
  );
}

async function clickSwitchById(page: Page, id: string): Promise<void> {
  const sw = switchById(page, id);
  await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await waitForInViewport(page, sw);
  await sw.click({ force: true });
}

/** Click the switch until it reaches (and keeps) the desired checked state. */
async function setSwitchById(
  page: Page,
  id: string,
  on: boolean,
): Promise<void> {
  if ((await isSwitchOnById(page, id)) === on) return;
  await clickSwitchById(page, id);
  await expect
    .poll(() => isSwitchOnById(page, id), { timeout: 8_000 })
    .toBe(on);
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

/** Scroll a practice switch into the sheet's visible area, then click it.
 *  The sheet is position:fixed with an inner overflow scroll; when both
 *  toggles are on the audio-playback section grows and pushes these switches
 *  above the fold (especially after the Shadowing/Writing mode blurbs).
 *
 *  Re-asserts Audio mode first: the switches unmount whenever the sheet
 *  leaves it, and the optimistic reviewMode value can roll back to the
 *  persisted 'full' mid-test (see ensureAudioMode) — clicking a vanished
 *  switch then fails on a null bounding box. */
async function clickPracticeSwitch(
  page: Page,
  which: "before" | "after",
): Promise<void> {
  await ensureAudioMode(page);
  const sw = practiceSwitch(page, which);
  await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await waitForInViewport(page, sw);
  await sw.click({ force: true });
}

/** Click the switch and wait until it reaches the desired checked state. Turning
 *  a switch ON never disables the other, so this is safe for normalization. */
async function setSwitch(
  page: Page,
  which: "before" | "after",
  on: boolean,
): Promise<void> {
  // Mode guard before isSwitchOn: on a mode snap-back the switch is unmounted
  // and getAttribute would hang until the test timeout instead of failing fast.
  await ensureAudioMode(page);
  if ((await isSwitchOn(page, which)) === on) return;
  await clickPracticeSwitch(page, which);
  await expectSwitch(page, which, on);
}

test.describe("learning settings", () => {
  test("toggle review mode between audio and full", async ({ page }) => {
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
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
    // /app/learn can take >30s for the full `load` event under serial-suite
    // load even though the overlay is already interactive.
    test.setTimeout(60_000);

    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
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
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
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
    await clickPracticeSwitch(page, "before");
    await expectSwitch(page, "before", true);

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    await openSettingsSheet(page);
    await ensureAudioMode(page);
    await expectSwitch(page, "before", true);

    // Restore the default so later serial specs start clean.
    await clickPracticeSwitch(page, "before");
    await expectSwitch(page, "before", false);
    await expectSwitch(page, "after", true);

    await page.keyboard.press("Escape").catch(() => {});
  });

  test("Practice toggles keep at least one enabled (mutual exclusion)", async ({
    page,
  }) => {
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
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
    await clickPracticeSwitch(page, "after");
    await expectSwitch(page, "after", false);
    await expectSwitch(page, "before", true);

    // And the mirror: turning the now-last-on Listening off re-enables Speaking.
    await clickPracticeSwitch(page, "before");
    await expectSwitch(page, "before", false);
    await expectSwitch(page, "after", true); // back to the default → clean state

    await page.keyboard.press("Escape").catch(() => {});
  });

  test("writing style sub-toggle renders in Writing mode and persists", async ({
    page,
  }) => {
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);

    // Not rendered in audio mode.
    await ensureAudioMode(page);
    await expect(
      page.getByTestId("settings-writing-transcribe"),
    ).toHaveCount(0);

    // Renders in Writing mode.
    await ensureFullMode(page);
    const translateBtn = page
      .getByTestId("settings-writing-translate")
      .first();
    const transcribeBtn = page
      .getByTestId("settings-writing-transcribe")
      .first();
    await expect(translateBtn).toBeVisible({ timeout: 8_000 });
    await expect(transcribeBtn).toBeVisible();

    // Normalize to Translate first — a previously failed spec can leave the
    // shared user on Transcribe, and the assertions below assume the
    // Translate starting point.
    await translateBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await waitForInViewport(page, translateBtn);
    await translateBtn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, "settings-writing-translate"), {
        timeout: 8_000,
      })
      .toBe(true);
    // Translate mode shows the target-audio setting; Transcribe hides it
    // (the merged target audio IS the prompt there).
    await expect(switchById(page, "targetAudioEnabled")).toBeVisible();
    // With target audio in its default 'afterSubmit' mode, the playback
    // timeline shows the post-submit target group behind the
    // "Translation Entered" pill (normalize the sub-switch first — a prior
    // run may have left 'always' selected).
    await setSwitchById(page, "targetAudioEnabled", true);
    await setSwitchById(page, "targetAudio_afterSubmit", true);
    await expect(
      page.getByText(/translation entered/i).first(),
    ).toBeVisible({ timeout: 8_000 });

    await transcribeBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await waitForInViewport(page, transcribeBtn);
    await transcribeBtn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, "settings-writing-transcribe"), {
        timeout: 8_000,
      })
      .toBe(true);
    await expect(switchById(page, "targetAudioEnabled")).toHaveCount(0);

    // Survives a sheet close/reopen.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    await openSettingsSheet(page);
    await ensureFullMode(page);
    await expect
      .poll(() => isSelectedTestId(page, "settings-writing-transcribe"), {
        timeout: 8_000,
      })
      .toBe(true);

    // Restore Translate + audio mode so later specs start clean.
    await translateBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await waitForInViewport(page, translateBtn);
    await translateBtn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, "settings-writing-translate"), {
        timeout: 8_000,
      })
      .toBe(true);
    await ensureAudioMode(page);
    await page.keyboard.press("Escape").catch(() => {});
  });

  test("playback settings are independent between Shadowing and Writing", async ({
    page,
  }) => {
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);

    // Note the audio-mode auto-play state (one of the split settings). No
    // assertion on the initial writing-mode value: it mirrors audio only
    // while the Full field has never been written for this user, which a
    // prior run of this spec already did.
    await ensureAudioMode(page);
    const audioAutoPlay = await isSwitchOnById(page, "autoPlayAudio");

    // Editing auto-play in Writing/Translate must NOT touch the audio-mode
    // value. Normalize the style first — within Writing, Translate and
    // Transcribe each have their own copy too.
    await ensureFullMode(page);
    await ensureWritingStyle(page, "translate");
    const fullAutoPlay = await isSwitchOnById(page, "autoPlayAudio");
    await clickSwitchById(page, "autoPlayAudio");
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(!fullAutoPlay);

    await ensureAudioMode(page);
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(audioAutoPlay);

    // The writing-mode edit persisted independently.
    await ensureFullMode(page);
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(!fullAutoPlay);

    // And the mirror direction: toggling audio-mode auto-play leaves the
    // writing-mode value alone.
    await ensureAudioMode(page);
    await clickSwitchById(page, "autoPlayAudio");
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(!audioAutoPlay);
    await ensureFullMode(page);
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(!fullAutoPlay);

    // Transcribe carries its own copy: toggling auto-play there leaves the
    // Translate value alone.
    await ensureWritingStyle(page, "transcribe");
    const transcribeAutoPlay = await isSwitchOnById(page, "autoPlayAudio");
    await clickSwitchById(page, "autoPlayAudio");
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(!transcribeAutoPlay);
    await ensureWritingStyle(page, "translate");
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(!fullAutoPlay);
    // …and the transcribe edit persisted independently.
    await ensureWritingStyle(page, "transcribe");
    await expect
      .poll(() => isSwitchOnById(page, "autoPlayAudio"), { timeout: 8_000 })
      .toBe(!transcribeAutoPlay);
    await setSwitchById(page, "autoPlayAudio", transcribeAutoPlay);
    await ensureWritingStyle(page, "translate");

    // Restore all modes to their starting values, sheet back to audio mode.
    await setSwitchById(page, "autoPlayAudio", fullAutoPlay);
    await ensureAudioMode(page);
    await setSwitchById(page, "autoPlayAudio", audioAutoPlay);
    await page.keyboard.press("Escape").catch(() => {});
  });

  test("transcribe style drives the writing card: prompt, hidden base, reveal on submit", async ({
    page,
  }) => {
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);
    await ensureFullMode(page);

    // Transcribe + hide base languages (reveal-on-submit stays default ON).
    const transcribeBtn = page
      .getByTestId("settings-writing-transcribe")
      .first();
    await transcribeBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await waitForInViewport(page, transcribeBtn);
    await transcribeBtn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, "settings-writing-transcribe"), {
        timeout: 8_000,
      })
      .toBe(true);
    await setSwitchById(page, "hideBaseLanguagesFull", true);
    await setSwitchById(page, "autoRevealBaseOnSubmit", true);

    await page.keyboard.press("Escape").catch(() => {});
    await page
      .getByTestId("learning-settings-sheet")
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => {});
    await dismissTour(page, "full_review_intro", 1_000);

    // Wait for the writing card's input, recovering from a filter-blocked
    // deck the same way learning-journey.spec.ts does.
    const input = page.getByTestId("learn-translation-input").first();
    const includeOther = page
      .getByTestId("filter-blocked-include-other")
      .first();
    const waitForInput = () =>
      input
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    let inputVisible = await waitForInput();
    if (!inputVisible && (await includeOther.isVisible().catch(() => false))) {
      await includeOther.click().catch(() => {});
      inputVisible = await waitForInput();
    }
    expect(
      inputVisible,
      "Writing-card input should mount in transcribe style",
    ).toBe(true);

    // Transcribe swaps the placeholder from "Type the translation..." to
    // "Type what you hear...".
    await expect(input).toHaveAttribute("placeholder", /what you hear/i);

    // Hide-base blurs the base row until every translation is submitted.
    const blurred = page.locator(".blur-sm");
    await expect
      .poll(() => blurred.count(), { timeout: 8_000 })
      .toBeGreaterThan(0);

    await input.fill("asdf transcription answer");
    await input.press("Enter");

    // Reveal-on-submit: once all inputs are submitted the base un-blurs.
    await expect.poll(() => blurred.count(), { timeout: 8_000 }).toBe(0);

    // Restore: Translate style, hide-base off, audio mode.
    await openSettingsSheet(page);
    await ensureFullMode(page);
    await setSwitchById(page, "hideBaseLanguagesFull", false);
    const translateBtn = page
      .getByTestId("settings-writing-translate")
      .first();
    await translateBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await waitForInViewport(page, translateBtn);
    await translateBtn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, "settings-writing-translate"), {
        timeout: 8_000,
      })
      .toBe(true);
    await ensureAudioMode(page);
    await page.keyboard.press("Escape").catch(() => {});
  });

  test("writing-mode hide base languages with reveal-on-submit sub-setting", async ({
    page,
  }) => {
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);

    // The writing-mode pair only renders in Writing mode.
    await ensureAudioMode(page);
    await expect(switchById(page, "hideBaseLanguagesFull")).toHaveCount(0);

    await ensureFullMode(page);
    await expect(switchById(page, "hideBaseLanguagesFull")).toBeVisible({
      timeout: 8_000,
    });
    // Sub-setting is hidden until the main switch is on.
    await setSwitchById(page, "hideBaseLanguagesFull", false);
    await expect(switchById(page, "autoRevealBaseOnSubmit")).toHaveCount(0);

    await setSwitchById(page, "hideBaseLanguagesFull", true);
    await expect(switchById(page, "autoRevealBaseOnSubmit")).toBeVisible({
      timeout: 8_000,
    });

    // Sub-setting round-trips.
    await setSwitchById(page, "autoRevealBaseOnSubmit", false);
    await setSwitchById(page, "autoRevealBaseOnSubmit", true);

    // Turning the main switch off hides the sub-setting again.
    await setSwitchById(page, "hideBaseLanguagesFull", false);
    await expect(switchById(page, "autoRevealBaseOnSubmit")).toHaveCount(0);

    // Restore audio mode so later specs start clean.
    await ensureAudioMode(page);
    await page.keyboard.press("Escape").catch(() => {});
  });

  test("separate progress per mode toggle renders in the mode card and persists", async ({
    page,
  }) => {
    // `gotoAuthedApp`, not a bare goto: under serial-suite load the
    // authed layout's preloads can leave the Next splash ("Flexling"
    // logo, no shell) up past the 10s trigger wait, failing with
    // "learn-settings trigger should render" (seen 2026-08-18). One
    // reload picks up the warmed route — same helper the other learn
    // specs already use.
    await gotoAuthedApp(
      page,
      "/app/learn",
      page.getByTestId("learn-settings").first(),
    );
    await dismissTour(page, "audio_review_intro", 500);
    await dismissTour(page, "full_review_intro", 500);

    await openSettingsSheet(page);

    // The switch lives inside the Shadowing/Writing description card and is
    // mode-independent — it must render in BOTH modes (unlike e.g. the
    // writing-style sub-toggle).
    await ensureAudioMode(page);
    await expect(switchById(page, "separateModeTracking")).toBeVisible({
      timeout: 8_000,
    });
    await ensureFullMode(page);
    await expect(switchById(page, "separateModeTracking")).toBeVisible({
      timeout: 8_000,
    });

    // Normalize OFF first — the shared e2e user may carry state from a
    // previously failed run.
    await setSwitchById(page, "separateModeTracking", false);

    // Toggle ON and confirm it survives a sheet close/reopen (i.e. the value
    // persisted via updateCourseSettings, not just the optimistic cache).
    await setSwitchById(page, "separateModeTracking", true);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    await openSettingsSheet(page);
    await expect
      .poll(() => isSwitchOnById(page, "separateModeTracking"), {
        timeout: 8_000,
      })
      .toBe(true);

    // With the split on, the learn view must still serve a reviewable card in
    // Writing mode: enabling the toggle schedules the seedWritingTrack
    // backfill, which copies each card's shared schedule into the writing
    // fields within a scheduler hop or two — the input's 15s wait below
    // comfortably covers it. Recover from a filter-blocked deck the same way
    // learning-journey.spec.ts does.
    await ensureFullMode(page);
    await page.keyboard.press("Escape").catch(() => {});
    await page
      .getByTestId("learning-settings-sheet")
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => {});
    await dismissTour(page, "full_review_intro", 1_000);

    const input = page.getByTestId("learn-translation-input").first();
    const includeOther = page
      .getByTestId("filter-blocked-include-other")
      .first();
    const waitForInput = () =>
      input
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    let inputVisible = await waitForInput();
    if (!inputVisible && (await includeOther.isVisible().catch(() => false))) {
      await includeOther.click().catch(() => {});
      inputVisible = await waitForInput();
    }
    expect(
      inputVisible,
      "Writing card should mount from the writing-track due queue with the split enabled",
    ).toBe(true);

    // Restore: split off, audio mode, so later specs start clean.
    await openSettingsSheet(page);
    await setSwitchById(page, "separateModeTracking", false);
    await ensureAudioMode(page);
    await page.keyboard.press("Escape").catch(() => {});
  });

  /**
   * The promise of separate progress, end to end: a Writing review advances
   * ONLY the writing schedule, so the same card is still waiting on the
   * Shadowing side — and the home due-count pills, which read whichever
   * track's aggregates the mode selects, keep rendering across the flip.
   *
   * Tagged @live: rating a card mutates the shared e2e user's review state
   * (same reasoning as learning-undo.spec.ts).
   */
  test(
    "separate progress: a Writing review leaves the Shadowing queue untouched",
    { tag: "@live" },
    async ({ page }) => {
      test.setTimeout(120_000);
      // `gotoAuthedApp`, not a bare goto: under serial-suite load the
      // authed layout's preloads can leave the Next splash ("Flexling"
      // logo, no shell) up past the 10s trigger wait, failing with
      // "learn-settings trigger should render" (seen 2026-08-18). One
      // reload picks up the warmed route — same helper the other learn
      // specs already use.
      await gotoAuthedApp(
        page,
        "/app/learn",
        page.getByTestId("learn-settings").first(),
      );
      await dismissTour(page, "audio_review_intro", 500);
      await dismissTour(page, "full_review_intro", 500);

      await openSettingsSheet(page);
      // Normalize from whatever a previous run left behind, then enable.
      await setSwitchById(page, "separateModeTracking", false);
      await setSwitchById(page, "separateModeTracking", true);
      await ensureFullMode(page);
      await page.keyboard.press("Escape").catch(() => {});
      await page
        .getByTestId("learning-settings-sheet")
        .first()
        .waitFor({ state: "hidden", timeout: 5_000 })
        .catch(() => {});
      await dismissTour(page, "full_review_intro", 1_000);

      // --- Writing review: identify the served card, then rate it ---------
      const flashcard = page.locator('[data-tutorial="card-flashcard"]').first();
      await expect(
        flashcard,
        "a writing-track card should be served once the seed lands",
      ).toBeVisible({ timeout: 20_000 });
      const writingCardText = (await flashcard.innerText()).trim();

      const input = page.getByTestId("learn-translation-input").first();
      await input.waitFor({ state: "visible", timeout: 15_000 });
      await input.fill("skip", { timeout: 5_000 });
      await input.press("Enter", { timeout: 5_000 });

      // instantProceedFull defaults to true, so a rating click commits and
      // advances in one step.
      const ratings = page.locator(
        '[data-testid="learn-rating-good"], [data-testid="learn-rating-easy"], [data-testid="learn-rating-hard"], [data-testid="learn-rating-again"]',
      );
      await ratings.first().waitFor({ state: "visible", timeout: 15_000 });
      await ratings.first().click({ timeout: 5_000 });
      // Let the review mutation commit before reading the other track.
      await page.waitForTimeout(1_500);

      // --- Flip to Shadowing: the shared schedule never saw that review ----
      await openSettingsSheet(page);
      await ensureAudioMode(page);
      await page.keyboard.press("Escape").catch(() => {});
      await page
        .getByTestId("learning-settings-sheet")
        .first()
        .waitFor({ state: "hidden", timeout: 5_000 })
        .catch(() => {});
      await dismissTour(page, "audio_review_intro", 1_000);

      await expect(
        flashcard,
        "the shared track still serves a card after a writing-only review",
      ).toBeVisible({ timeout: 20_000 });
      // The just-reviewed card is still due on the shared track — it is the
      // head of that queue, so it is exactly what Shadowing serves. (With the
      // tracks wrongly coupled, the review would have pushed it out and some
      // other card, or an empty state, would show here.)
      expect(
        (await flashcard.innerText()).trim(),
        "the writing review must not have advanced the shared schedule",
      ).toContain(writingCardText.split("\n")[0]?.trim() ?? "");

      // --- Home pills survive the track flip ------------------------------
      await page.goto("/app");
      await page.waitForLoadState("domcontentloaded");
      const pills = page.getByTestId("due-counts-pills");
      await expect(pills).toBeVisible({ timeout: 15_000 });
      // Flip the home Shadowing/Writing toggle: the counts re-query against
      // the other track's aggregates and the row must stay rendered (never
      // collapse to a bare "nothing to study").
      const writingToggle = page
        .locator('[data-tutorial="review-mode-toggle"] button')
        .nth(1);
      await writingToggle.click({ timeout: 5_000 }).catch(() => {});
      await expect(pills).toBeVisible({ timeout: 15_000 });

      // Restore: split off, audio mode, so later specs start clean.
      // `gotoAuthedApp`, not a bare goto: under serial-suite load the
      // authed layout's preloads can leave the Next splash ("Flexling"
      // logo, no shell) up past the 10s trigger wait, failing with
      // "learn-settings trigger should render" (seen 2026-08-18). One
      // reload picks up the warmed route — same helper the other learn
      // specs already use.
      await gotoAuthedApp(
        page,
        "/app/learn",
        page.getByTestId("learn-settings").first(),
      );
      await openSettingsSheet(page);
      await setSwitchById(page, "separateModeTracking", false);
      await ensureAudioMode(page);
      await page.keyboard.press("Escape").catch(() => {});
    },
  );
});
