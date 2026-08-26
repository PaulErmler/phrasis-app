# Tech-debt backlog — deferred items

Audited 2026-08-26 across the whole codebase (backend, frontend, tests/CI/tooling/deps)
on the state that became `codebase-cleanup`. The items below were surveyed, verified
with file evidence, and **deliberately deferred** — this is the pick-list for future
cleanup rounds. Items chosen in the 2026-08 round are not listed; the `codebase-cleanup`
branch history documents those.

Line references are from the audit and will drift as code moves; each item names its
anchor symbols so it stays findable.

Tags: **Effort** S (≤half a day) / M (a day-ish) / L (multi-day). **Impact** on
correctness/cost/velocity noted per item.

## Correctness & robustness

- [ ] **A30 — Dataset seed `.unique()` crash on second dataset version.**
  `convex/db/seed.ts` looks up collections via `.withIndex('by_name', …).unique()`, but
  `convex/admin/uploadDataset.ts` writes the same `name` for every dataset version. The
  moment a second version exists, every seed lookup throws. Fix: query by name+version or
  `.first()` with deterministic order; also index the one unindexed `.filter()` in
  `convex/features/authEmailTesting.ts` (`kind`). Effort S. Impact: blocks future dataset
  uploads.
- [ ] **A10 — Clamp caller-supplied limits on public queries.** `getDeckCards`-style
  query in `convex/features/decks.ts` takes any `limit` into `.take()` plus a per-card
  content fan-out (docstring claims "(paginated)"; it isn't), and the onboarding
  sample query's `sampleSize` drives a documented N+1. Admin queries clamp; these don't.
  Fix: server-side max or `paginationOptsValidator`. Effort S. Impact: read-amplification
  and abuse headroom.
- [ ] **A12 — Replace `v.any()` on the public surface.** Chat `streamArgs`
  (`convex/features/chat/messages.ts`), Autumn `entityData` forwarded verbatim to the
  billing provider (`convex/autumn.ts`), `convex/admin/userContent.ts`. Also: use
  `paginationResultValidator` instead of the hand-rolled shape in `listMessages`.
  Effort M. Impact: unvalidated input into billing/chat components.
- [ ] **B24 — Bound the unbounded list subscriptions.** Full chat-thread history
  (`app/app/(main)/layout.tsx` `listThreads`), `getUserCourses` (CourseMenu),
  `getRecentWords` (WordCloudCard) grow with account age and re-render consumers on
  every mutation. Effort M. Impact: perf on old accounts.
- [ ] **A31 — Document the `userId` FK model.** `userId` is an unenforced `v.string()`
  across ~25 tables, derived from `identity.subject` (Convex guidelines prefer
  `tokenIdentifier`); integrity rests on the hand-maintained `USER_TABLES` list in
  `convex/admin/deleteUser.ts` guarded by one schema-coverage test. Write the deviation
  down (ADR) and strengthen the test. Effort M (doc S; any migration L). Impact:
  correctness-by-convention made explicit.

## Backend architecture & scale

- [ ] **A16 — Admin dashboard off whole-table scans.** `convex/admin/dashboard.ts` is
  built on `.take(4000)` scans with its own header math showing `listUsers` peaks at
  16,000 of Convex's 16,384-doc scan ceiling, plus up to 200 sequential per-user course
  queries. Crossing the ceiling hard-fails the dashboard. Fix: back counts with
  `@convex-dev/aggregate` (installed), paginate per-user detail. Effort L.
- [ ] **A15 — Replace `.take(N).length` row counts.** Dashboard reads 8,000
  `userProfiles` docs to render one number; `convex/db/courses.ts`
  (`getActiveCourseCount`/`getTotalCourseCount`) same pattern. Aggregate-backed counters.
  Effort S–M.
- [ ] **A22 — Split `courseSettings`.** ~78 near-all-optional fields mixing stable
  preferences with high-churn operational state (`currentSessionId` rewritten on every
  celebration dismiss; `writingSeed*`), all subscribed whole via
  `getActiveCourseSettings`; the audio family is triplicated as `X`/`XFull`/`XTranscribe`.
  Move churn state to its own table; consider a per-mode record for the triplets
  (migration). Effort L.
- [ ] **A24 — Enum the linguistic metadata columns.** `texts` stores register/genders/
  sentenceType/tenseAspect… as loose `v.string()` while `convex/types.ts` already defines
  the literal unions for the same fields. Verify rows conform, then narrow (migration).
  Effort M.
- [ ] **A27 — Add crons for sweeps.** No crons exist; stale
  `ttsGenerationClaims`/`llmTranslationClaims` are reclaimed only opportunistically,
  `testAuthEmails` accumulate, interrupted `accountDeletions` resume manually, the
  writing-track seeder gives up after 5 attempts. One `crons.ts` with stale-claim GC +
  purge + stalled-job recovery. Effort M.
- [ ] **A28 — Retire completed migrations from `runAll`.** 17 chained migrations incl.
  long-complete one-shots; two furigana backfills schedule one Node action per row;
  an orphaned docstring sits above the wrong function (`convex/migrations.ts`).
  Effort M.
- [ ] **A29 — Retire the stale warmup scripts.** Three near-identical admin warmup
  one-shots all document a TTS priority-queue that no longer exists (replaced by
  pool-choice in `convex/lib/workpools.ts`); `warmupSingleLanguage` subsumes the other
  two. Effort S.

## Frontend architecture & performance

- [ ] **B9 — The `useLearningMode` one-shot split.** 1,583 lines; the file's own scope
  note names three tangled concerns and says "don't split incrementally" — fund the
  planned split (card lifecycle / per-language answer state / audio orchestration)
  behind the existing e2e cover. Effort L (the biggest item on this list).
- [ ] **B19 — Split `use-audio-player.ts`.** 912 lines, five concerns, hand-managed
  blob-URL lifetimes, two exhaustive-deps suppressions. Seams:
  `useMergedCardAudio` + `useMediaSessionBinding`. Effort L.
- [ ] **B11 — Decide (and write down) the router story.** Six `page.tsx` files return
  null while a 465-line client layout hand-rolls pushState routing with all views kept
  mounted — costing server components, per-route loading, route-level splitting, and
  stale-build detection. Either an ADR documenting the SPA-shell choice + revisit
  trigger, or a migration project. Effort S (ADR) / L (migration).
- [ ] **B10 — Introduce code-splitting.** Zero `next/dynamic`/`React.lazy` anywhere
  (deliberate, documented in `AppUpdateGate`); the `hasVisited*` flags defer render
  cost, not download cost. Start with Stats/Chat/Settings views, measured. Effort M.
- [ ] **B18 — Narrow the i18n payload.** The full ~110 KB catalog (app + landing +
  auth) is serialized into every page via unnarrowed `getMessages()`. Per-route-group
  namespace narrowing (next-intl supports it). Effort M.
- [ ] **B29 — Memoize list-heavy components.** Only two first-party `memo()` calls
  exist; LibraryView's card rows, SegmentedHomeSection's rails/chips, and
  CollectionDetailDialog re-render wholesale on live Convex updates. Effort M.
- [ ] **B27 — Split `lib/languages.ts`.** 2,604 lines mixing ~1,400 lines of language
  data, UI helpers, the backend's LLM translation-routing config
  (`TRANSLATION_RULES`/`LUNA_BO3`), and a voices re-export; highest-churn file in the
  frontend. Three modules. Effort M.
- [ ] **B13 — Unify paywall wiring.** The quota-check + USAGE_LIMIT-catch +
  PaywallDialog scaffold is hand-rolled in ~7 places despite
  `useFeatureLock`/`useLimitDialog` existing. See **docs/paywall-wiring.md** (written
  2026-08) for the site inventory and unification recipe. Effort M.
- [ ] **B16/B17 — React-hooks rule cleanups.** ~50 setState-in-effect sites and ~120
  ref-writes-during-render are why `react-hooks/set-state-in-effect` and
  `react-hooks/refs` are globally disabled. See **docs/react-hooks-debt.md** (written
  2026-08) for the site inventory, the `useLatest()` plan, and the staged re-enable
  path. Effort M (refs) + L (set-state).

## Dead code & bundle

- [ ] **B1+B20 — Purge unused vendored ai-elements.** 21 of 30 files (2,857 lines)
  have no importer; 7 of them are the only users of the `@xyflow/react` prod
  dependency. `prompt-input.tsx` keeps 81 exports of which 7 are used — the unused
  families drag `cmdk` + hover-card into the chat bundle. Effort S.
- [ ] **B2 — Purge unused shadcn/ui.** 18 of 60 files (3,017 lines incl. the 725-line
  sidebar.tsx) with no importer; they keep `react-hook-form`, `@hookform/resolvers`,
  `react-day-picker`, `vaul`, `react-resizable-panels`, `input-otp`, and 4 Radix
  packages installed; `hooks/use-mobile.ts` is transitively dead. Effort S.

## Lint gates & type safety

- [ ] **C19 — Re-enable the three react-hooks rules** (purity, set-state-in-effect,
  refs) as `warn`, one at a time, after/alongside B16/B17. Effort S per rule once the
  cleanups exist.
- [ ] **C20 — `no-explicit-any` → `error`.** Only ~17 occurrences across 26 non-test
  files; fix the sites and flip the rule so the count stays zero (tests stay exempt).
  Effort M.
- [ ] **ts-ignore burn-down.** ~15 `@ts-ignore`/`@ts-expect-error`, mostly the untyped
  `soundtouchjs` import — write a minimal `types/soundtouchjs.d.ts` shim. Effort S.

## Tests & CI

- [ ] **C9 — Run the e2e tier in CI.** 31 maintained Playwright specs never run in CI;
  `playwright.config.ts` carries dead `process.env.CI` branches. Add a nightly or
  on-PR workflow running the mocked (non-`@live`) tier against a local Convex backend
  (the docker-compose stack the README documents). Needs CI secrets + infra decisions.
  Effort L.
  Kanban card (paste onto the board): `- [ ] Run the mocked e2e tier in CI — docs/tech-debt.md #ready-for-agent`
- [ ] **C13 — Fast e2e script.** TESTING.md documents `--grep-invert @live`, nothing
  implements it — bare `pnpm test:e2e` hits live OpenRouter/Google/Stripe. Add
  `test:e2e:fast`. Effort S.
- [ ] **C22b — Cover accountDeletion + usage/ + admin/.** `features/accountDeletion.ts`
  (irreversible path), 5/6 files in `convex/usage/` (quota accounting), 11/13 in
  `convex/admin/` have no direct tests. Effort L.
- [ ] **C23 — Make the Google integration suites' skip visible.** Both use
  `describe.skipIf(!apiKey)` — green-while-running-nothing in CI, live API calls from
  the jsdom project when a key is present. Move to an explicit opt-in vitest project.
  Effort M.
- [ ] **C35 — Split `e2e/helpers.ts`.** 35 KB / 24 exports imported by every spec,
  feeding an 11-project Playwright dependency chain. Split by domain, document the
  chain. Effort M.
- [ ] **C1/C2 — Revive the pre-commit hook.** `.husky/pre-commit` is committed
  non-executable (mode 644) so git never ran it — the typecheck + lint-staged gate has
  been dead; it also hard-blocks commits without a Convex snapshot and uses macOS-only
  `stat -f`. chmod +x, soften the snapshot check, make it portable. Effort S.
- [ ] **C8 — Fix the CI pnpm version mismatch.** CI pins pnpm 9 while the repo pins
  pnpm@10.26.2 (`onlyBuiltDependencies` is pnpm-10 semantics → CI runs all postinstall
  scripts, local runs three). Drop the hardcoded version; the action reads
  `packageManager`. Effort S.

## Dependencies & tooling

- [ ] **C14 — Burn down `pnpm.overrides`.** ~74 hand-maintained security pins with
  heavy redundancy (10× brace-expansion, 6× dompurify with strictly-subsumed dead
  ranges). Collapse to one entry per package, drop pins whose fix is inside the
  resolved range. Effort M.
- [ ] **C15+C30 — Dependency automation + patch hygiene.** No Dependabot/Renovate
  (which is why the overrides block grows by hand); `patches/convex-test.patch` is
  keyed to caret `^0.0.48` with no upstream issue link or removal criterion — pin
  exactly, link upstream. Effort S.
- [ ] **C26+C32 — Root `requirements.txt` + scripts cleanup.** The root file is a conda
  osx-64 environment dump (OS-level packages) while `data_preparation/` has its own
  three requirements files; `scripts/` mixes three runtimes and holds dead one-shots
  (`provisionPastDue.mjs` referenced by nothing, `uploadOgteV1.mjs` only by a completed
  runbook). Effort S.
- [ ] **C17 — Untrack the ~18 MB of ignored-but-tracked data.** 39 tracked files match
  `.gitignore` rules added after they were committed (11 MB classified_sentences.csv,
  5 MB ogte jsonl, `.cursor/` editor state). `git rm --cached`. Effort M.
- [ ] **C27 — Run the changelog rollup.** 101 entries in `changelog/unreleased/` and
  the monthly rollup has never run; `changelog/README.md` points at a skill path that
  doesn't exist in-repo. Run `/changelog-roll` for July + August, fix the reference.
  Effort S.
