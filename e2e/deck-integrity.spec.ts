import { test, expect, type Page } from '@playwright/test';
import { dismissTour, neutralizeTours } from './helpers';
import {
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

      const converged = await waitForStableCardCount(page, email);
      await page.waitForTimeout(10_000);
      expect(deckCardCount(email)).toBe(converged);
      expect(deckDuplicateTextCount(email)).toBe(0);
    } finally {
      await page2.close();
    }
  });
});
