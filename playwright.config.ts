import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Playwright configuration.
 *
 * Execution phases (one shared test user throughout, except noted):
 *
 *   1. setup                — auth.setup.ts creates a fresh user + onboarding.
 *   2. tutorial             — runs tutorial.spec.ts FIRST; tours are one-shot
 *                             per user, so no other spec can dismiss them
 *                             before this project runs.
 *   3. chromium-parallel    — stateless / read-only specs. Multiple workers,
 *                             fullyParallel.
 *   4. chromium-serial      — specs that MUTATE the shared fixture user
 *                             (review mode, chat quota, cards, etc.).
 *                             workers:1 so they cannot race each other.
 *   5. billing-live         — billing.spec.ts with its OWN fresh user. Depends
 *                             only on chromium-parallel so it overlaps in
 *                             wall-clock with chromium-serial.
 *   6. settings-serial      — change-password (revokeOtherSessions) + locale.
 *                             workers:1, after chromium-serial so password
 *                             rotation cannot log out concurrent live specs.
 *                             Rewrites e2e/.auth/user.json for downstream.
 *   7. course-management    — archives the onboarding course. Waits for both
 *                             shared-user serial work and billing-live.
 *   8. payment-overdue      — @live dunning journey with its OWN fresh user.
 *   9. email-auth           — email verification + password-reset with its
 *                             own fresh user (empty storageState).
 */
export default defineConfig({
  testDir: "./e2e",
  // Sets E2E_TEST_HOOKS=1 on the dev deployment for the duration of the
  // run (auth-email capture + convex-run test hooks) and removes it again
  // afterwards, so normal dev usage sends real auth emails.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "tutorial",
      testMatch: /tutorial\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      // Parallel-safe specs: public pages, pure mounts, navigation,
      // read-only views. None of these mutate shared user state.
      name: "chromium-parallel",
      testMatch: [
        /auth\.spec\.ts/,
        /home\.spec\.ts/,
        /onboarding\.spec\.ts/,
        /navigation\.spec\.ts/,
        /learn\.spec\.ts/,
        /chat\.spec\.ts/,
        /library\.spec\.ts/,
        /stats\.spec\.ts/,
        /add-cards\.spec\.ts/,
        /add-cards-import\.spec\.ts/,
        /content-filter\.spec\.ts/,
      ],
      dependencies: ["tutorial"],
      fullyParallel: true,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      // Shared-fixture mutators — review mode, ratings, chat quota, cards,
      // content filter, etc. Must not race each other (workers:1). Do NOT
      // put change-password here (see settings-serial) or billing (own user).
      name: "chromium-serial",
      testMatch: [
        /chat-live\.spec\.ts/,
        /learning-journey\.spec\.ts/,
        /learning-settings\.spec\.ts/,
        /learning-undo\.spec\.ts/,
        /daily-goal\.spec\.ts/,
        /free-study\.spec\.ts/,
        /course-settings-sweep\.spec\.ts/,
        /add-cards-live\.spec\.ts/,
        /add-cards-import-live\.spec\.ts/,
        /content-filter-live\.spec\.ts/,
      ],
      dependencies: ["chromium-parallel"],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      // Own-user Stripe/Autumn trial journey. Parallel with chromium-serial
      // (only shares chromium-parallel as a dependency) so the long checkout
      // walk overlaps shared-fixture live specs instead of extending the
      // serial queue.
      name: "billing-live",
      testMatch: /billing\.spec\.ts/,
      dependencies: ["chromium-parallel"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      // Session-critical settings: changePassword with revokeOtherSessions
      // invalidates every other browser context still holding the old
      // cookie. Isolate to one worker after shared-user mutating specs.
      name: "settings-serial",
      testMatch: /settings\.spec\.ts/,
      dependencies: ["chromium-serial"],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      name: "course-management",
      testMatch: /course-management\.spec\.ts/,
      dependencies: ["settings-serial", "billing-live"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      // Self-contained @live dunning journey (fresh user, Stripe checkout,
      // billing override hooks). Chained AFTER everything else so its
      // signup + onboarding walk never runs concurrently with another
      // spec's — see the phase comment above. The spec sets its own
      // storageState via test.use.
      name: "payment-overdue",
      testMatch: /payment-overdue\.spec\.ts/,
      dependencies: ["course-management"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      // Email verification + password-reset journey with its own fresh
      // user and captured auth emails (E2E_TEST_HOOKS=1, set for the run
      // by global-setup.ts — see convex/features/authEmailTesting.ts). Chained
      // after course-management so its fresh signup never races the
      // fixture users' warmup fan-out; it never walks onboarding, so it is
      // cheap. The spec sets its own (empty) storageState via test.use.
      name: "email-auth",
      testMatch: /email-auth\.spec\.ts/,
      dependencies: ["course-management"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: "pnpm dev:frontend",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
