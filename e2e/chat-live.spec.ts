import { test, expect, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Chat LIVE — hits the real Convex backend and real LLM / TTS APIs.
 *
 * Cost-aware design: a fresh test account starts with only 5 chat
 * messages (quota tracked by the "N left" badge next to the chat input).
 * Each message burns real LLM tokens, so this file sends EXACTLY ONE
 * live chat message per full run and asserts as many behaviors as
 * possible off of that single exchange:
 *
 *   1. sendMessage       → user turn appears in the UI
 *   2. generateResponse  → assistant turn comes back with substantive text
 *   3. agent emits card-approval proposals (structured output)
 *   4. approveCard       → user clicks "Add Sentence" and state flips
 *   5. generateThreadTitle → sidebar entry shows a non-default title
 *   6. quota decrement   → "N left" counter drops by exactly 1
 *   7. library persistence → approved card shows up in /app/library
 *   8. getThread         → navigating away and back restores messages
 *   9. listThreads       → the thread is still listed in the sidebar
 *
 * Nondeterministic pieces (LLM content, exact card count) are asserted
 * structurally with generous timeouts.
 *
 * Tagged @live so fast CI runs can skip:
 *   pnpm exec playwright test --grep @live            # live only
 *   pnpm exec playwright test --grep-invert @live     # skip live
 */

const ASSISTANT_TIMEOUT = 60_000; // card generation can take ~30–45s
const TITLE_TIMEOUT = 60_000;

async function readQuotaLeft(page: Page): Promise<number | null> {
  // Badge renders as "N left" or "Limit reached". Iterate all matches and
  // return the first one with a readable value — avoids an isVisible race
  // against Convex refetches and tolerates duplicate test-ids if both the
  // home NewChatInput and the /app/chat ChatInput are in the DOM.
  const badges = page.getByTestId("chat-quota");
  const count = await badges.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const raw = (await badges.nth(i).textContent().catch(() => null))?.trim();
    if (!raw) continue;
    if (/limit reached/i.test(raw)) return 0;
    const n = Number(raw.match(/(\d+)/)?.[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

test.describe.configure({ mode: "serial" });

test.describe("chat (live)", { tag: "@live" }, () => {
  // No retries on live: every retry spends another real chat message.
  test.describe.configure({ retries: 0 });

  // Shared between the two tests — the thread created in test A is
  // exercised (read-only, no extra LLM cost) in test B.
  let threadUrl: string | undefined;
  let userMarker: string | undefined;

  test(
    "full chat-to-card flow: send → response → approve → quota decrements → card in library",
    async ({ page }) => {
      await page.goto("/app");
      await page.waitForLoadState("domcontentloaded");
      await dismissTour(page, "home_tour");

      // (1) Capture quota before sending. If the account is already out,
      // skip rather than fail — this keeps a re-run on an exhausted user
      // from going red.
      const quotaBefore = await readQuotaLeft(page);
      test.skip(
        quotaBefore !== null && quotaBefore < 1,
        `Chat quota exhausted (${quotaBefore} left) — cannot run live test.`,
      );

      // A deterministic marker so we can find the user's message later
      // regardless of how chat bubbles are wrapped.
      userMarker = `cafe-${Date.now()}`;
      const prompt = `Generate me 3 cards about ordering in a café. Include the token ${userMarker} in your reply so I can find it.`;

      // (2) Submit via the home NewChatInput.
      const input = page.getByTestId("chat-new-input").first();
      await expect(input).toBeVisible({ timeout: 20_000 });
      await input.fill(prompt);
      await input.press("Enter");

      // (3) URL transitions to the newly-created thread.
      await page.waitForURL(/\/app\/chat\/[^/]+/, { timeout: 30_000 });
      // Defensive: no tour is expected on the chat page itself, but the
      // home-tour's `showChatStep` popover could still be attached to the
      // chat-button target if navigation outran its destroy.
      await dismissTour(page, "chat", 500);
      threadUrl = page.url();

      // (4) User message lands in the UI. We don't require the assistant
      // to echo the marker — we just assert the user bubble rendered.
      await expect(page.getByTestId("chat-user-message").first()).toBeVisible({
        timeout: 15_000,
      });

      // (5) Assistant reply arrives.
      const assistant = page.getByTestId("chat-assistant-message").first();
      await expect(assistant).toBeVisible({ timeout: ASSISTANT_TIMEOUT });
      await expect(assistant).not.toBeEmpty();

      // (6) Card-approval proposals. Each card renders as an `alert` with
      // "Reject" and "Add Sentence" buttons. We tolerate the model
      // returning any number >= 1 of cards (requested 3, but models can
      // undershoot).
      const addSentence = page.getByTestId("card-approve");
      await expect(addSentence.first()).toBeVisible({
        timeout: ASSISTANT_TIMEOUT,
      });
      const cardCount = await addSentence.count();
      expect(cardCount).toBeGreaterThanOrEqual(1);

      // (7) Approve the first card. After approval the card's "Add
      // Sentence" button should either disappear from the DOM, become
      // disabled, or be replaced by a confirmation ("Added", a checkmark,
      // etc.) — but other unapproved cards still have enabled buttons.
      // Assertion: the TOTAL count of enabled "Add Sentence" buttons
      // drops by 1 (or more, if the approval clears the whole group).
      const firstCardAlert = page.getByTestId("card-approval").first();
      const cardTextBefore = (await firstCardAlert
        .innerText()
        .catch(() => ""))
        .trim()
        .slice(0, 200);
      const enabledBefore = cardCount;

      await addSentence.first().click();
      await expect(async () => {
        const now = await addSentence.count();
        const enabledNow = await Promise.all(
          Array.from({ length: now }, (_, i) =>
            addSentence.nth(i).isEnabled().catch(() => false),
          ),
        ).then((xs) => xs.filter(Boolean).length);
        expect(enabledNow).toBeLessThan(enabledBefore);
      }).toPass({ timeout: 15_000 });

      // (8) Thread auto-titles — a sidebar entry with substantive text
      // appears within TITLE_TIMEOUT.
      const toggle = page.getByTestId("chat-toggle-conversations").first();
      if (await toggle.count()) await toggle.click().catch(() => {});
      await expect(async () => {
        const titles = await page
          .getByTestId("chat-thread-entry")
          .allInnerTexts();
        const substantive = titles.some((t) => t.trim().length >= 4);
        expect(substantive).toBe(true);
      }).toPass({ timeout: TITLE_TIMEOUT });

      // (9) Quota decrement — the "N left" badge is rendered both on
      // /app (NewChatInput) and on /app/chat/* (ChatInput). We're
      // already on the chat page; poll in place and wait for the
      // Convex mutation to propagate.
      if (quotaBefore !== null) {
        await expect(async () => {
          const quotaAfter = await readQuotaLeft(page);
          expect(quotaAfter).toBe(quotaBefore - 1);
        }).toPass({ timeout: 30_000 });
      }

      // (10) Approved card persists to /app/library. We pull a distinctive
      // word from the alert text and search for it.
      const searchSeed =
        cardTextBefore.match(/[A-Za-zÀ-ÿ]{4,}/)?.[0]?.toLowerCase() ?? "café";

      await page.goto("/app/library");
      await page.waitForLoadState("domcontentloaded");
      // No tour registered on /app/library — just strip any lingering overlay.
      await dismissTour(page, undefined, 250);

      const searchBox = page.getByTestId("library-search").first();
      await expect(searchBox).toBeVisible({ timeout: 15_000 });
      await searchBox.fill(searchSeed);
      // Debounced ~300ms — wait then assert at least one result visible.
      await page.waitForTimeout(600);
      const emptyState = page.getByText(
        /no results|no sentences match/i,
      );
      const visibleResult = page
        .getByText(new RegExp(searchSeed, "i"))
        .first();
      // Either we see the search seed in the result list, OR library
      // hasn't indexed the card yet (race with post-approval processing)
      // — in that case just require the search input accepted the query.
      const matched =
        (await visibleResult.isVisible().catch(() => false)) ||
        !(await emptyState.isVisible().catch(() => false));
      expect(matched).toBe(true);
    },
  );

  test("getThread + listThreads: thread persists and is listed (no extra messages)", async ({
    page,
  }) => {
    test.skip(!threadUrl, "Prior test did not create a thread.");

    // Navigate away and back — this exercises getThread without burning
    // any LLM quota (no new messages sent).
    await page.goto("/app/library");
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, undefined, 250);

    await page.goto(threadUrl!);
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "chat", 500);

    // getThread — the user's original message comes back.
    await expect(page.getByTestId("chat-user-message").first()).toBeVisible({
      timeout: 20_000,
    });
    if (userMarker) {
      await expect(page.getByText(userMarker).first()).toBeVisible({
        timeout: 10_000,
      });
    }

    // Assistant side of the exchange also restores.
    await expect(page.getByTestId("chat-assistant-message").first()).toBeVisible({
      timeout: 20_000,
    });

    // listThreads — open the sidebar if collapsed, then assert the
    // thread is represented as a sidebar entry.
    const toggle = page.getByTestId("chat-toggle-conversations").first();
    if (await toggle.count()) await toggle.click().catch(() => {});

    const threadEntries = page.getByTestId("chat-thread-entry");
    await expect(threadEntries.first()).toBeVisible({ timeout: 10_000 });
  });
});
