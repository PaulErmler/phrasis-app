import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  dismissDifficultyCheck,
  dismissErrorBoundary,
  dismissTour,
  gotoAuthedApp,
  isSelectedTestId,
  neutralizeTours,
  waitForInViewport,
} from './helpers';
import { extractJsonResult } from './cli-json-output';

/**
 * Accepted-alternatives lifecycle (live): the per-user alternative
 * translations that writing-mode grading treats as additional correct
 * answers.
 *
 * Production creates an alternative only through an LLM verdict (the
 * grader's `alsoCorrect` or the chat `markAlsoCorrect` tool), which no spec
 * can trigger deterministically, so the row is seeded through the
 * E2E_TEST_HOOKS-gated hook (features/writingAlternativesTesting.ts), which
 * calls the SAME `storeWritingAlternative` the grader uses. Everything
 * around it is driven through the browser:
 *
 *   1. a custom card is created through the add-cards UI,
 *   2. review: an answer matching the alternative grades correct through
 *      the FREE local gate (no AI-feedback pending/card ever renders) and
 *      the "other accepted answers" list surfaces the primary,
 *   3. the edit dialog lists/rewords the alternative and stages deletes
 *      (trash → line-through, undo restores, only Save commits),
 *   4. deleting on Save removes the row,
 *   5. editing the PRIMARY to equal an alternative auto-deletes the
 *      now-duplicate row (scheduling.editCard's dedupe).
 *
 * chromium-serial: mutates the shared fixture user (adds a card, flips
 * review mode, edits the card). Tagged @live because the seed schedules a
 * real TTS synthesis for the alternative and the card edit runs the real
 * edit pipeline. Serial + retries 0: the tests share one card and a retry
 * would re-seed on top of mutated state.
 */

const REPO_ROOT = path.resolve(__dirname, '..');

function convexRun(fn: string, args: Record<string, unknown>): unknown {
  const out = execFileSync(
    'pnpm',
    ['exec', 'convex', 'run', fn, JSON.stringify(args)],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return extractJsonResult(out);
}

function fixtureEmail(): string {
  const creds = JSON.parse(
    fs.readFileSync(
      path.resolve(REPO_ROOT, 'e2e/.auth/credentials-a.json'),
      'utf8',
    ),
  ) as { email: string };
  return creds.email;
}

type SeedResult = {
  cardId: string;
  alternativeId: string | null;
  primary: string;
};

type AlternativeRow = { _id: string; language: string; text: string };

function listAlternatives(email: string, cardId: string): AlternativeRow[] {
  return convexRun('features/writingAlternativesTesting:listAlternatives', {
    email,
    cardId,
  }) as AlternativeRow[];
}

// One sentence family per run; the tag keeps repeat runs from colliding
// with leftovers of earlier ones (fixture users are usually fresh, but
// E2E_SKIP_USER_CLEANUP iteration reuses them).
const runTag = Date.now().toString(36);
const MARKER = `e2eAlt${runTag}`;
const SOURCE_TEXT = `${MARKER} the tailor mends the old coat.`;
const PRIMARY_ES = `El sastre arregla el abrigo viejo ${runTag}.`;
const ALT_SEEDED = `El sastre repara el abrigo viejo ${runTag}.`;
const ALT_REWORDED = `El sastre cose el abrigo viejo ${runTag}.`;
const ALT_SECOND = `El sastre remienda el abrigo viejo ${runTag}.`;

let cardId = '';

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

/**
 * Writing style is independent of review mode. Earlier chromium-serial
 * specs (course-settings-sweep, learning-settings) flip Transcribe and
 * try to restore Translate; if that restore races a mode write, this
 * user can still be on Transcribe, where stored alternatives grant no
 * credit and the local gate never fires.
 */
async function setWritingStyle(
  page: Page,
  style: 'translate' | 'transcribe',
): Promise<void> {
  await openSettingsSheet(page);
  const fullBtn = page.getByTestId('settings-mode-full').first();
  await expect(fullBtn).toBeVisible({ timeout: 8_000 });
  if (!(await isSelectedTestId(page, 'settings-mode-full'))) {
    await fullBtn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, 'settings-mode-full'), {
        timeout: 8_000,
      })
      .toBe(true);
  }
  const btn = page.getByTestId(`settings-writing-${style}`).first();
  await expect(btn).toBeVisible({ timeout: 8_000 });
  if (!(await isSelectedTestId(page, `settings-writing-${style}`))) {
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await waitForInViewport(page, btn);
    await btn.click({ force: true });
    await expect
      .poll(() => isSelectedTestId(page, `settings-writing-${style}`), {
        timeout: 8_000,
      })
      .toBe(true);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * Open the seeded card's edit dialog from the library (search by marker,
 * pinned Edit action — edit is in DEFAULT_PINNED_CARD_ACTIONS, so it is a
 * direct surface button on every card). Returns the card's root locator.
 */
async function openEditDialogFromLibrary(page: Page) {
  await page.goto('/app/library');
  await page.waitForLoadState('domcontentloaded');
  await dismissTour(page);
  const search = page.getByTestId('library-search').first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(MARKER);
  const card = page.getByTestId('library-card').filter({ hasText: MARKER });
  await expect
    .poll(async () => card.count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
  await card.first().getByTestId('card-action-edit').first().click();
  await expect(page.getByTestId('edit-card-save')).toBeVisible({
    timeout: 10_000,
  });
  return card.first();
}

/** Re-open the edit dialog on the (still marker-filtered) library list. */
async function reopenEditDialog(page: Page) {
  const card = page.getByTestId('library-card').filter({ hasText: MARKER });
  await card.first().getByTestId('card-action-edit').first().click();
  await expect(page.getByTestId('edit-card-save')).toBeVisible({
    timeout: 10_000,
  });
}

test.describe.configure({ mode: 'serial', retries: 0 });
test.describe('writing alternatives lifecycle (live)', { tag: '@live' }, () => {
  test.beforeEach(async ({ page }) => {
    await neutralizeTours(page);
  });

  test('a custom card is created and gains a seeded alternative', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // --- Create the custom text (add-cards manual entry) ----------------
    const english = page.locator('#enter-en');
    await gotoAuthedApp(page, '/app/content/add-cards', english);
    await dismissTour(page);
    const spanish = page.locator('#enter-es');
    await english.fill(SOURCE_TEXT);
    await spanish.fill(PRIMARY_ES);
    const save = page.getByRole('button', { name: /^save$/i }).first();
    await expect(save).toBeEnabled({ timeout: 10_000 });
    await save.click();
    await dismissErrorBoundary(page);
    await expect(english).toHaveValue('', { timeout: 30_000 });

    // --- Add it to the deck (cards only materialize on a deck-add) ------
    await page.goto('/app');
    await page.waitForLoadState('domcontentloaded');
    await dismissTour(page, 'home_tour');
    await page.getByRole('tab', { name: /custom content/i }).click();
    await page.getByRole('button', { name: /^manually added$/i }).click();
    const customTile = page.getByTestId('collection-tile-Custom');
    await expect(customTile).toBeVisible({ timeout: 15_000 });
    await customTile.getByRole('button', { name: /preview/i }).click();
    const markerRow = page
      .locator('[data-testid^="collection-text-"]')
      .filter({ hasText: MARKER })
      .first();
    await expect(markerRow).toBeVisible({ timeout: 20_000 });
    await markerRow.getByTestId('collection-text-add').click();
    await expect(
      page
        .locator('[data-testid="collection-text-added"]')
        .filter({ hasText: MARKER })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    // The flip is optimistic; give the mutation ack a beat before any
    // navigation can tear down the Convex client (see add-cards-live).
    await page.waitForTimeout(1_500);
    await page.keyboard.press('Escape');

    // --- Seed the alternative through the grader's own store path -------
    const seeded = convexRun(
      'features/writingAlternativesTesting:seedAlternative',
      {
        email: fixtureEmail(),
        sourceMarker: MARKER,
        language: 'es',
        text: ALT_SEEDED,
      },
    ) as SeedResult;
    expect(seeded.alternativeId).toBeTruthy();
    expect(seeded.primary).toBe(PRIMARY_ES);
    cardId = seeded.cardId;
  });

  test('an answer matching the alternative grades correct through the free local gate', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!cardId, 'seed test did not run');

    await gotoAuthedApp(
      page,
      '/app/learn',
      page.getByTestId('learn-settings').first(),
    );
    await dismissTour(page, 'audio_review_intro', 500);
    await dismissTour(page, 'full_review_intro', 500);
    await setReviewMode(page, 'full');
    await setWritingStyle(page, 'translate');
    await dismissTour(page, 'full_review_intro', 500);

    // The seed parked the card at dueDate 0, so it is the head of the queue.
    await expect(page.getByText(MARKER).first()).toBeVisible({
      timeout: 20_000,
    });

    const input = page.getByTestId('learn-translation-input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill(ALT_SEEDED);
    await page.getByTestId('learn-submit-translation').first().click();

    // The alternative is an exact match, so grading resolves in the FREE
    // local gate: the answer is accepted and the "other accepted answers"
    // list surfaces the primary the diff is not currently showing…
    const otherAccepted = page
      .getByTestId('writing-feedback-other-accepted')
      .first();
    await expect(otherAccepted).toBeVisible({ timeout: 15_000 });
    await expect(otherAccepted).toContainText(PRIMARY_ES);
    // …with its own audio row (the URL may still be generating; the row
    // itself must be there).
    await expect(
      otherAccepted.getByTestId('accepted-audio').first(),
    ).toBeVisible();

    // No AI feedback was requested: neither the pending skeleton nor a
    // coach card may appear for a locally-matched answer.
    await expect(page.getByTestId('writing-feedback-pending')).toHaveCount(0);
    await expect(page.getByTestId('writing-feedback-card')).toHaveCount(0);

    // Leave the shared user the way the other serial specs expect it.
    await setReviewMode(page, 'audio');
  });

  test('the edit dialog rewords the alternative and stages deletes safely', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!cardId, 'seed test did not run');

    await openEditDialogFromLibrary(page);
    const altInput = page.getByTestId('edit-alternative-input-es-0');
    await expect(altInput).toBeVisible({ timeout: 15_000 });
    await expect(altInput).toHaveValue(ALT_SEEDED);

    // Staged delete: trash disables the row, undo restores it, and neither
    // touches the backend until Save.
    const stageDelete = page.getByTestId('edit-alternative-delete-es-0');
    await stageDelete.click();
    await expect(altInput).toBeDisabled();
    await stageDelete.click(); // undo
    await expect(altInput).toBeEnabled();

    // Reword and save.
    await altInput.fill(ALT_REWORDED);
    await page.getByTestId('edit-card-save').click();
    await expect(page.getByTestId('edit-card-save')).toBeHidden({
      timeout: 20_000,
    });
    await expect
      .poll(() => listAlternatives(fixtureEmail(), cardId).map((r) => r.text), {
        timeout: 15_000,
      })
      .toEqual([ALT_REWORDED]);

    // The staged-but-undone delete must NOT have deleted anything, and the
    // reworded text is what the dialog now serves.
    await reopenEditDialog(page);
    await expect(page.getByTestId('edit-alternative-input-es-0')).toHaveValue(
      ALT_REWORDED,
      { timeout: 15_000 },
    );
    await page.getByTestId('edit-card-cancel').click();
  });

  test('deleting the alternative on Save removes it from the card', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!cardId, 'seed test did not run');

    await openEditDialogFromLibrary(page);
    const altInput = page.getByTestId('edit-alternative-input-es-0');
    await expect(altInput).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('edit-alternative-delete-es-0').click();
    await expect(altInput).toBeDisabled();
    await page.getByTestId('edit-card-save').click();
    await expect(page.getByTestId('edit-card-save')).toBeHidden({
      timeout: 20_000,
    });

    await expect
      .poll(() => listAlternatives(fixtureEmail(), cardId).length, {
        timeout: 15_000,
      })
      .toBe(0);

    // The dialog no longer renders an alternatives section for the card.
    await reopenEditDialog(page);
    await expect(page.locator('#edit-es')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('edit-alternatives-es')).toHaveCount(0);
    await page.getByTestId('edit-card-cancel').click();
  });

  test('editing the primary to equal an alternative deletes the duplicate row', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!cardId, 'seed test did not run');

    // Fresh alternative to collide with.
    const seeded = convexRun(
      'features/writingAlternativesTesting:seedAlternative',
      {
        email: fixtureEmail(),
        sourceMarker: MARKER,
        language: 'es',
        text: ALT_SECOND,
      },
    ) as SeedResult;
    expect(seeded.alternativeId).toBeTruthy();

    await openEditDialogFromLibrary(page);
    await expect(page.getByTestId('edit-alternative-input-es-0')).toHaveValue(
      ALT_SECOND,
      { timeout: 15_000 },
    );
    // Make the PRIMARY the alternative's exact wording. editCard's dedupe
    // then deletes the alternative row so the card can't list its own
    // sentence twice.
    await page.locator('#edit-es').fill(ALT_SECOND);
    await page.getByTestId('edit-card-save').click();
    await expect(page.getByTestId('edit-card-save')).toBeHidden({
      timeout: 30_000,
    });

    await expect
      .poll(() => listAlternatives(fixtureEmail(), cardId).length, {
        timeout: 20_000,
      })
      .toBe(0);

    // And the dialog reflects both: new primary, no alternatives section.
    await reopenEditDialog(page);
    await expect(page.locator('#edit-es')).toHaveValue(ALT_SECOND, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('edit-alternatives-es')).toHaveCount(0);
    await page.getByTestId('edit-card-cancel').click();
  });
});
