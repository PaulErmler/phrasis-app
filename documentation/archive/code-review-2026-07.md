> **ARCHIVED** — Frozen review snapshot as of ~2026-07-05; line anchors have drifted since, and findings marked RESOLVED below were fixed after the review.

# Codebase Review — July 2026

Full-codebase review focused on code quality, frontend efficiency, and user experience.
Method: three parallel exploration passes (repo/tooling, frontend, Convex backend) followed by
a verification pass in which every finding below was confirmed against the actual code.
Candidates that did not survive verification are listed in the appendix.

**Legend** — Severity: 🔴 High / 🟡 Medium / 🟢 Low · Effort: **S** (< 1 h) / **M** (half-day–day) / **L** (multi-day)

---

## Summary — highest-impact items

1. **[F-1]** Zero code-splitting: `recharts`, `@xyflow/react`, `shiki`, `streamdown`, and a 1,222-line settings screen all ship in the main bundle. 🔴 M
2. **[B-1]** Admin dashboard metrics silently become wrong past 4,000 users (`MAX_SCAN` caps + counting via `.take().length`). 🔴 M
3. **[F-2]** The app shell mounts every tab simultaneously and keeps hidden tabs' Convex subscriptions live. 🟡 M
4. **[U-2]** No client-side error reporting — all 49 `console.error` sites in `components/` are invisible in production; failed queries render as infinite loading. 🟡 M
5. **[F-3]** Audio time-stretch + WAV encode run on the main thread; a 60 fps `setState` loop re-renders the review card during playback. 🟡 M
6. **[B-2]** `reviewCard` performs ~15–20 document writes per review — the hot path of the whole app. 🟡 M/L
7. **[Q-1]** Dependency hygiene: both lockfiles committed; `i`, `soundtouch-ts`, and the `radix-ui` meta-package are unused. 🟢 S
8. **[F-4]** LibraryView renders up to 100 heavy card components with no virtualization and a hard 100-card cap with no pagination. 🟡 M

---

## Frontend performance

### F-1 · 🔴 · Effort M — No code-splitting anywhere; heavy libraries in the main bundle

There is not a single `next/dynamic` or `React.lazy` in the codebase (verified by grep). Heavy
dependencies are all statically imported:

- `recharts` — [components/ui/chart.tsx](components/ui/chart.tsx), [components/app/stats/CumulativeLineChart.tsx](components/app/stats/CumulativeLineChart.tsx), [components/admin/TimeSeriesCard.tsx](components/admin/TimeSeriesCard.tsx)
- `@xyflow/react` (+ its CSS) — 7 files in [components/ai-elements/](components/ai-elements/)
- `shiki` (bundles language grammars) — [components/ai-elements/code-block.tsx](components/ai-elements/code-block.tsx)
- `streamdown` — [components/ai-elements/message.tsx](components/ai-elements/message.tsx), [components/ai-elements/reasoning.tsx](components/ai-elements/reasoning.tsx)
- `@isoterik/react-word-cloud` — [components/landing/LandingWordCloud.tsx](components/landing/LandingWordCloud.tsx)
- [LearningModeSettings.tsx](components/app/LearningModeSettings.tsx) (1,222 lines, opened rarely) is statically imported by [LearningMode.tsx:10](components/app/LearningMode.tsx#L10)

**Fix:** wrap the rarely-used surfaces in `next/dynamic` with a loading fallback. Best-value
targets, in order: admin dashboard charts, `LearningModeSettings`, the ai-elements canvas
(xyflow) and code block (shiki), the landing word cloud. Stats charts can lazy-load when the
Stats tab is first visited (it's already mount-gated, see F-2).

### F-2 · 🟡 · Effort M — App shell mounts all tabs at once and keeps hidden subscriptions live

[app/app/(main)/layout.tsx](app/app/(main)/layout.tsx#L354-L432) renders every tab and toggles
visibility with inline `display: 'contents' | 'none'`:

- `SettingsView` is mounted **unconditionally** ([layout.tsx:412-421](app/app/(main)/layout.tsx#L412-L421)) — no `hasVisited` gate at all.
- Library/Stats are gated on first visit, but once visited they stay mounted (subscriptions live) while the user is on other tabs. (Opening chat or learn does reset the flags — [layout.tsx:178-179](app/app/(main)/layout.tsx#L178-L179), [212-213](app/app/(main)/layout.tsx#L212-L213) — so this is a partial, somewhat accidental mitigation.)
- The shell also warms `getCardForReview` on every render cycle outside learn ([layout.tsx:118-121](app/app/(main)/layout.tsx#L118-L121)) and pre-creates a chat thread on mount ([layout.tsx:141-145](app/app/(main)/layout.tsx#L141-L145)). The warm subscription is a deliberate, commented optimization — fine — but it compounds with the rest.
- Tab routing is hand-rolled `history.pushState` + `popstate` with refs guarding races ([layout.tsx:230-258](app/app/(main)/layout.tsx#L230-L258)) — it works, but it's the kind of code that breaks silently on the next edge case (it already needed the swipe-back ref fix documented inline).

**Fix (incremental):** gate `SettingsView` like Library/Stats; unmount hidden tabs after an
idle timeout (or immediately) instead of keeping them alive forever — Convex refetches are
cheap and `use-cached-query` already exists to mask the loading flash. Longer-term, consider
letting Next.js route segments own the tabs (the route stubs already exist) so history handling
comes for free.

### F-3 · 🟡 · Effort M — Audio pipeline: main-thread DSP + 60 fps setState during playback

- The soundtouchjs time-stretch ([lib/audio/timeStretch.ts](lib/audio/timeStretch.ts)) and WAV encode (`audiobuffer-to-wav` in [lib/audio/mergeAudio.ts](lib/audio/mergeAudio.ts)) run synchronously on the main thread. (The `OfflineAudioContext` mixdown itself renders off-thread — the JS stretch/encode around it is the blocking part.) During review auto-advance this competes with rendering the next card.
- [hooks/use-audio-player.ts:322-332](hooks/use-audio-player.ts#L322-L332) runs a `requestAnimationFrame` loop calling `setCurrentTime(audio.currentTime)` every frame while playing — a React re-render of the consuming card ~60×/second for word highlighting.
- The stretched-buffer LRU is bounded (32 entries) but holds ~10–20 MB of decoded PCM; acceptable, just worth knowing.

**Fix:** move stretch + WAV encode into a Web Worker (transfer `Float32Array`s, keep the LRU in
the worker). For highlighting, derive the active word index from `currentTime` and only
`setState` when the **word index** changes (a few times/second) instead of every frame — same
visual result, ~95% fewer re-renders.

### F-4 · 🟡 · Effort M — LibraryView: 100 unvirtualized heavy cards, hard cap, no pagination

[convex/features/library.ts:62](convex/features/library.ts#L62) hard-caps at `LIBRARY_LIMIT = 100`
with an explicit "no pagination" comment, and [LibraryView.tsx:530](components/app/LibraryView.tsx#L530)
renders all of them as full `LearningCardContent` components (328 lines each) in one list.
Users with more than 100 matching cards silently never see the rest — a UX correctness issue,
not just performance. The view also maintains complex reconciliation state
(`ephemeralOverrides`, `stickyCards`, `orderIds`, drag ordering) that re-runs over the full list.

**Fix:** switch the backend to `usePaginatedQuery`/`.paginate()` and virtualize the list
(e.g. `@tanstack/react-virtual` — no virtualization library is currently installed). This
removes both the cap and the render cost.

### F-5 · 🟡 · Effort S — Chat message list re-renders wholesale during streaming — **RESOLVED**

**RESOLVED after this review:** `ChatMessages.tsx` now renders rows through a memoized `ChatMessageRow` component.

[components/chat/ChatMessages.tsx:191](components/chat/ChatMessages.tsx#L191) maps
`displayMessages` to `Message`/Streamdown markdown with zero memoization (no `React.memo`,
no `useMemo` in the file — verified). Every streamed token re-renders and re-parses markdown
for **every** message in the thread, not just the streaming one.

**Fix:** extract the map body into a `React.memo` row component keyed on
`(message.id, message.status, messageText)`. Small change, large win on long threads.

### F-6 · 🟡 · Effort M — Entire i18n dictionary serialized to the client on every page

[app/layout.tsx](app/layout.tsx) passes the full `getMessages()` result into
`NextIntlClientProvider` ([app/providers.tsx:39-43](app/providers.tsx#L39-L43)):
`messages/de.json` is 68 KB, `en.json` 64 KB, and that payload is embedded in the HTML of every
page — including the landing page, which additionally has its own 22–24 KB namespace files.

**Fix:** next-intl supports per-component/namespace message selection — pass only the
namespaces the client actually needs per layout (e.g. app shell vs landing vs auth), keeping
server components on `getTranslations` (free).

### F-7 · 🟢 · Effort M — Oversized always-hot components

[SegmentedHomeSection.tsx](components/app/segmented/SegmentedHomeSection.tsx) (937 lines,
7 query hooks + 3 mutations, verified) is the most-visited screen;
[FullReviewCardContent.tsx](components/app/learning/FullReviewCardContent.tsx) (928 lines,
~10 effects) re-runs a dense effect graph per keystroke. Neither is broken — but both are past
the size where re-render behavior can be reasoned about. Split by responsibility and memoize
the group/level subtrees.

---

## Frontend architecture & UX

### U-1 · 🟡 · Effort M — Product views have no error boundaries; failed queries look like infinite loading

Only three route-level boundaries exist ([app/error.tsx](app/error.tsx),
[app/global-error.tsx](app/global-error.tsx), [app/app/(main)/error.tsx](app/app/(main)/error.tsx))
plus chat-local ones. Home, Library, Stats, and Learn have none, and most views branch on
`query === undefined` — so a throwing query or lost connection renders as a **permanent
skeleton** with no retry affordance. Silent `.catch(() => {})` compounds this:
[layout.tsx:136](app/app/(main)/layout.tsx#L136) (thread prefetch) and
[PlacementTestStep.tsx:196](app/app/onboarding/steps/PlacementTestStep.tsx#L196) — the latter
means a failed `ensureTranslations` during onboarding placement leaves missing content with
zero feedback, in the flow where first impressions matter most.

**Fix:** add an error boundary + retry UI around each tab's content in the main layout (one
shared component); give the placement-test ensure call a visible retry path.

### U-2 · 🟡 · Effort M — No production error reporting at all

There is no Sentry/PostHog/Bugsnag/etc. anywhere in the app (verified — the only grep hits
were the string "scrollbar"). The 49 `console.error` calls in `components/` are good, intentional
error logging — that all goes nowhere in production. Combined with U-1, user-facing failures
are currently invisible to you.

**Fix:** wire an error-reporting SDK into `app/global-error.tsx`, the U-1 boundaries, and a
small `reportError()` helper that the existing `console.error` sites can adopt incrementally.

### U-3 · 🟢 · Effort S — Brand inconsistency is user-visible

`package.json` says `flexling-app`; the PWA metadata in [app/layout.tsx](app/layout.tsx)
(`apple-mobile-web-app-title`, `title: 'Flexling'`) shows **Flexling** on users' home screens
while the repo/Vercel project is **phrasis-app**. Whichever way the rebrand is going, the
installed-app name is the most user-visible string in the codebase — worth resolving
deliberately (manifest, meta tags, package name, README in one pass).

### U-4 · 🟢 · Effort S — Sparse loading states outside the home screen

Only ~20 files use `Skeleton`/`animate-pulse`/`Spinner`. `SegmentedHomeSection` has a proper
skeleton and `use-cached-query` masks flashes on some queries, but Stats cards and chat surfaces
pop in without reserved space (layout shift). Low-cost polish: reserve dimensions on the Stats
cards and chat history list.

### U-5 · 🟢 · Effort S — `prototypes/` contains production code

[ImportTextsView.tsx:10](components/app/import-texts/ImportTextsView.tsx#L10) ships
`StepperImportView` from a folder named `prototypes/` — it is **not** dead code (initial
exploration flagged it as removable; verification showed the opposite). Rename/move it so the
next cleanup pass doesn't delete the import flow.

### U-6 · 🟢 · Effort S — Raw `<img>` in 12 places

12 raw `<img>` tags vs 4 files using `next/image`. Where the images are remote or above the
fold (landing page especially), `next/image` gets sizing, lazy-loading, and format negotiation
for free. Audit the 12 and convert the ones that matter.

---

## Backend (Convex)

### B-1 · 🔴 · Effort M — Admin dashboard silently mis-counts past `MAX_SCAN`

[convex/admin/dashboard.ts:14](convex/admin/dashboard.ts#L14) sets `MAX_SCAN = 4000` and every
aggregate query scans-then-counts in memory:

- `totalUsers` = `(await …take(MAX_SCAN * 2)).length` ([dashboard.ts:165](convex/admin/dashboard.ts#L165)) — caps at 8,000, exactly the "never count with `.take().length`" anti-pattern from the Convex guidelines
- `getPlanDistribution` ([dashboard.ts:190](convex/admin/dashboard.ts#L190)), `getLanguageStats` ([:220](convex/admin/dashboard.ts#L220)), `getOnboardingFunnel` ([:261](convex/admin/dashboard.ts#L261)), `getSignupSeries` ([:147](convex/admin/dashboard.ts#L147)) all `take(MAX_SCAN)`
- `listUsers` ([dashboard.ts:303](convex/admin/dashboard.ts#L303)) filters/sorts/paginates in memory over the newest 4,000 profiles — older users become unfindable

The header comment acknowledges the ceiling, but the failure mode is *silently wrong numbers*,
not an error. The project already depends on `@convex-dev/aggregate` (three aggregates are
registered in `convex.config.ts`) — the pattern to fix this is already in the codebase.

**Fix:** back `totalUsers`, plan distribution, and signup series with aggregates or
denormalized counters maintained at write time; convert `listUsers` to real pagination over an
index, applying plan/activity filters via indexed fields rather than in-memory scans.

### B-2 · 🟡 · Effort M/L — `reviewCard` writes ~15–20 documents per review

[scheduling.ts:597](convex/features/scheduling.ts#L597) →
[recordReviewStats.ts](convex/db/stats/recordReviewStats.ts) updates, per review: `courseStats`,
`dailyStats`, `weeklyStats`, `monthlyStats`, `yearlyStats`, `dailyLanguageStats` +
`languageStats` **per course language** (loop at [recordReviewStats.ts:248-270](convex/db/stats/recordReviewStats.ts#L248-L270)),
`reviewDepthAccuracy`, word tracking, `collectionProgress`, three aggregates, the card itself,
and a `reviewLogs` insert. In audio auto-advance mode this runs every few seconds and is the
app's dominant write load and most OCC-retry-prone path (contention is per-user, so it degrades
the fast reviewer's own session). Also: `courseStats` is patched twice when new words are
tracked ([:104](convex/db/stats/recordReviewStats.ts#L104) and [:273](convex/db/stats/recordReviewStats.ts#L273)) — trivially mergeable.

**Fix (staged):** merge the two `courseStats` patches (S). Then consider folding
weekly/monthly/yearly into derived reads over `dailyStats` (they're pure roll-ups), or batching
stats writes into a debounced per-session record that a scheduled function folds in — cuts the
per-review write count roughly in half without losing any data.

### B-3 · 🟡 · Effort S/M — Terminal translation failures are invisible

When the LLM chain (20 retries, [llmTranslationQueue.ts:59](convex/features/llmTranslationQueue.ts#L59))
*and* the Google fallback both fail, [decks.ts:1724-1737](convex/features/decks.ts#L1724-L1737)
logs to console and writes nothing — no translation row, no audio, no record. The claim expires
and the next user access re-drives the pair (correct per the no-crons/self-heal design), but a
text that's never re-viewed stays content-less forever, and there is no way to see how often
this happens. Audio failures get a `ttsMismatches` row; translations get nothing.

**Fix:** write a `translationFailures` row (or a `failedAt`/`failureCount` marker) in the
terminal catch, and surface a count in the admin dashboard. Keeps the self-heal design,
adds eyes.

### B-4 · 🟢 · Effort S — Loose `v.any()` on public billing actions

[autumn.ts:129-130](convex/autumn.ts#L129-L130): public `attach`/`checkout` accept
`entityData: v.any()` and `checkoutSessionParams: v.record(v.string(), v.any())`, forwarded
verbatim to Autumn. Autumn validates server-side so it's not exploitable today, but it's an
unvalidated public surface on the money path. Tighten to the fields actually used (the
neighboring `customerData` validator shows the pattern).

### B-5 · 🟢 · Effort S — `.filter()` after `.withIndex()` in `resolveStartingCollection`

[db/collections.ts:35-39](convex/db/collections.ts#L35-L39) post-filters on `code` after the
`by_datasetId_and_order` index — the only guideline-violating `.filter()` in the codebase.
Bounded (~20 collections/dataset) so harmless today; add a `by_datasetId_and_code` index and
it's O(1).

### B-6 · 🟢 · Effort S — `diagCutoverState` does unbounded `.collect()` ×3 — **RESOLVED**

**RESOLVED after this review:** `convex/admin/diagCutoverState.ts` has been deleted.

[admin/diagCutoverState.ts:17-29](convex/admin/diagCutoverState.ts#L17-L29) collects all of
`courses`, `courseSettings`, and `collectionProgress`. It's internal-only and self-labeled
"safe to delete after verifying" — it will start throwing at the 16,384-document read limit
right when you'd want a diagnostic. Delete it (or index-scope it) now that the cutover is done.

### B-7 · 🟢 · Effort S — No structural gate for future admin writes

[admin/lib.ts](convex/admin/lib.ts) provides `adminQuery` so admin **reads** can't forget the
auth check. All current admin writes are `internalMutation` (safe), but the first
dashboard-triggered public mutation someone adds has no forget-proof equivalent. Add
`adminMutation`/`adminAction` builders mirroring `adminQuery` — ~20 lines each, cheap insurance.

### B-8 · 🟢 · Effort S — Minor hot-path and posture notes

- `sendMessage` re-reads up to 200 messages per send just to count user messages against `THREAD_MESSAGE_LIMIT` ([chat/messages.ts:182-191](convex/features/chat/messages.ts#L182-L191)) — a per-thread counter removes the scan.
- TTS retries re-enqueue at priority 0, demoting foreground cards ([ttsProcessing.ts:318-340](convex/features/ttsProcessing.ts#L318-L340)) — explicitly documented as an accepted tradeoff; pass `priority` through the retry args if the tail latency ever shows up in support tickets.
- `identity.subject` is the global user/customer key ([db/users.ts:15](convex/db/users.ts#L15), [billing.ts:87](convex/billing.ts#L87), [autumn.ts:81](convex/autumn.ts#L81)) — internally consistent and documented in schema comments, but it deviates from the Convex guideline (`tokenIdentifier`) and becomes a real risk only if a second auth issuer is ever added. Note-level.
- `getPlacementSentence` ([placementTest.ts:36](convex/features/placementTest.ts#L36)) is callable unauthenticated and mints signed storage URLs. It's shared curriculum content, so low severity — add `getAuthUserId` anyway (every caller is authenticated) to close the anonymous-scrape hole.

---

## Code quality & hygiene

### Q-1 · 🟡 · Effort S — Dependency cleanup (all verified)

- **Both lockfiles committed**: `package-lock.json` (952 KB) *and* `pnpm-lock.yaml` (635 KB). README says pnpm — delete `package-lock.json` and add it to `.gitignore` before the two drift.
- **`"i": "^0.3.7"`** ([package.json:112](package.json#L112)) — the classic errant `npm i` typo package; zero imports anywhere. Remove.
- **`soundtouch-ts`** ([package.json:135](package.json#L135)) — never imported; only `soundtouchjs` is used ([lib/audio/timeStretch.ts:2](lib/audio/timeStretch.ts#L2)). Remove.
- **`radix-ui` meta-package** ([package.json:124](package.json#L124)) — never imported; all usage goes through the individual `@radix-ui/react-*` packages. Remove.

### Q-2 · 🟡 · Effort S/M — ESLint safety rails are loosened

[eslint.config.mjs:64-69](eslint.config.mjs#L64-L69): `react-hooks/purity`,
`react-hooks/set-state-in-effect`, and `react-hooks/refs` are **off**, and
`@typescript-eslint/no-explicit-any` / `no-unused-vars` are warn-only. For a codebase with this
much intricate hook code (F-2/F-3/F-7 above are exactly the bug class these rules catch), the
React 19 hooks rules are worth re-enabling — do it one rule at a time with targeted
`eslint-disable` comments where the existing code is deliberately impure, so new code gets the
protection.

### Q-3 · 🟢 · Effort ongoing — File-size ceiling

Giants that have crossed the maintainability line:
[decks.ts](convex/features/decks.ts) · [scheduling.ts](convex/features/scheduling.ts) ·
[languages.ts](lib/languages.ts) · [useLearningMode.ts](components/app/learning/useLearningMode.ts)
(7 queries + 16 mutations in one hook — split into `useReviewSession`, `useCardActions`,
`useReviewSettings`) · [LearningModeSettings.tsx](components/app/LearningModeSettings.tsx) ·
[onboarding/page.tsx](app/app/onboarding/page.tsx). No single one is urgent; adopt a
"split when touched" rule rather than a big-bang refactor.

### Q-4 · 🟢 · Effort S — TypeScript strictness headroom

`strict: true` is on, but `noUncheckedIndexedAccess` is not — the codebase indexes into
per-language `Record`s and arrays constantly (translations, voices, language maps), which is
exactly where it pays for itself. Expect a burst of fixes when enabling; worth it next time
there's slack.

---

## Appendix — candidates dropped or corrected during verification

| Candidate (from exploration) | Verdict |
|---|---|
| "~140 `console.log` debug calls in production code" | **Wrong.** Frontend has 2 `console.log`s, both commented out. The 49 calls in `components/` are intentional `console.error`s → reframed as U-2 (no reporting sink). |
| "`StepperImportView` is dead prototype code" | **Wrong.** It *is* the shipped import view ([ImportTextsView.tsx:10](components/app/import-texts/ImportTextsView.tsx#L10)) → reframed as U-5 (misleading folder name). |
| "`SimplifiedChatView` duplicates `components/chat/`" | **Wrong.** It composes `ChatPanel`/`ChatHistorySidebar` from `components/chat/` — a wrapper, not a fork. Dropped. |
| "Stray `@useautumn-sdk.d.ts` at repo root" | **Wrong.** Auto-generated by `atmn pull` (header says so). Dropped. |
| "Audio pipeline entirely on the main thread" | **Partial.** `OfflineAudioContext` renders off-thread; the main-thread parts are the soundtouch stretch, WAV encode, and the 60 fps setState loop → F-3 narrowed accordingly. |
| "`useEnsureContent` fires mutations from render effects (anti-pattern)" | **Intentional.** Access-triggered self-heal is the project's documented recovery design; the module-level `Set` is a reasonable dedupe. Dropped. |
| "`courseStats` patched twice on every review" | **Partial.** Second patch only fires when new words are tracked (mostly first reviews) → folded into B-2 as the S-sized first step. |
| "Hidden tabs stay mounted forever" | **Partial.** Opening chat/learn resets the visit flags; the always-mounted case is `SettingsView` and tab-to-tab switching → F-2 narrowed accordingly. |
| Landing demo components mirroring app learning components | **True but deliberate** — marketing demos are decoupled from product code on purpose; unifying them would couple the landing page to review-engine refactors. Not listed as a finding. |
