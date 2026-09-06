# Testing

Four layers: Convex backend (vitest + convex-test), frontend units (vitest + jsdom),
React components/hooks (vitest + React Testing Library), and Playwright E2E.
This file records the *mechanisms and conventions*. It deliberately records no
file or test counts and no per-suite inventories — those drift; get them from
`pnpm test` and `pnpm exec playwright test --list`.

## How to run

```bash
pnpm test              # all three vitest projects (convex + app + node)
pnpm test:convex       # Convex backend only (edge-runtime)
pnpm test:app          # frontend only (jsdom)
pnpm test:watch        # watch mode
pnpm test:coverage     # v8 coverage with enforced backslide thresholds (what CI runs)
pnpm typecheck:tests   # tsc over app + test code (tsconfig.test.json; also in CI)

pnpm test:e2e          # Playwright, needs `pnpm dev` running in another terminal
                       #   NOTE: runs everything incl. @live specs (real paid APIs).
                       #   Fast tier: pnpm exec playwright test --grep-invert @live
pnpm test:e2e:ui       # Playwright UI mode
```

CI (`.github/workflows/ci.yml`) enforces lint, `typecheck:tests`, `test:coverage`
(thresholds included), and `next build`. E2E does not run in CI (tracked in
`docs/tech-debt.md`).

## Folder layout

All test code lives under three roots. No tests are co-located with source.

```
tests/                           # frontend + node (vitest "app" and "node" projects)
  setup.ts                       # app-project setup: jest-dom + next/navigation + next-intl stubs
  convexTestSetup.ts             # convex-project setup, outside convex/ on purpose (see Architecture notes)
  sanity.test.ts
  unit/                          # pure units, mirroring source: lib/ (audio, autumn, features,
                                 #   textCompare, tutorials, utils, wordCloud), i18n/
  components/                    # React Testing Library (app, autumn, chat, course, learning, …)
  hooks/                         # hook tests (renderHook) — canonical home for hooks/* sources
  node/                          # real-Node suites (espeak/lindera WASM engines)
  typeshims/                     # ambient types for test code (vite/client, …)
  integration/                   # provider-inventory checks against real Google APIs.
                                 #   CAVEAT: describe.skipIf(!apiKey) — they silently no-op
                                 #   without a key (incl. in CI). See docs/tech-debt.md.

convex/tests/                    # backend (vitest "convex" project, edge-runtime)
  sanity.test.ts
  schema.test.ts
  billing/                       # trial/switch/MoR wire contracts, error paths, autumn actions
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

Test files are excluded from `tsconfig.json` but type-checked by
`tsconfig.test.json` (`pnpm typecheck:tests`, enforced in CI). Vitest itself does
not typecheck.

## Architecture notes

- **Vitest projects.** `vitest.config.ts` defines three projects via
  `test.projects`: `convex` (edge-runtime), `app` (jsdom), and `node` — a
  real-Node environment for code that needs Node APIs unavailable in
  edge-runtime/jsdom (today the espeak-ng/lindera WASM engines, which load data
  bundles from disk; convex tests stub those engines instead).
- **Coverage.** The root config carries a v8 coverage block (lcov +
  text-summary, `reportOnFailure`) with global thresholds set a few points
  below measured reality — a backslide alarm, not an aspiration. When real
  coverage rises, ratchet the thresholds up (never down without a reason
  written in the commit).
- **Convex harness.** Every Convex test uses `convexTest(schema, modules)` with
  `const modules = import.meta.glob("/convex/**/*.ts")`. The root-anchored glob
  is required for `convex-test`'s `_generated` prefix resolution to work from
  any test depth.
- **The agent component runs for real in tests.** `@convex-dev/agent` ships an
  official test entry (`@convex-dev/agent/test`): its `register(t)` calls
  `t.registerComponent("agent", …)` with the component's own bundled source, so
  chat suites exercise the real threads/messages/streams component in-process.
  Only the LLM is stubbed, at the model layer
  (`vi.mock("@openrouter/ai-sdk-provider")` returning a hand-rolled
  LanguageModelV2). Two hard-won gotchas, encoded in the chat suites:
  - `ConvexError.data` comes back JSON-*stringified* across the convex-test
    boundary (real clients get the structured value); assertion helpers parse.
  - Draining the scheduler must advance fake time in small steps (~10ms), not
    `vi.runAllTimers()` — the agent component schedules stream-timeout jobs
    minutes out and cancels them from later mutations; firing those mid-drain
    trips convex-test's cancel-while-inProgress invariant.
- **Path alias.** `@/` maps to the repo root in both `vitest.config.ts` and the
  tsconfigs. Prefer `@/lib/foo` over relative imports in tests.
- **Global setup.** One setup file per vitest project. `tests/setup.ts` (app)
  registers jest-dom, stubs `next/navigation` + `next-intl` (the translator
  stub is identity-stable across renders, matching next-intl's memoized `t` —
  keep it that way or effect-dep tests get flaky), and shims `HTMLMediaElement`
  audio methods. `tests/convexTestSetup.ts` (convex) mocks the workpool clients
  and the aggregate component at the module boundary and stubs the env vars
  suites rely on; it lives OUTSIDE `convex/` on purpose — the Convex bundler
  analyzes every non-test module under `convex/`, and a top-level `vi.mock`
  there crashes the push with `InvalidModules` (see the comment in
  `vitest.config.ts`). Per-test `vi.mock(...)` can override either as needed.
- **Playwright.** `playwright.config.ts` defines twelve projects (currently:
  `setup`, `tutorial`, `chromium-parallel`, `chromium-serial`, `billing-live`,
  `settings-serial`, `course-management`, `payment-overdue`, `email-auth`,
  `account-deletion`, `onboarding-resume`, `billing-clock`) with an explicit
  dependency chain —
  ordering exists because tours are one-shot per user, some specs mutate shared
  user state, and course-management archives the onboarding course. The config
  file is the authority on the chain; don't trust prose summaries of it,
  including this one. The `webServer` entry assumes a reachable dev server and
  `reuseExistingServer` outside CI.
- **Fresh users per run.** `e2e/auth.setup.ts` signs up fresh
  `e2e-…@flexling.com` accounts on every full run and walks each through a
  different branch of the onboarding wizard (primary shared user + a
  placement-test fixture). No stale cookies; onboarding is exercised every
  time. The e2e lifecycle scripts hard-refuse to run against anything but a
  `dev:` deployment.
- **Live tagging.** Any test that hits real OpenRouter / Google TTS / Stripe is
  tagged `@live`. `--grep @live` for live only, `--grep-invert @live` for the
  fast tier (there is deliberately no packaged fast-tier script yet — see
  `docs/tech-debt.md`). Live `describe`s pin `retries: 0` so a flake doesn't
  silently spend a second chat message or TTS call.
- **`-live` spec pairs.** Some flows ship as a pair: `<name>.spec.ts` is the
  cheap default-tier smoke that never triggers paid backend work, while
  `<name>-live.spec.ts` covers the same flow against the real backend.
- **Billing specs.** The billing suites sign up their own fresh
  `e2e-billing-*` users in `beforeAll` (billing state lives in Autumn/Stripe
  and survives suite runs, so a shared fixture would break the never-trialed
  premise); they can be re-run standalone via `pnpm test:billing` /
  `--no-deps`. Test-clock specs accelerate Stripe only — hosted Autumn does not
  follow the clock.
- **`data-testid` convention.** Playwright specs locate UI via
  `page.getByTestId("…")`. Production components expose stable testids rather
  than matching visible text or CSS classes. See "Test selectors" below.

## Test selectors (`data-testid`)

We tag production components with `data-testid` attributes so Playwright
selectors don't break on copy changes, i18n locale switches, or Tailwind class
refactors. Prefer `getByTestId` over text / role matching for anything more
specific than a page-level landmark.

**Why not CSS classes instead?**

- Classes are owned by styling; a visual refactor shouldn't break tests.
- `getByTestId` is a first-class Playwright matcher with its own engine path.
- Testids can be stripped from prod bundles if we ever want to.
- Testids give a namespace isolated from Tailwind utility soup.

**Naming convention**: kebab-case, domain-prefixed, grouped as `<area>-<role>`
(`chat-input`, `card-approve`, `library-filter-mastered`).

The inventory of existing ids is the codebase itself: grep `data-testid=` (and
`data-tutorial=` / `data-coachmark-anchor=` for the tour system, whose values
come from the typed map in `lib/tutorials/anchors.ts`). E2E specs deliberately
keep raw anchor strings so rendered values can't drift unnoticed.

**Not tagged (and why):**

- **driver.js tour popover.** Rendered outside the React tree by a third-party
  library; `e2e/helpers.ts` `dismissTour` falls back to role/name matching plus
  the `.driver-overlay` class.
- **Auth forms.** Better Auth UI labels fields properly; role+name matchers are
  stable.

**Adding a new testid**: pick the convention slot (`<area>-<role>`), add
`data-testid="..."` on the JSX root, use it from the spec.

## Coverage

`pnpm test:coverage` produces the current v8 report (vitest projects only;
Playwright is not included) and fails on threshold backslides. Numbers are
deliberately not recorded here — run it. Convex coverage runs structurally
lower than the frontend because a share of backend code sits behind
`@convex-dev/*` components, Autumn, and external LLM/TTS providers.

## Known gaps

Kept intentionally short and mechanism-level; the itemized backlog with
effort/impact lives in `docs/tech-debt.md`.

- **Chat**: thread/message/title flows are covered in-process against the real
  agent component (see Architecture notes). Still uncovered: tool-call round
  trips through streamText (createCard / markAlsoCorrect as stream parts — the
  handlers themselves are covered in the cardApprovals/alsoCorrect suites),
  card-context prompt sections, per-step `$ai_generation` payload contents,
  and delta-level `syncStreams` assertions. `e2e/chat-live.spec.ts` remains the
  live cover.
- **Convex**: `features/accountDeletion.ts` and most of `admin/` have no direct
  suites; `db/stats/*` aggregation modules have only smoke coverage via
  `features/stats`.
- **Integration**: the Google provider-inventory suites silently no-op without
  an API key (see the caveat in Folder layout).
- **Frontend**: route-level `app/**` pages are exercised only via Playwright;
  motion/demo-heavy landing components and provider-heavy chat scaffolding are
  mostly untested by design.
- **E2E**: real LLM/TTS work is exercised only in the `@live` tier; the mocked
  tier stops short of paid fan-outs.

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

Structured errors: assert on `ConvexError` and parse `.data` if it arrives as a
string (see the chat suites' helpers). The authoritative Convex reference is
`convex/_generated/ai/guidelines.md`.

### Adding a frontend unit test

Place under `tests/unit/<mirror-of-source>/` (e.g. `lib/tutorials` sources →
`tests/unit/lib/tutorials/`). Import via the `@` alias.

### Adding a component/hook test

Hook tests go in `tests/hooks/` (canonical for `hooks/*` sources), component
tests in `tests/components/...`. Use React Testing Library; `tests/setup.ts`
already stubs `next/navigation` and `next-intl` — only override when your test
depends on specific translation strings.

### Adding an E2E test

Place under `e2e/*.spec.ts`. Authenticated tests inherit `storageState` from
their project automatically. Stub expensive backend calls with `page.route(...)`
in the default tier; tag the spec `@live` if it must hit real providers.

### Running the full flow locally

1. Terminal 1: `pnpm dev`
2. Terminal 2: `pnpm test && pnpm exec playwright test --grep-invert @live`

Env vars:
- `E2E_BASE_URL` (default `http://localhost:3000`)
- `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`: only needed when regenerating
  `e2e/.auth/user.json` from scratch
