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
 *   5. course-management    — archives the onboarding course. Must run LAST
 *                             because it destroys shared user state that
 *                             every other spec depends on.
 */
export default defineConfig({
  testDir: "./e2e",
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
        /settings\.spec\.ts/,
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
  ],
  webServer: {
    command: "pnpm dev:frontend",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
