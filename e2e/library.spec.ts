import { test, expect } from '@playwright/test';
import { dismissTour, expectSignedIn } from './helpers';

/**
 * Library smoke. Verifies the LibraryView renders inside the app shell
 * and that there is at least one interactive control (search, filter,
 * collection toggle, …).
 */
test.describe('library', () => {
  test('library view renders with at least one interactive control', async ({
    page,
  }) => {
    // /app/library shares the authed layout's server preloads; under
    // parallel-suite load those can leave the Next loading splash up past
    // the default 30s. Reload once if the shell never arrives.
    test.setTimeout(60_000);

    await page.goto('/app/library');
    await page.waitForLoadState('domcontentloaded');
    await expectSignedIn(page);
    await dismissTour(page);

    // Header label ("library" / "bibliothek") rendered by MainLayout.
    const heading = page.getByRole('heading').first();
    try {
      await expect(heading).toBeVisible({ timeout: 15_000 });
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await expectSignedIn(page);
      await dismissTour(page);
      await expect(heading).toBeVisible({ timeout: 20_000 });
    }

    // The library view renders a search textbox plus filter toggles
    // (Mastered / Hidden / Favorites).
    const search = page.getByTestId('library-search').first();
    await expect(search).toBeVisible({ timeout: 15_000 });
  });
});
