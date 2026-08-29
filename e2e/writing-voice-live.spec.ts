import { test, expect, type Page } from '@playwright/test';
import {
  dismissDifficultyCheck,
  dismissErrorBoundary,
  dismissTour,
  gotoAuthedApp,
  isSelectedTestId,
} from './helpers';

/**
 * Writing-mode voice input (live): drive the mic button through its full
 * record → stop → transcribe round trip against the real backend, with
 * Chromium's fake media stream standing in for the microphone.
 *
 * The fake device feeds a synthetic tone, so the Azure transcript content
 * is not assertable — what IS asserted is the state machine around it: the
 * button records on first click (destructive ring), leaves the recording
 * state on the second, and settles back to idle instead of wedging in the
 * transcribing state (the transcribe action ran, successfully or not, and
 * the UI recovered). Bills at most one `transcriptions` unit.
 *
 * chromium-serial: flips the shared user's review mode to Writing and back.
 * Own spec file because the fake-media launch args are worker-scoped.
 */

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

async function openSettingsSheet(page: Page): Promise<void> {
  await dismissErrorBoundary(page);
  await dismissDifficultyCheck(page);
  const trigger = page.getByTestId('learn-settings').first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  await expect(page.getByTestId('learning-settings-sheet').first()).toBeVisible(
    { timeout: 8_000 },
  );
  await page.waitForTimeout(550); // slide-in animation
}

async function setReviewMode(
  page: Page,
  mode: 'full' | 'audio',
): Promise<void> {
  await openSettingsSheet(page);
  const btn = page.getByTestId(`settings-mode-${mode}`).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  if (!(await isSelectedTestId(page, `settings-mode-${mode}`))) {
    await btn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, `settings-mode-${mode}`), {
        timeout: 8_000,
      })
      .toBe(true);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

test.describe('writing voice input (live)', { tag: '@live' }, () => {
  test.describe.configure({ retries: 0 });

  test.beforeEach(async ({ page }) => {
    await gotoAuthedApp(
      page,
      '/app/learn',
      page.getByTestId('learn-settings').first(),
    );
    await dismissTour(page, 'audio_review_intro', 500);
    await dismissTour(page, 'full_review_intro', 500);
    await setReviewMode(page, 'full');
  });

  test.afterEach(async ({ page }) => {
    await dismissTour(page).catch(() => {});
    await setReviewMode(page, 'audio').catch(() => {});
  });

  test('the mic button records, stops, and settles back to idle', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await dismissTour(page, 'full_review_intro', 500);

    // Spanish (the fixture target) supports STT, so the row has a mic.
    const mic = page.getByTestId('writing-voice-button').first();
    await expect(mic).toBeVisible({ timeout: 15_000 });
    await expect(mic).toBeEnabled();

    // The button reports its state machine through aria-label (idle →
    // recording → transcribing → idle). Track the label rather than any
    // class: the outline-button base classes contain
    // `aria-invalid:border-destructive`, so a class regex matches in EVERY
    // state. Comparing against the captured idle label stays locale-proof.
    const idleLabel = await mic.getAttribute('aria-label');
    expect(idleLabel).toBeTruthy();

    // First click: recording.
    await mic.click();
    await expect
      .poll(() => mic.getAttribute('aria-label'), { timeout: 10_000 })
      .not.toBe(idleLabel);

    // Capture a beat of "audio" (the fake device's tone), then stop.
    await page.waitForTimeout(1_500);
    await mic.click();

    // The transcribe round trip must complete rather than wedge: the
    // button settles back to the enabled idle state. While waiting, watch
    // for the empty-transcript toast — sonner dismisses it after a few
    // seconds, so it has to be caught during the settle poll, not after.
    const input = page.getByTestId('learn-translation-input').first();
    const emptyToast = page.getByText(/no speech detected/i).first();
    let sawEmptyToast = false;
    await expect
      .poll(
        async () => {
          sawEmptyToast ||= await emptyToast.isVisible().catch(() => false);
          return mic.getAttribute('aria-label');
        },
        { timeout: 90_000 },
      )
      .toBe(idleLabel);
    await expect(mic).toBeEnabled();

    // Terminal outcome is transcript-dependent, but never a silent blank
    // submit: an empty transcript toasts and leaves the row open; a
    // non-empty one fills the input and submits it (input gone or filled).
    const inputStillOpen = await input.isVisible().catch(() => false);
    const inputValue = inputStillOpen
      ? await input.inputValue().catch(() => '')
      : '';
    const submitted = !inputStillOpen || inputValue.trim() !== '';
    expect(sawEmptyToast || submitted).toBe(true);
    if (sawEmptyToast) {
      // The guard must not have submitted a blank answer.
      expect(inputStillOpen).toBe(true);
      expect(inputValue.trim()).toBe('');
    }
  });
});
