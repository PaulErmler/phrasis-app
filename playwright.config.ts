import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Playwright configuration.
 *
 * Execution phases (one shared test user throughout):
 *
 *   1. setup                — auth.setup.ts creates a fresh user + onboarding.
 *   2. tutorial             — runs tutorial.spec.ts FIRST; tours are one-shot
 *                             per user, so no other spec can dismiss them
 *                             before this project runs.
 *   3. chromium-parallel    — stateless / read-only specs. Multiple workers,
 *                             fullyParallel.
 *   4. chromium-serial      — specs that MUTATE shared user state (review
 *                             mode, locale, chat quota, cards). One worker,
 *                             serial within the project.
 *   5. course-management    — archives the onboarding course. Must run after
 *                             every spec that depends on the shared user's
 *                             courses, because it destroys that state.
 *   6. payment-overdue      — @live dunning journey with its OWN fresh user.
 *                             A separate project (not a file in
 *                             chromium-serial): `fullyParallel: false` only
 *                             serializes tests within one FILE — separate
 *                             files of a project still spread across
 *                             workers, and two concurrent fresh-signup +
 *                             onboarding walks (this + billing.spec.ts)
 *                             saturate the translation/TTS queues (the
 *                             documented flake source in auth.setup.ts).
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
      // Specs that mutate shared user state — chat quota, threads, card
      // ratings, review mode, locale, etc. These must not race each other,
      // and must run after the read-only phase has completed.
      // billing.spec.ts (@live) signs up its own fresh e2e-billing-* user
      // (billing state lives in Autumn/Stripe and survives suite runs, so
      // it cannot reuse a shared fixture) and walks the trial → upgrade →
      // downgrade journey against Stripe test mode.
      name: "chromium-serial",
      testMatch: [
        /chat-live\.spec\.ts/,
        /learning-journey\.spec\.ts/,
        /learning-settings\.spec\.ts/,
        /learning-undo\.spec\.ts/,
        /settings\.spec\.ts/,
        /add-cards-live\.spec\.ts/,
        /add-cards-import-live\.spec\.ts/,
        /content-filter-live\.spec\.ts/,
        /billing\.spec\.ts/,
      ],
      dependencies: ["chromium-parallel"],
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      name: "course-management",
      testMatch: /course-management\.spec\.ts/,
      dependencies: ["chromium-serial"],
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
