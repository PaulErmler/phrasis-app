import { test, expect, type Page } from '@playwright/test';
import {
  dismissConsent,
  dismissDifficultyCheck,
  dismissErrorBoundary,
  dismissTour,
  expectSignedIn,
  gotoAuthedApp,
  neutralizeTours,
  waitForInViewport,
} from './helpers';

/**
 * Course-settings sweep: flip every reachable control in the learning
 * settings sheet. Across Shadowing, Writing/Translate and Writing/Transcribe,
 * and assert no page error, no Convex validator rejection, and a sheet that
 * still renders. Complements the exhaustive Convex-level sweep
 * (convex/tests/features/courseSettingsSweep.test.ts, every patchable key ×
 * validator-derived samples): that one proves the API surface, this one
 * proves the UI wiring of every control writes cleanly through it.
 *
 * chromium-serial: every toggle is flipped an even number of times and the
 * review mode/writing style restored, so the shared user ends as it started.
 */

const IGNORED_CONSOLE = [
  /Failed to load resource/i, // dev-server noise (posthog, favicons)
  /React DevTools/i,
  /\[HMR\]/i,
];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

async function expectSheetOpen(page: Page, when: string): Promise<void> {
  await expect(
    page.getByTestId('learning-settings-sheet'),
    `learning settings sheet closed ${when}`,
  ).toBeVisible({ timeout: 5_000 });
}

async function openSession(page: Page): Promise<void> {
  await neutralizeTours(page);
  await gotoAuthedApp(
    page,
    '/app/learn',
    page.getByTestId('learn-settings').first(),
  );
  await expectSignedIn(page);
  await dismissConsent(page);
  await dismissErrorBoundary(page);
  await dismissDifficultyCheck(page);
  await dismissTour(page, 'audio_review_intro', 500);
  await dismissTour(page, 'full_review_intro', 500);
  await dismissTour(page, undefined, 500);
}

async function openSheet(page: Page): Promise<void> {
  await dismissErrorBoundary(page);
  await dismissDifficultyCheck(page);
  const trigger = page.getByTestId('learn-settings').first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  await expectSheetOpen(page, 'after clicking learn-settings');
  await page.waitForTimeout(550); // slide-in animation
}

async function clickInSheet(
  page: Page,
  locator: ReturnType<Page['locator']>,
  when: string,
): Promise<void> {
  await expectSheetOpen(page, `before ${when}`);
  await waitForInViewport(page, locator);
  // Real mouse clicks (even `force: true`) use viewport coordinates. When
  // a sheet control is clipped, mid-transform, or the inner scroll jumps
  // after a Convex re-render, those coordinates land on the overlay and
  // Radix dismisses the sheet. The learn card underneath then receives
  // the click (rating buttons). Activate the control via the DOM instead:
  // Radix Switch / Radio / Button all honor `HTMLElement.click()`, and
  // there is no pointer event for the overlay to treat as "outside".
  await locator.evaluate((el) => (el as HTMLElement).click());
  await expectSheetOpen(page, `after ${when}`);
}

async function setMode(page: Page, mode: 'audio' | 'full'): Promise<void> {
  const btn = page.getByTestId(`settings-mode-${mode}`).first();
  await clickInSheet(page, btn, `switching review mode to ${mode}`);
  await page.waitForTimeout(700); // optimistic write + settle
}

async function setWritingStyle(
  page: Page,
  style: 'translate' | 'transcribe',
): Promise<void> {
  const btn = page.getByTestId(`settings-writing-${style}`).first();
  await clickInSheet(page, btn, `switching writing style to ${style}`);
  await page.waitForTimeout(700);
}

/** Drive one switch to an explicit state by DOM id, in the same sheet-scoped
 *  idiom as flipEverySwitchTwice. */
async function setSwitchById(
  page: Page,
  id: string,
  on: boolean,
): Promise<void> {
  const sheet = page.getByTestId('learning-settings-sheet');
  const sw = sheet.locator(`[id=${JSON.stringify(id)}]`);
  await expect(sw).toBeVisible({ timeout: 8_000 });
  if ((await sw.getAttribute('aria-checked')) === String(on)) return;
  await clickInSheet(page, sw, `setting #${id} to ${on}`);
  await expect
    .poll(() => sw.getAttribute('aria-checked'), { timeout: 8_000 })
    .toBe(String(on));
}

/** Mirror of setWritingStyle for the Shadowing-side Review/Radio scope pill.
 *  Only rendered while `separateRadioSettings` is on. */
async function setAudioScope(
  page: Page,
  scope: 'review' | 'radio',
): Promise<void> {
  const btn = page.getByTestId(`settings-scope-${scope}`).first();
  await clickInSheet(page, btn, `switching audio scope to ${scope}`);
  await page.waitForTimeout(700);
}

/**
 * Toggle every Radix switch currently in the sheet twice (on/off back to the
 * original value), each click is a real updateCourseSettings write. Switches
 * are addressed by DOM id (CSS ignores the aria-hidden Radix sometimes sets
 * on the SheetContent); each interaction is labeled so a failure names the
 * control.
 */
async function flipEverySwitchTwice(page: Page, phase: string): Promise<void> {
  const sheet = page.getByTestId('learning-settings-sheet');
  const ids = await sheet
    .locator('[role="switch"][id]')
    .evaluateAll((els) => els.map((el) => el.id));
  for (const id of ids) {
    for (let i = 0; i < 2; i++) {
      // Quoted attribute selector: CSS.escape is a browser global, absent
      // in the Node runner. Scoped to the sheet so a clipped force-click
      // cannot hit the learn view and dismiss the sheet.
      const sw = sheet.locator(`[id=${JSON.stringify(id)}]`);
      if (!(await sw.isVisible().catch(() => false))) break; // mutual-exclusion pairs can hide
      await clickInSheet(
        page,
        sw,
        `[${phase}] switch #${id} click ${i + 1}`,
      ).catch((e) => {
        throw new Error(`[${phase}] switch #${id} click ${i + 1} failed: ${e}`);
      });
      await page.waitForTimeout(350); // let the write land before the next
    }
  }
}

/** Select every listening-strategy option (audio mode), ending on the
 *  original selection. */
async function cycleListeningStrategies(page: Page): Promise<void> {
  const sheet = page.getByTestId('learning-settings-sheet');
  const rows = sheet.locator('[data-testid^="listening-strategy-"]');
  const count = await rows.count();
  if (count === 0) return;
  const original = await rows.evaluateAll((els) =>
    els.findIndex((el) => el.querySelector('[data-state="checked"]') != null),
  );
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    await clickInSheet(page, row, `listening strategy ${i}`);
    await page.waitForTimeout(400);
  }
  if (original >= 0) {
    const row = rows.nth(original);
    await clickInSheet(page, row, 'listening strategy restore');
    await page.waitForTimeout(400);
  }
}

test.describe('course settings: full UI sweep', () => {
  test('every control in every mode writes without errors', async ({
    page,
  }) => {
    test.setTimeout(240_000); // dozens of sequential settings writes

    const errors = collectErrors(page);
    await openSession(page);
    await openSheet(page);

    // --- Shadowing (audio) ---
    await setMode(page, 'audio');
    await flipEverySwitchTwice(page, 'audio');
    await cycleListeningStrategies(page);

    // --- Shadowing / Radio scope ---
    // The split writes the `*Radio` copies, a whole second set of fields the
    // sweep would otherwise never exercise. Flipping the switch on first is
    // itself a write; the pill only appears afterwards.
    await setSwitchById(page, 'separateRadioSettings', true);
    await setAudioScope(page, 'radio');
    await flipEverySwitchTwice(page, 'audio/radio');
    await cycleListeningStrategies(page);
    await setAudioScope(page, 'review');
    await setSwitchById(page, 'separateRadioSettings', false);

    // --- Writing / Translate ---
    await setMode(page, 'full');
    await setWritingStyle(page, 'translate');
    await flipEverySwitchTwice(page, 'full/translate');

    // --- Writing / Transcribe ---
    await setWritingStyle(page, 'transcribe');
    await flipEverySwitchTwice(page, 'full/transcribe');

    // Restore: writing style back to translate, review mode back to audio.
    await setWritingStyle(page, 'translate');
    await setMode(page, 'audio');

    // The sheet must still be alive and interactive after the whole sweep.
    await expect(page.getByTestId('learning-settings-sheet')).toBeVisible();

    // No client crash and no rejected settings write anywhere in the sweep.
    const fatal = errors.filter(
      (e) =>
        e.startsWith('pageerror:') ||
        /ConvexError|ArgumentValidationError|ValidationError|Server Error/i.test(
          e,
        ),
    );
    expect(fatal, `errors during settings sweep:\n${fatal.join('\n')}`).toEqual(
      [],
    );
  });
});
