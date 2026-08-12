import { test, expect, type Page } from '@playwright/test';
import { dismissConsent, dismissTour, expectSignedIn } from './helpers';

/**
 * Daily-goal ring + quick-edit on the home screen (chromium-serial: mutates
 * the shared user's course settings; every test restores what it changed).
 *
 * The goal row (`daily-goal-row`, or `daily-goal-set-cta` when unset) opens
 * the DailyGoalQuickEdit popover: preset tiles apply immediately, the custom
 * input applies on Set. Writes go through updateCourseSettings with an
 * optimistic update, so the row re-renders instantly and persists.
 */

async function openHome(page: Page): Promise<void> {
  await page.goto('/app');
  await expectSignedIn(page);
  await dismissConsent(page);
  await dismissTour(page, undefined, 500);
}

/**
 * The optimistic update re-renders the ring the instant a goal is picked, so
 * polling the DOM confirms nothing about the server. A reload (or the
 * test-end context close) that follows within ~100ms closes the Convex sync
 * websocket before the Mutation frame is applied server-side and the write is
 * silently dropped — a race this spec kept losing under full-suite load.
 * Watch the sync frames and hand out the server's MutationResponse acks, so
 * tests can await real persistence before navigating away.
 *
 * Must be called BEFORE the first `page.goto` — `page.on('websocket')` only
 * sees sockets opened after it attaches (it keeps working across reloads,
 * which open a fresh socket).
 */
function trackGoalWriteAcks(page: Page): { nextAck: () => Promise<void> } {
  const UDF_PATH = 'features/courses:updateCourseSettings';
  const acks: boolean[] = [];
  const waiters: Array<(success: boolean) => void> = [];
  const push = (success: boolean) => {
    const waiter = waiters.shift();
    if (waiter) waiter(success);
    else acks.push(success);
  };
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/sync')) return;
    // requestIds restart per socket, so the sent-frame map is per-socket too.
    const requestIds = new Set<number>();
    const parse = (payload: string | Buffer): Record<string, unknown> | null => {
      try {
        return JSON.parse(String(payload));
      } catch {
        return null;
      }
    };
    ws.on('framesent', (frame) => {
      const msg = parse(frame.payload);
      if (msg?.type === 'Mutation' && msg.udfPath === UDF_PATH) {
        requestIds.add(msg.requestId as number);
      }
    });
    ws.on('framereceived', (frame) => {
      const msg = parse(frame.payload);
      if (
        msg?.type === 'MutationResponse' &&
        requestIds.has(msg.requestId as number)
      ) {
        push(Boolean(msg.success));
      }
    });
  });
  return {
    /** Await the next (or an already-arrived) server ack for a goal write. */
    nextAck: async () => {
      const success =
        acks.shift() ??
        (await new Promise<boolean>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(`no server ack for ${UDF_PATH} within 15s`),
              ),
            15_000,
          );
          waiters.push((ok) => {
            clearTimeout(timer);
            resolve(ok);
          });
        }));
      expect(success, 'updateCourseSettings applied server-side').toBe(true);
    },
  };
}

/** The goal row's "N / M min" label → M (the goal), or null on the set-CTA. */
async function readGoalMinutes(page: Page): Promise<number | null> {
  const row = page.getByTestId('daily-goal-row');
  if (!(await row.isVisible().catch(() => false))) return null;
  const text = await row.innerText();
  const match = text.match(/\/\s*(\d+)\s*min/i);
  return match ? Number(match[1]) : null;
}

async function openQuickEdit(page: Page): Promise<void> {
  const trigger = page
    .getByTestId('daily-goal-row')
    .or(page.getByTestId('daily-goal-set-cta'))
    .first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  await expect(page.getByTestId('daily-goal-popover')).toBeVisible({
    timeout: 8_000,
  });
}

test.describe('daily goal quick-edit', () => {
  test('preset applies instantly, persists across reload, and restores', async ({
    page,
  }) => {
    const goalWrites = trackGoalWriteAcks(page);
    await openHome(page);
    const original = await readGoalMinutes(page);

    // Pick a preset that differs from the current goal.
    const target = original === 30 ? 10 : 30;
    await openQuickEdit(page);
    await page.getByTestId(`daily-goal-preset-${target}`).click();
    await expect
      .poll(() => readGoalMinutes(page), { timeout: 8_000 })
      .toBe(target);

    // Server persistence, not just the optimistic cache. Reloading straight
    // off the optimistic poll would race the in-flight write — wait for the
    // server ack first, so the reload asserts persistence instead of racing it.
    await goalWrites.nextAck();
    await page.reload();
    await dismissTour(page, undefined, 500);
    await expect
      .poll(() => readGoalMinutes(page), { timeout: 15_000 })
      .toBe(target);

    // Leave the shared user as found (original may be a non-preset custom
    // value — restore via the custom input to cover any value).
    if (original != null && original !== target) {
      await openQuickEdit(page);
      const custom = page.getByTestId('daily-goal-custom-input');
      await custom.fill(String(original));
      await page
        .getByTestId('daily-goal-popover')
        .getByRole('button', { name: /set/i })
        .click();
      await expect
        .poll(() => readGoalMinutes(page), { timeout: 8_000 })
        .toBe(original);
      // The context close at test end drops an unacked restore write, leaving
      // the shared user's goal changed for every later test.
      await goalWrites.nextAck();
    }
  });

  test('custom value applies via the Set button and restores', async ({
    page,
  }) => {
    const goalWrites = trackGoalWriteAcks(page);
    await openHome(page);
    const original = await readGoalMinutes(page);
    test.skip(
      original == null,
      'course has no goal set — covered by the CTA state',
    );

    await openQuickEdit(page);
    const custom = page.getByTestId('daily-goal-custom-input');
    await custom.fill('45');
    await page
      .getByTestId('daily-goal-popover')
      .getByRole('button', { name: /set/i })
      .click();
    await expect.poll(() => readGoalMinutes(page), { timeout: 8_000 }).toBe(45);
    await goalWrites.nextAck();

    // Restore.
    await openQuickEdit(page);
    await custom.fill(String(original));
    await page
      .getByTestId('daily-goal-popover')
      .getByRole('button', { name: /set/i })
      .click();
    await expect
      .poll(() => readGoalMinutes(page), { timeout: 8_000 })
      .toBe(original);
    // Without this, the context close at test end raced the restore write and
    // could leave the shared user's goal stuck at 45 (observed in real runs).
    await goalWrites.nextAck();
  });
});
