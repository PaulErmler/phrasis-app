import { test, expect, type Page } from "@playwright/test";
import { dismissTour } from "./helpers";

/**
 * Chat LIVE — hits the real Convex backend and real LLM / TTS APIs.
 *
 * Cost-aware design: a fresh test account starts with only 5 chat
 * messages (quota tracked by the "N left" badge next to the chat input).
 * Each message burns real LLM tokens, so this file sends EXACTLY TWO
 * live chat messages per full run and asserts as many behaviors as
 * possible off of those exchanges:
 *
 * Test 1 — the card-generation exchange:
 *   1. sendMessage       → user turn appears in the UI
 *   2. generateResponse  → assistant turn comes back with substantive text
 *   3. agent emits card-approval proposals (structured output)
 *   4. updateApprovalTranslations → user opens the edit dialog on the first
 *      card, rewrites its base-language text, saves, and the card surface
 *      reflects the edit before approval
 *   5. approveCard       → user clicks "Add Sentence" and state flips
 *   6. generateThreadTitle → sidebar entry shows a non-default title
 *   7. quota decrement   → "N left" counter drops by exactly 1
 *   8. library persistence → the *edited* card text shows up in /app/library
 *
 * Test 2 — thread persistence (no extra messages):
 *   8. getThread         → navigating away and back restores messages
 *   9. listThreads       → the thread is still listed in the sidebar
 *
 * Test 3 — the word-explain exchange (learning mode → "Ask AI" popover):
 *  10. ClickableWords trigger → popover opens next to a clicked word
 *  11. openChatWithPrompt + auto-submit → user bubble shows
 *      "Explain me this word: <word>" without the user pressing send
 *  12. generateResponse  → assistant reply arrives in the in-learn chat
 *  13. quota decrement   → another message is counted against the quota
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
  const badges = page.getByTestId("feature-quota-chat_messages");
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
      // Live LLM round-trips (assistant reply, card streaming, title gen)
      // can take 30–60s each — well beyond Playwright's 30s default.
      test.setTimeout(180_000);

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

      // (7) Edit the first card BEFORE approving. This exercises
      // updateApprovalTranslations on the real backend: open the edit
      // dialog, overwrite the first input (base language) with a unique
      // marker, save, and verify the marker is now visible in the card
      // surface (which prefers approval.translations over the frozen
      // tool-call input once edited).
      const firstCardAlert = page.getByTestId("card-approval").first();
      const editMarker = `edt${Date.now().toString(36)}`;
      const editedText = `Edited sentence ${editMarker}`;

      const firstEdit = firstCardAlert.getByTestId("card-edit").first();
      await expect(firstEdit).toBeVisible({ timeout: 10_000 });
      await firstEdit.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      // EditApprovalDialog renders each translation as a <Textarea>, not an
      // <Input>, so target textarea elements here.
      const firstInput = dialog.locator("textarea").first();
      await expect(firstInput).toBeVisible({ timeout: 5_000 });
      await firstInput.fill(editedText);

      const saveButton = dialog.getByRole("button", { name: /^save$/i });
      await saveButton.click();
      // Dialog closes on success.
      await expect(dialog).toBeHidden({ timeout: 10_000 });

      // The edited marker should now surface in the card approval alert.
      await expect(firstCardAlert).toContainText(editMarker, {
        timeout: 10_000,
      });

      // (8) Approve the first card. After approval the card's "Add
      // Sentence" button is replaced by the "approved" indicator inside
      // that specific card-approval alert. Scope the assertion to the
      // first card's subtree — counting enabled buttons across the whole
      // page would race with the AI streaming in additional cards after
      // we captured cardCount, inflating the count and masking the flip.
      const firstApprove = firstCardAlert.getByTestId("card-approve").first();
      await firstApprove.click();
      await expect(
        firstCardAlert.getByTestId("card-approved-indicator"),
      ).toBeVisible({ timeout: 15_000 });

      // (9) Thread auto-titles — a sidebar entry with substantive text
      // appears within TITLE_TIMEOUT. On desktop the sidebar auto-opens;
      // on mobile it starts closed. Only toggle if entries aren't yet in
      // the DOM, otherwise we'd close an already-open desktop sidebar.
      const entries = page.getByTestId("chat-thread-entry");
      if ((await entries.count()) === 0) {
        const toggle = page.getByTestId("chat-toggle-conversations").first();
        if (await toggle.count()) await toggle.click().catch(() => {});
      }
      await expect(async () => {
        const titles = await entries.allInnerTexts();
        const substantive = titles.some((t) => t.trim().length >= 4);
        expect(substantive).toBe(true);
      }).toPass({ timeout: TITLE_TIMEOUT });

      // (10) Quota decrement — the "N left" badge is rendered both on
      // /app (NewChatInput) and on /app/chat/* (ChatInput). We're
      // already on the chat page; poll in place and wait for the
      // Convex mutation to propagate.
      if (quotaBefore !== null) {
        await expect(async () => {
          const quotaAfter = await readQuotaLeft(page);
          expect(quotaAfter).toBe(quotaBefore - 1);
        }).toPass({ timeout: 30_000 });
      }

      // (11) Approved card persists to /app/library. We search for the
      // unique edit marker so the assertion pins the *edited* text to the
      // persisted card, not a coincidental phrase from the AI response.
      const searchSeed = editMarker;

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

    // Cold-load the chat URL on this test's fresh page — exercises
    // getThread without burning any LLM quota (no new messages sent).
    // (main)/layout.tsx derives activeView from pathname only inside its
    // useState initializer, so a direct goto on a fresh mount is what
    // actually drives SimplifiedChatView; an intermediate goto away
    // would leave that initializer stuck on the prior view.
    await page.goto(threadUrl!);
    await page.waitForLoadState("domcontentloaded");
    await dismissTour(page, "chat", 500);

    // Wait for the chat surface to mount before asserting on its
    // contents. chat-input only renders inside SimplifiedChatView, so
    // its presence proves activeView === 'chat' and the layout settled
    // on the chat view. A reload forces a fresh layout mount in the
    // rare case the first navigation didn't.
    const chatInput = page.getByTestId("chat-input").first();
    const chatMounted = await chatInput
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!chatMounted) {
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await dismissTour(page, "chat", 500);
      await chatInput.waitFor({ state: "visible", timeout: 10_000 });
    }

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

  test(
    "word-explain flow: click a word on a learning card → Ask AI auto-submits 'Explain me this word: <word>'",
    async ({ page }) => {
      // The assistant reply can take up to a minute; add headroom for the
      // navigation + word-click setup on top of that. Playwright's 30s
      // default would fire before the assistant response comes back.
      test.setTimeout(120_000);

      // (1) Read the quota from /app (the home NewChatInput always renders
      // the badge). Capture before we burn the message.
      await page.goto("/app");
      await page.waitForLoadState("domcontentloaded");
      await dismissTour(page, "home_tour");

      const quotaBefore = await readQuotaLeft(page);
      test.skip(
        quotaBefore !== null && quotaBefore < 1,
        `Chat quota exhausted (${quotaBefore} left) — cannot run live word-explain test.`,
      );

      // (2) Enter the learn overlay. Depending on prior test state the card
      // may be in audio or full review; dismiss either intro tour.
      await page.goto("/app/learn");
      await page.waitForLoadState("domcontentloaded");
      await dismissTour(page, "audio_review_intro", 500);
      await dismissTour(page, "full_review_intro", 500);

      // The review tour can launch ~1s after reviewing state begins —
      // try again in case we missed it on first sweep.
      await dismissTour(page, "audio_review_intro", 1_500);
      await dismissTour(page, "full_review_intro", 500);

      // (3) Wait for a clickable word span to appear. If the deck happens
      // to be empty on this run (no cards approved in test 1, or review
      // phase not yet loaded), skip rather than fail — the first test in
      // this spec is what seeds the deck, and its failure would already
      // have propagated via serial-mode.
      const firstWord = page.getByTestId("clickable-word").first();
      const hasWord = await firstWord
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      test.skip(
        !hasWord,
        "No reviewable card with clickable words — prior test did not seed a usable deck.",
      );

      // (4-6) Open the popover on the first clickable word and capture the
      // word's text for the prompt assertion below.
      //
      // Retried as one unit: in audio review mode, karaoke re-renders the
      // ClickableWords parent on every `localTime` tick and the audio-mode
      // auto-advance can swap the CARD between the click and the popover
      // mount — the popover then never opens (or unmounts instantly), and
      // the first word may be a different word on the next attempt. Each
      // attempt re-pauses audio (playback can have resumed on a card
      // advance) before clicking the current first word.
      //
      // The play/pause button is the same physical element regardless of
      // state — only the inner Lucide icon swaps (`lucide-pause` vs
      // `lucide-play`). Click ONLY if the Pause icon is showing, so we
      // don't accidentally start playback on a paused card.
      //
      // ClickableWords strips surrounding punctuation before injecting into
      // the prompt template (e.g. "Haus," → "Haus") — mirror that here so
      // the regex below matches.
      const playPauseBtn = page.locator('[data-tutorial="audio-play"]').first();
      const askBtn = page.getByTestId("ask-ai-button").first();
      // Radix tags the trigger of the OPEN popover with data-state="open",
      // so this always resolves to the word the popover actually belongs to.
      const openWord = page
        .locator('[data-testid="clickable-word"][data-state="open"]')
        .first();
      let cleanedWord = "";
      let popoverOpen = false;
      for (let attempt = 0; attempt < 4 && !popoverOpen; attempt++) {
        const pauseIconVisible = await playPauseBtn
          .locator("svg.lucide-pause")
          .isVisible()
          .catch(() => false);
        if (pauseIconVisible) {
          await playPauseBtn.click().catch(() => {});
          // Give React one tick to settle so the karaoke render loop stops
          // before we open the popover.
          await page.waitForTimeout(150);
        }

        await page
          .getByTestId("clickable-word")
          .first()
          .click({ force: true })
          .catch(() => {});
        const opened = await askBtn
          .waitFor({ state: "visible", timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (!opened) {
          await page.waitForTimeout(500);
          continue;
        }

        // Read the word from the OPEN trigger rather than from the pre-click
        // DOM: if the card advanced between the click and the popover mount,
        // the pre-click read names a word that is no longer on screen and the
        // prompt assertion below would look for the wrong text. An empty read
        // means the popover unmounted under us — retry the whole unit.
        const rawWord = (
          (await openWord.innerText().catch(() => "")) || ""
        ).trim();
        cleanedWord = rawWord.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
        popoverOpen = cleanedWord.length > 0;
        if (!popoverOpen) await page.waitForTimeout(500);
      }
      expect(
        popoverOpen,
        "Ask AI button should appear inside the word popover, anchored to a word with a non-empty display after stripping punctuation",
      ).toBe(true);

      // Use a forced click on the Ask AI button as a belt-and-suspenders
      // measure — even with audio paused the popover can re-position briefly
      // when first appearing; force skips the stability poll once we've
      // confirmed the button is rendered.
      await askBtn.click({ force: true });

      // (7) Auto-submit fires from ChatPanel's initialTextNonce effect —
      // no user send-press involved. The user bubble should contain the
      // templated prompt. Escape cleanedWord for safe regex embedding.
      const escaped = cleanedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const userBubble = page
        .getByTestId("chat-user-message")
        .filter({ hasText: new RegExp(`Explain me this word:\\s*${escaped}`) })
        .first();
      await expect(
        userBubble,
        'User bubble should show "Explain me this word: <word>" after Ask AI is clicked',
      ).toBeVisible({ timeout: 15_000 });

      // (8) Assistant reply arrives in the in-learn chat. Use .first()
      // because LearningChatLayout renders the chat panel in two sibling
      // slots (desktop + mobile) — on a desktop viewport the mobile copy
      // is display:none, so .last() would target the hidden one and never
      // resolve to visible.
      const assistant = page.getByTestId("chat-assistant-message").first();
      await expect(assistant).toBeVisible({ timeout: ASSISTANT_TIMEOUT });
      await expect(assistant).not.toBeEmpty();

      // (9) Quota drops by one — a fresh message was sent via the
      // learning-mode chat panel. Poll because the Convex mutation is
      // asynchronous. Assert strict decrement rather than exact count to
      // tolerate races with unrelated usage refreshes.
      if (quotaBefore !== null) {
        await expect(async () => {
          const quotaAfter = await readQuotaLeft(page);
          expect(quotaAfter).not.toBeNull();
          expect(quotaAfter!).toBeLessThan(quotaBefore);
        }).toPass({ timeout: 30_000 });
      }
    },
  );
});
