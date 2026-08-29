import { test, expect, type Page } from '@playwright/test';
import { dismissTour } from './helpers';
import { UNDO_DEPTH } from '../lib/constants/learning';

/**
 * Learning undo (LIVE), the undo-last-review button in learning mode:
 *   rate a card → undo → the same card comes back; exhaust the stack
 *   (UNDO_DEPTH entries) → the button greys out.
 *
 * Serial and in the chromium-serial project because rating + undoing mutates
 * the shared user's review state. Runs after learning-journey/-settings
 * (alphabetical within the serial project), which leave cards in the deck.
 *
 * Tagged @live since ratings and undos hit the real Convex mutations.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

const ADVANCING_RATING_TEST_IDS = [
  'learn-rating-understood',
  'learn-rating-good',
  'learn-rating-easy',
  'learn-rating-still-learning',
  'learn-rating-hard',
  'learn-rating-again',
];

const anyRating = (page: Page) =>
  page
    .locator(
      ADVANCING_RATING_TEST_IDS.map((id) => `[data-testid="${id}"]`).join(', '),
    )
    .first();

async function dismissAllTours(page: Page, waitMs = 250) {
  await dismissTour(page, 'audio_review_intro', waitMs);
  await dismissTour(page, 'full_review_intro', waitMs);
  await dismissTour(page, undefined, waitMs);
}

/** First line of the flashcard's text. Stable identity for "the same card
 * came back". Blur is CSS-only, so the text is present either way. */
async function cardSnippet(page: Page): Promise<string> {
  const flashcard = page.locator('[data-tutorial="card-flashcard"]').first();
  await expect(flashcard).toBeVisible({ timeout: 15_000 });
  const text = (await flashcard.innerText()).trim();
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 2) ?? text
  );
}

/**
 * Rate the current card and make sure the review actually commits.
 *
 * Full review: submitting a translation gates the ratings, and
 * `instantProceedFull` defaults to true, so clicking a rating advances.
 * Audio review: a rating click only SELECTS (`instantProceedAudio` defaults
 * to false), the review commits when the Next button fires, so we click
 * `learn-reveal` (when the target is still blurred, Next hides behind it)
 * and then `learn-next` explicitly.
 */
async function rateOneCard(page: Page): Promise<void> {
  await dismissAllTours(page);

  const translationInput = page.getByTestId('learn-translation-input').first();
  const isFullReview = await translationInput.isVisible().catch(() => false);
  if (isFullReview) {
    await translationInput.fill('skip', { timeout: 5_000 }).catch(() => {});
    await translationInput.press('Enter', { timeout: 5_000 }).catch(() => {});
  }

  await anyRating(page).waitFor({ state: 'visible', timeout: 15_000 });

  let clicked = false;
  for (const testId of ADVANCING_RATING_TEST_IDS) {
    const btn = page.getByTestId(testId).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 5_000 });
      clicked = true;
      break;
    }
  }
  expect(clicked, 'an advancing rating button should be clickable').toBe(true);

  if (!isFullReview) {
    const revealBtn = page.getByTestId('learn-reveal');
    if (await revealBtn.isVisible().catch(() => false)) {
      await revealBtn.click({ timeout: 5_000 }).catch(() => {});
    }
    const nextBtn = page.getByTestId('learn-next');
    await nextBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await nextBtn.click({ timeout: 5_000 });
  }
  // Let the review mutation commit and the next card mount.
  await anyRating(page)
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});
}

test.describe('learning undo (live)', { tag: '@live' }, () => {
  test('undo brings back the last rated card', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/app/learn');
    await page.waitForLoadState('domcontentloaded');
    await dismissAllTours(page, 500);

    await anyRating(page).waitFor({ state: 'visible', timeout: 20_000 });
    await dismissAllTours(page, 1_000);

    const undoBtn = page.getByTestId('learn-undo');
    await expect(
      undoBtn,
      'undo button should render next to the audio-restart button',
    ).toBeVisible({ timeout: 10_000 });

    const snippetBefore = await cardSnippet(page);
    await rateOneCard(page);

    // The reactive undoable count makes the button actionable once the
    // review has committed.
    await expect(undoBtn).toBeEnabled({ timeout: 15_000 });
    await undoBtn.click();

    // The undone card is deterministically the next card served again.
    await expect(
      page.locator('[data-tutorial="card-flashcard"]').first(),
    ).toContainText(snippetBefore.slice(0, 40), { timeout: 15_000 });
    await anyRating(page).waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('undo greys out after exhausting the stack', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/learn');
    await page.waitForLoadState('domcontentloaded');
    await dismissAllTours(page, 500);
    await anyRating(page).waitFor({ state: 'visible', timeout: 20_000 });
    await dismissAllTours(page, 1_000);

    // Rate one more card than the stack holds. The trim keeps only the
    // UNDO_DEPTH newest entries, so exactly UNDO_DEPTH undos are possible
    // regardless of what earlier serial specs left behind.
    for (let i = 0; i < UNDO_DEPTH + 1; i++) {
      await rateOneCard(page);
    }

    const undoBtn = page.getByTestId('learn-undo');
    for (let i = 0; i < UNDO_DEPTH; i++) {
      await expect(
        undoBtn,
        `undo ${i + 1}/${UNDO_DEPTH} should be available`,
      ).toBeEnabled({ timeout: 15_000 });
      await undoBtn.click();
      // Wait for the restored card before the next undo so each pop targets
      // the settled state.
      await anyRating(page).waitFor({ state: 'visible', timeout: 15_000 });
      await dismissAllTours(page);
    }

    await expect(
      undoBtn,
      'undo should grey out once the stack is exhausted',
    ).toBeDisabled({ timeout: 15_000 });

    // Leave shared state sane for downstream specs: re-rate the restored card.
    await rateOneCard(page);
  });
});
