# Testing

First-pass test suite landed 2026-04-14. Four layers: Convex backend (vitest + convex-test), frontend units (vitest + jsdom), React components/hooks (vitest + React Testing Library), and Playwright E2E.

## How to run

```bash
pnpm test              # both vitest projects (convex + app)
pnpm test:convex       # Convex backend only (edge-runtime)
pnpm test:app          # frontend only (jsdom)
pnpm test:watch        # watch mode
pnpm test:coverage     # v8 coverage report

pnpm test:e2e          # Playwright — needs `pnpm dev` running in another terminal
pnpm test:e2e:ui       # Playwright UI mode
```

## Folder layout

All test code lives under three roots. No tests are co-located with source.

```
tests/                           # frontend (vitest "app" project, jsdom)
  setup.ts                       # app-project setup: jest-dom + next/navigation + next-intl stubs
  convexTestSetup.ts             # convex-project setup — outside convex/ on purpose (see Architecture notes)
  sanity.test.ts
  unit/                          # pure units: lib/ (audio, autumn, features, textCompare, utils, wordCloud), i18n/
  components/                    # React Testing Library (app, autumn, chat, course, feature_tracking, home, import-texts, landing, learning, onboarding, ui)
  hooks/                         # hook tests (renderHook)
  integration/                   # provider-inventory checks (e.g. google-voices)

convex/tests/                    # backend (vitest "convex" project, edge-runtime)
  sanity.test.ts
  schema.test.ts
  billing/
  db/                            # incl. db/stats/
  features/                      # mirrors convex/features/ (incl. chat/)
  lib/                           # incl. stt/, tts/
  migrations/
  usage/

e2e/                             # Playwright
  auth.setup.ts
  helpers.ts
  .auth/                         # stored auth states (user.json, user-b.json, …)
  *.spec.ts                      # incl. <name>.spec.ts / <name>-live.spec.ts pairs (see below)
```

Test files are excluded from `tsconfig.json` (they are type-checked by vite during `vitest` runs, not by `tsc --noEmit`).

## Architecture notes

- **Vitest workspace** — `vitest.config.ts` defines two projects via `test.projects`. Convex tests run in `edge-runtime`; app tests run in `jsdom`.
- **Convex harness** — every Convex test uses `convexTest(schema, modules)` with `const modules = import.meta.glob("/convex/**/*.ts")`. The root-anchored glob is required for `convex-test`'s `_generated` prefix resolution to work from any test depth.
- **Path alias** — `@/` maps to the repo root in both `vitest.config.ts` (via `resolve.alias`) and `tsconfig.json` (via `paths`). Prefer `@/lib/foo` over relative imports in tests.
- **Global setup** — one setup file per vitest project. `tests/setup.ts` (app) registers `@testing-library/jest-dom/vitest`, stubs `next/navigation` + `next-intl`, and shims `HTMLMediaElement` audio methods. `tests/convexTestSetup.ts` (convex) mocks the workpool clients and the aggregate component at the module boundary; it lives OUTSIDE `convex/` on purpose — the Convex bundler analyzes every non-test module under `convex/`, and a top-level `vi.mock` there crashes the push with `InvalidModules` (see the comment in `vitest.config.ts`). Per-test `vi.mock(...)` can override either as needed.
- **Playwright** — `playwright.config.ts` defines six chained projects sharing one primary test user: `setup` (runs `e2e/auth.setup.ts` to produce `e2e/.auth/user.json`) → `tutorial` (tours are one-shot per user, so this must run before any spec can dismiss them) → `chromium-parallel` (stateless/read-only specs, multiple workers) → `chromium-serial` (specs that mutate shared user state, one worker) → `course-management` (archives the onboarding course, so it runs after everything that depends on it) → `payment-overdue` (`@live` dunning journey with its own fresh user). The `webServer` entry assumes a reachable dev server and `reuseExistingServer: true` outside CI.
- **Fresh users per run** — `e2e/auth.setup.ts` signs up two fresh `e2e-…@flexling.com` accounts on every full run and walks each through a different branch of the full onboarding wizard: the default "completely new" walk produces the primary shared user (`e2e/.auth/user.json`), the placement-test walk produces a secondary fixture (`user-b.json`). No stale cookies; onboarding is exercised every time.
- **Live tagging** — any test that hits real OpenRouter / Google TTS / OpenAI is tagged `@live`. Run `--grep @live` for live only, `--grep-invert @live` for the fast tier. Live `describe`s pin `retries: 0` so a flake doesn't silently spend a second chat message or TTS call.
- **`-live` spec pairs** — some flows ship as a pair of spec files: `<name>.spec.ts` is the cheap default-tier smoke that never triggers paid backend work (it stops short of the submit that would fan out to LLM/TTS, or only asserts on rendered UI), while `<name>-live.spec.ts` covers the same flow `@live`-tagged against the real backend and is excluded from the fast tier via `--grep-invert @live`. Current pairs: `add-cards-import`/`add-cards-import-live`, `chat`/`chat-live`, `content-filter`/`content-filter-live`.
- **Billing spec** — `e2e/billing.spec.ts` (@live, chromium-serial) walks the trial lifecycle: Stripe test-mode checkout starts a card-required trial, then upgrade/downgrade during the trial assert the trial is carried over (same end date) rather than restarted, skipped, or re-offered. It signs up its own fresh `e2e-billing-*` user in `beforeAll` (billing state lives in Autumn/Stripe and survives suite runs, so a shared fixture user would break the never-trialed premise on any rerun); this also means it can be re-run standalone (`--no-deps`) without the setup project. It leaves the account and its Autumn/Stripe test customer behind on purpose — the app has no user-deletion logic yet (same accumulation as the auth fixture users).
- **`data-testid` convention** — Playwright specs locate UI elements via `page.getByTestId("…")`. Production components expose stable testids rather than matching on visible text or CSS classes. See the "Test selectors" section below.

## Test selectors (`data-testid`)

We tag production components with `data-testid` attributes so Playwright selectors don't break on copy changes, i18n locale switches, or Tailwind class refactors. Prefer `getByTestId` over text / role matching for anything more specific than a page-level landmark.

**Why not CSS classes instead?**

- Classes are owned by styling; a visual refactor shouldn't break tests.
- `getByTestId` is a first-class Playwright matcher with its own engine path; `.class` selectors go through generic CSS resolution.
- Testids are stripped for prod bundles if we ever want to via `babel-plugin-jsx-remove-data-testid`. No equivalent tool for test-only classes.
- Testids give a namespace isolated from Tailwind utility soup.

**Naming convention**: kebab-case, domain-prefixed. Group as `<area>-<role>` (`chat-input`, `card-approve`, `library-filter-mastered`).

**Current testid inventory** (grouped by area, all registered in production JSX):

| Area | IDs |
| ---- | --- |
| Chat | `chat-new-input`, `chat-input`, `chat-submit`, `chat-toggle-conversations`, `chat-new-thread`, `chat-messages-log`, `chat-user-message`, `chat-assistant-message`, `chat-thread-entry` (+ `data-thread-id`) |
| Feature quota | `feature-quota-${featureId}` (e.g. `feature-quota-chat_messages`, `feature-quota-custom_sentences`) |
| Card approval | `card-approval`, `card-approve`, `card-reject`, `card-edit`, `card-approved-indicator` |
| Learn | `learn-rating-{again,hard,good,easy,still-learning,understood}`, `learn-undo`, `learn-reveal`, `learn-next`, `learn-submit-translation`, `learn-translation-input`, `learn-settings`, `clickable-word`, `ask-ai-button`, `progress-display-{continue,play-pause}`, `filter-blocked-{create-chat,create-custom,include-other}` |
| Learning settings | `settings-mode-audio`, `settings-mode-full`, `settings-writing-{translate,transcribe}`, `learning-settings-sheet` (switches use role=switch) |
| Content filter | `content-filter-trigger`, `content-filter-dropdown`, `content-filter-option-{course,custom,both}`, `source-badge-off`, `source-badge-reenable` |
| Library | `library-search`, `library-filter-{mastered,hidden,favorites}`, `library-source-{premade,custom}`, `library-card` |
| Collections | `collection-add-cards`, `collection-load-{more,earlier}`, `collection-show-{added,ignored}-toggle`, `collection-text-{add,ignore,prioritize}`, `collection-text-${row.status}` |
| Courses | `course-menu-trigger`, `course-menu-create`, `course-menu-entry`, `course-settings`, `course-settings-sheet`, `course-archive`, `course-confirm-archive`, `course-dialog-{next,back,create}`, `language-option-${language.code}` |
| Add cards / import | `add-cards-mode-{individual,import}`, `import-{paste,dropzone,file-input,delimiter,has-header,submit,confirm}`, `import-step-${i}`, `import-mapping-${language}`, `import-review-row-${i}`, `import-review-{edit,save}-${i}-${lang}`, `import-review-edit-input-${i}-${lang}`, `import-review-delete-${i}` |
| Onboarding wizard | `onboarding-step-<step>` (one per wizard step), `onboarding-back`, `onboarding-continue`, `proficiency-branch-{new,self-pick,test}`, `acquisition-option-${value}`, `acquisition-other-{input,char-count}`, `goal-option-${value}`, `goal-other-{input,char-count}`, `daily-time-option-${value}`, `daily-time-custom-input`, `plan-pick-skip`, `word-projection-continue`, `feature-tour-{next,back,done}` |
| Placement test | `placement-test-{reveal,knew-it,didnt-know}`, `placement-result-{continue,easier,harder}`, `placement-content-retry` |
| First lesson | `first-lesson-start`, `first-lesson-skip`, `first-lesson-mode-{audio,translate,transcribe}` |
| Stats | `stats-tile-{words,streak,reviews,sentences,time,accuracy}`, `stats-wordcloud` |
| Navigation | `bottom-nav-${view}`, `language-switcher` |
| Billing | `pricing-card-cta-${productId}` (e.g. `pricing-card-cta-basic_annual`), `pricing-trial-badge`, `checkout-dialog-{title,message,confirm}`, `checkout-due-today`, `checkout-no-commitment` |
| Payment overdue | `payment-overdue-{dialog,notice,pay,cancel,cancel-warning,cancel-back,cancel-confirm}` |

**Not tagged (and why):**

- **driver.js tour popover** — rendered outside the React tree by a third-party library. We can't add a testid without patching the library; `e2e/helpers.ts` `dismissTour` falls back to `getByRole("dialog", { name: /welcome to flexling/i })` plus the `.driver-overlay` CSS class for the backdrop. There's a `TODO` in the helper to migrate if a maintained fork ever exposes one.
- **Auth forms** — Better Auth UI labels fields properly; role+name matchers are stable.

**Adding a new testid**: pick the convention slot (`<area>-<role>`), add `data-testid="..."` on the JSX root of the element, update a spec to use it, update the inventory table above.

## Coverage

Run `pnpm test:coverage` for the current v8 report (vitest projects only — Playwright is not included). Numbers are deliberately not recorded here; they go stale. Convex coverage runs structurally lower than the frontend because a large share of backend code sits behind `@convex-dev/agent`, `@convex-dev/aggregate`, `@convex-dev/action-retrier`, Autumn, and external LLM/TTS providers — see "Not yet covered" below.

## Test summary

Counts are deliberately not recorded here — they drift. Run `pnpm test` for current vitest totals and `pnpm exec playwright test --list` for the Playwright inventory.

Seven e2e spec files are tagged `@live` and hit real backends (OpenRouter / TTS / Stripe test mode) via the dev server: `add-cards-import-live`, `billing`, `chat-live`, `content-filter-live` (tag added in the 2026-07 cleanup — it always hit the real backend), `learning-journey`, `learning-undo`, `payment-overdue`. Run them with `--grep @live`; default runs exclude them via `--grep-invert @live`.

### Covered (vitest)

**Convex backend — `convex/tests/`**
- `schema.test.ts` — 4 invariants (required fields, index presence)
- `features/courses.test.ts` (9), `features/decks.test.ts` (6 + 1 skipped)
- `features/collections.test.ts` (5), `features/library.test.ts` (4)
- `features/customTexts.test.ts` (3 + 2 skipped), `features/translation.test.ts` (3 + 1 skipped)
- `features/tts.test.ts` (7), `features/ttsProcessing.test.ts` (5 + 1 skipped)
- `features/sentenceMetadata.test.ts` (4 + 3 skipped)
- `features/stats.test.ts` (6), `features/scheduling.test.ts` (5 + 3 skipped)
- `features/chat/cardApprovals.test.ts` (8 + 1 skipped)
- `features/chat/messages.test.ts` (3 + 3 skipped), `features/chat/threads.test.ts` (2 + 3 skipped)

**Frontend units — `tests/unit/lib/`**
- Text comparison (word-tracking): `normalize`, `editDistance`, `segment`, `charDiff`, `wordAlign`, `score`, `languageConfig` — 47 tests total
- `formatTime`, `timezone`, `utils`, `languages` (27), `scheduling` (16)
- `utils/languageOrder`, `autumn/find-upgrade-product`, `features/feature-meta`

**Hooks — `tests/hooks/`** (14 files, ~56 tests)
- `use-animated-counter`, `use-cached-query`, `use-card-approvals`
- `use-chat-messages`, `use-chat`, `use-course-languages`
- `use-ensure-content`, `use-media-query`, `use-mobile`
- `use-screen-wake-lock`, `use-send-message`, `use-stats-snapshot`
- `use-thread`, `use-voice-recording`

**Components — `tests/components/`** (18 files)
- `ui/`: `button`, `badge`, `input`, `card`, `alert`, `skeleton`, `spinner`, `textarea`, `separator`, `label`
- `chat/`: `ChatHeader`, `VoiceRecordButton`, `CardApproval`
- `course/`: `DifficultySelector`, `LanguageSelector`
- `home/`: `cta-buttons`, `go-to-app-button`
- `landing/`: `pricing-section`, `landing-footer`, `faq-section`
- root: `LogoSpinner`, `ThemeSwitcher`, `LanguageSwitcher`

### Covered (Playwright)

`home`, `auth` (sign-in/up), `onboarding`, `learn`, `library`, `chat`, `stats`, `settings` (+ locale), `add-cards`, `debug`, `navigation`. LLM/generation endpoints are stubbed via `page.route(...)` where present.

## Not yet covered / TODO

### Skipped-in-place (6 vitest tests, all in `convex/tests/features/chat/`)

All six remaining skips are in the chat feature and blocked by the same thing: the functions call `ctx.runQuery(components.agent.threads.*)` / `ctx.runMutation(components.agent.threads.updateThread, ...)` and `saveMessage` / `listUIMessages` / `syncStreams`. These refs are resolved through convex-test's component registry, so `vi.mock("@convex-dev/agent", ...)` doesn't intercept them.

- `threads.test.ts` — authenticated `listThreads`, `getOrCreateEmptyThread`, `getThread`
- `messages.test.ts` — `sendMessage`, `generateResponse`, `generateThreadTitle`

Unblocking would require either `t.registerComponent("../../node_modules/@convex-dev/agent/src/component", ...)` (fragile — compiled module surface) or a production-side seam injecting a fake threads component (production change).

**These six flows are instead covered behaviorally by `e2e/chat-live.spec.ts`** — four Playwright tests (`@live`-tagged) that hit the real dev backend with real OpenRouter + TTS, asserting user-visible behavior (message appears, assistant replies, thread auto-titles, sidebar lists threads, navigating back restores messages). Run with `pnpm exec playwright test --grep @live`. Skip with `--grep-invert @live`.

### Previously skipped, now passing (12 unblocked 2026-04-14)

- `scheduling.test.ts` — `masterCard`, `hideCard`, `toggleFavoriteCard` (aggregate stubbed)
- `decks.test.ts` — `addCardsFromCollection` full path
- `customTexts.test.ts` — `createCustomText` full flow, `autoFillTranslations` OpenRouter call
- `sentenceMetadata.test.ts` — `fetchSentenceMetadata`, `generateSentenceMetadata`, `applyMetadataAndPrepareCard` speaker-gender patch
- `ttsProcessing.test.ts` — `processTTSForCard` full pipeline (fetch stubbed)
- `translation.test.ts` — `romanizeText` via Google v3 (OAuth + romanize fetch stubbed)
- `chat/cardApprovals.test.ts` — `approveCard` happy path

**Mocking patterns used** (all per-file, no shared helpers):
- `vi.mock("@convex-dev/aggregate")` — `TableAggregate` class with no-op async methods
- `vi.mock("@convex-dev/action-retrier")` — `ActionRetrier` whose `run()` calls `ctx.runAction`
- `vi.mock("ai")` + `vi.mock("@openrouter/ai-sdk-provider")` — canned JSON `generateText`
- `vi.stubGlobal("fetch", ...)` + `vi.stubEnv(...)` — scoped per test with cleanup

### Modules/areas without tests

**Convex**
- `convex/features/chat/agent.ts`, `chat/transcribe.ts` — action surfaces entirely owned by AI SDK + agent component.
- `convex/db/stats/*` (8 aggregation modules) — only smoke coverage via `features/stats`; each module deserves direct unit tests.
- `convex/usage/*` — Autumn integration; needs stub harness.
- `convex/migrations/*` — the one-shot historical backfills were deleted once run. What remains is the dataset-cutover family (`datasetMigration_*`, live — called by `admin/activateDataset`, and tested) plus reusable seed/ops utilities (`seedMockStats`, `seedPlacementTestSentences`, `recalcUserCardAggregates`).
- `convex/http.ts`, `convex/auth.ts`, `convex/functions.ts` — plumbing modules.

**Frontend**
- `hooks/use-audio-player` — requires `mergeCardAudio`, MediaSession, webLocks, AbortController wiring; skip rationale recorded.
- `components/chat/` (most of it) — `ChatMessages`, `ChatInput`, `ChatPanel`, `NewChatInput`, `ThreadSidebar`, `ChatHistorySidebar`, `MessageErrorBoundary` need provider scaffolding (Convex agent + streamdown + ai-elements).
- `components/app/*` — depend on `AppDataProvider`, Convex preloaded queries, and `driver.js` tours.
- `components/course/CreateCourseDialog`, `DualLanguageEditor`, `CourseLanguageSettings`.
- `components/landing/*` — only 3 of 34 covered (pricing, footer, faq). The remaining are motion/demo-heavy.
- `components/ai-elements`, `components/autumn`, `components/consent`, `components/feature_tracking`, `components/testing`, `landing/demo(s)`, `landing/mock-ui`.
- `components/AuthRefresh`, `ClientAuthBoundary`, `ConvexClientProvider`, `PWAInstallGlobal`, `PWASplashScreen`, `ServiceWorkerRegistration`, `SignInPrompt`, `Header`, `Footer`.
- `app/**` route-level pages — only exercised via Playwright smoke; no RSC unit tests.
- `i18n/locale.ts` + `i18n/request.tsx` — server-only, `'use server'` + `next/headers`; defer to E2E.
- `lib/audio/mergeAudio`, `lib/audio/mediaSession`, `lib/env`, `lib/content` — IO / global-side-effect modules.

**E2E flows skipped / stubbed**
- Real LLM chat send → response.
- Real card generation in add-cards.
- Onboarding completion (gated by user state).
- Audio / TTS playback inside Learn.
- Exact locale-toggle text equality.

## Conventions

### Adding a Convex test
Place it under `convex/tests/` mirroring the source path. Template:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../schema";               // adjust depth
import { api } from "../../_generated/api";      // adjust depth

const modules = import.meta.glob("/convex/**/*.ts");

describe("feature X", () => {
  it("does the happy path", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });
    const id = await t.run((ctx) => ctx.db.insert("thing", { ... }));
    expect(await asUser.query(api.features.thing.get, { id })).toBeTruthy();
  });

  it("rejects unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.features.thing.get, { id: "" as any }))
      .rejects.toThrow();
  });
});
```

The authoritative reference is `convex/_generated/ai/guidelines.md`.

### Adding a frontend unit test
Place under `tests/unit/<mirror-of-source>/`. Import via the `@` alias:

```ts
import { describe, it, expect } from "vitest";
import { foo } from "@/lib/foo";
```

### Adding a component/hook test
Place under `tests/components/...` or `tests/hooks/...`. Use React Testing Library:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Thing } from "@/components/Thing";

vi.mock("convex/react", () => ({
  useQuery: () => ({ ... }),
  useMutation: () => vi.fn(),
}));

describe("<Thing />", () => {
  it("renders", () => {
    render(<Thing />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
```

`tests/setup.ts` already stubs `next/navigation` and `next-intl`; only override when your test depends on specific translation strings.

### Adding an E2E test
Place under `e2e/*.spec.ts`. Use `@playwright/test`. Authenticated tests inherit `storageState` from the chromium project automatically. Stub expensive backend calls with `page.route(...)`.

### Running the full flow locally

1. Terminal 1 — `pnpm dev`
2. Terminal 2 — `pnpm test && pnpm test:e2e`

Env vars:
- `E2E_BASE_URL` (default `http://localhost:3000`)
- `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` — only needed when regenerating `e2e/.auth/user.json` from scratch
