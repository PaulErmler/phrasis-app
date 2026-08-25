import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dismissTour, expectSignedIn } from './helpers';

/**
 * Editing a curriculum card is also a complaint about the curriculum.
 *
 * The learner gets a private fork (long-standing behaviour) AND the shared
 * translation row every other learner studies gets flagged, with the learner's
 * wording handed to a retranslation as a suggestion. This spec drives that
 * from the real edit dialog and checks the shared row, which is the one part
 * convex-test cannot prove: that the dialog is actually wired to the mutation
 * that does it.
 *
 * Cost control: `armProbe` parks the row's flagCount at the cap first, so the
 * edit increments the counter but short-circuits before enqueueing a real
 * (paid) retranslation that would overwrite dev curriculum content.
 * `restoreProbe` puts the counter back, so repeat runs don't accumulate. The
 * enqueue, the suggestion payload, the injection sanitising, and every
 * exclusion are covered in convex/tests/features/scheduling.test.ts and
 * convex/tests/features/translationLLM.test.ts.
 *
 * Mutates the shared fixture user's cards (Path B replaces the card
 * document), so this belongs in the serial project. Requires
 * E2E_TEST_HOOKS=1, which global-setup sets for the run.
 */

const REPO_ROOT = path.resolve(__dirname, '..');

/** Run a Convex function on the dev deployment and parse its JSON result. */
function convexRun(fn: string, args: Record<string, unknown>): unknown {
  const out = execFileSync(
    'pnpm',
    ['exec', 'convex', 'run', fn, JSON.stringify(args)],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  const lines = out.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    try {
      return JSON.parse(lines.slice(i).join('\n'));
    } catch {
      /* keep scanning upwards */
    }
  }
  return undefined;
}

type Probe = {
  cardId: string;
  textId: string;
  sourceLanguage: string;
  sourceText: string;
  targetLanguage: string;
  targetText: string;
  originalFlagCount: number | null;
};

function fixtureEmail(): string {
  const creds = JSON.parse(
    fs.readFileSync(
      path.resolve(REPO_ROOT, 'e2e/.auth/credentials-a.json'),
      'utf8',
    ),
  ) as { email: string };
  return creds.email;
}

/** Open the edit dialog for one specific library card. */
async function openEditDialog(page: Page, card: Locator): Promise<void> {
  await expect(card).toBeVisible({ timeout: 20_000 });

  // "Edit" is a surface button when the user has pinned it, otherwise it
  // lives in the overflow menu. Handle both.
  const pinnedEdit = card.getByRole('button', { name: 'Edit', exact: true });
  if ((await pinnedEdit.count()) > 0) {
    await pinnedEdit.first().click();
  } else {
    await card.getByRole('button', { name: 'More', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  }
  await expect(
    page.getByRole('heading', { name: 'Edit Sentence' }),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('curriculum edit flags the shared translation', () => {
  let probe: Probe | null = null;

  test.afterEach(() => {
    if (!probe) return;
    convexRun('features/curriculumFlagTesting:restoreProbe', {
      textId: probe.textId,
      targetLanguage: probe.targetLanguage,
      originalFlagCount: probe.originalFlagCount,
    });
    probe = null;
  });

  test('editing a curriculum translation forks the card and flags the original row', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = fixtureEmail();

    probe = convexRun('features/curriculumFlagTesting:armProbe', {
      email,
    }) as Probe | null;
    test.skip(
      probe === null,
      'fixture user has no shared curriculum card with a flaggable translation',
    );
    const p = probe!;

    // The user's card points at the shared curriculum text to begin with.
    expect(
      convexRun('features/curriculumFlagTesting:userCardCountForText', {
        email,
        textId: p.textId,
      }),
    ).toBeGreaterThan(0);

    await page.goto('/app/library');
    await page.waitForLoadState('domcontentloaded');
    await expectSignedIn(page);
    await dismissTour(page);

    // Narrow the list to the probe card by its target-language wording.
    const search = page.getByTestId('library-search').first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(p.targetText);

    // Address the ARMED card by id, never `.first()` of the list. The search
    // is debounced, so the pre-filter list still satisfies "a card is
    // visible" and the first row is then some unrelated card: the edit lands
    // on it, the shared row it flags is not the one armProbe parked, and the
    // poll below waits out its timeout against an untouched counter.
    const card = page.locator(
      `[data-testid="library-card"][data-card-id="${p.cardId}"]`,
    );
    await expect(card).toBeVisible({ timeout: 20_000 });

    await openEditDialog(page, card);

    // Edit ONLY the target-language line. The curriculum's own source line
    // stays untouched: changing it would (deliberately) suppress flagging,
    // since the user's target text would then translate their sentence
    // rather than the curriculum's.
    const edited = `${p.targetText.slice(0, 120)} (e2e)`;
    const input = page.locator(`#edit-${p.targetLanguage}`);
    await expect(input).toBeVisible();
    await input.fill(edited);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Edit Sentence' }),
    ).toBeHidden({ timeout: 20_000 });

    // The shared row is flagged. armProbe parked it at the cap (2), so the
    // edit takes it to 3 and enqueues nothing.
    await expect
      .poll(
        () =>
          (
            convexRun('features/curriculumFlagTesting:readTranslation', {
              textId: p.textId,
              targetLanguage: p.targetLanguage,
            }) as { flagCount: number | null } | null
          )?.flagCount ?? null,
        { timeout: 30_000, message: 'shared translation was never flagged' },
      )
      .toBe(3);

    // The shared wording itself is untouched: the user's edit lands on their
    // fork, not on the sentence every other learner studies.
    const shared = convexRun(
      'features/curriculumFlagTesting:readTranslation',
      { textId: p.textId, targetLanguage: p.targetLanguage },
    ) as { translatedText: string };
    expect(shared.translatedText).toBe(p.targetText);

    // The user's card moved to a private fork.
    await expect
      .poll(
        () =>
          convexRun('features/curriculumFlagTesting:userCardCountForText', {
            email,
            textId: p.textId,
          }),
        { timeout: 30_000, message: "user's card never forked off the shared text" },
      )
      .toBe(0);

    // And the fork carries their wording.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectSignedIn(page);
    await search.fill(edited);
    await expect(page.getByText(edited, { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
