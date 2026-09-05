import { test, expect, type Page } from '@playwright/test';
import { dismissTour, neutralizeTours } from './helpers';
import {
  deckAccentIntegrity,
  deckCardCount,
  deckDuplicateTextCount,
  fixtureEmail,
} from './convex-hooks';

/**
 * Deck-integrity invariants: the learn view's auto-add effect must
 * CONVERGE, and no add path may ever create two cards for one text.
 *
 * These are quantity/absence assertions, the class every presence-style
 * spec is blind to: a runaway auto-add loop (it has happened — see
 * createCardsFromTexts's due-backdate comment) passes every "a card is
 * visible" assertion while inserting cards nonstop. Here the backend card
 * count itself is the subject, read through the E2E_TEST_HOOKS deck hook.
 *
 * chromium-serial: mounting /app/learn legitimately auto-adds a batch of
 * new cards for the shared fixture user, and workers:1 guarantees no other
 * spec is mutating the deck while the convergence windows run.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

/**
 * Poll the deck size until three consecutive readings (2s apart) agree,
 * then return the converged value. Fails if it never stabilizes inside
 * `budgetMs` — which is exactly what a runaway insert loop looks like.
 */
async function waitForStableCardCount(
  page: Page,
  email: string,
  budgetMs = 60_000,
): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let last = deckCardCount(email);
  let stable = 1;
  while (stable < 3) {
    if (Date.now() > deadline) {
      throw new Error(
        `Deck size never stabilized within ${budgetMs}ms — last=${last}. ` +
          'A card-adding effect appears to be looping.',
      );
    }
    await page.waitForTimeout(2_000);
    const next = deckCardCount(email);
    if (next === last) {
      stable++;
    } else {
      last = next;
      stable = 1;
    }
  }
  return last;
}

/**
 * A card on screen. The learn view asks for the next batch the moment it
 * learns the shown card is the last one due (`queueEndsHere` in
 * useLearningMode.ts), and it only learns that from the card payload, which
 * can land seconds after the header mounts under load. Measuring from the
 * header would count that one legitimate batch as a post-convergence add.
 */
async function waitForCardOnScreen(page: Page): Promise<void> {
  await expect(
    page
      .locator(
        '[data-testid="learn-rating-again"], [data-testid="learn-rating-good"], [data-testid="learn-rating-still-learning"], [data-testid="learn-rating-understood"]',
      )
      .first(),
  ).toBeVisible({ timeout: 45_000 });
}

test.describe('deck integrity', () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeTours(page);
  });

  test('mounting the learn view converges: no runaway card adding', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const email = fixtureEmail();

    await page.goto('/app/learn');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page);
    await expect(page.getByTestId('learn-settings').first()).toBeVisible({
      timeout: 30_000,
    });
    await waitForCardOnScreen(page);

    // The mount may legitimately add one batch of new cards; the invariant
    // is that the effect then STOPS.
    const converged = await waitForStableCardCount(page, email);

    // Quiescence: with the view idle (no reviews happening), a further
    // window must add nothing.
    await page.waitForTimeout(15_000);
    expect(deckCardCount(email)).toBe(converged);

    // And nothing along the way created a duplicate card for any text.
    expect(deckDuplicateTextCount(email)).toBe(0);
  });

  test('two learn tabs at once do not duplicate cards', async ({ page }) => {
    test.setTimeout(180_000);
    const email = fixtureEmail();

    const page2 = await page.context().newPage();
    try {
      // Race both mounts so their auto-add effects overlap.
      await Promise.all([page.goto('/app/learn'), page2.goto('/app/learn')]);
      await dismissTour(page).catch(() => {});
      await dismissTour(page2).catch(() => {});
      await expect(page.getByTestId('learn-settings').first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page2.getByTestId('learn-settings').first()).toBeVisible({
        timeout: 30_000,
      });
      await waitForCardOnScreen(page);
      await waitForCardOnScreen(page2);

      const converged = await waitForStableCardCount(page, email);
      await page.waitForTimeout(10_000);
      expect(deckCardCount(email)).toBe(converged);
      expect(deckDuplicateTextCount(email)).toBe(0);
    } finally {
      await page2.close();
    }
  });

  test('every card stores the accent its text speaks in', async () => {
    // The fixture course has Mixed English (`en`) as its base language, so
    // each curriculum card stores an accent (`cards.accentLanguage`) and
    // reads the matching wording. The card-creation path is the only
    // writer of the field; a card that lacks it or disagrees with its text
    // hash would show one accent and play another.
    const integrity = deckAccentIntegrity(fixtureEmail());
    expect(integrity.total).toBeGreaterThan(0);
    expect(integrity.withAccent).toBeGreaterThan(0);
    expect(integrity.mismatched).toBe(0);
  });
});
