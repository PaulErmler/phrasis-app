# React-hooks lint debt — inventory and re-enable plan

Written 2026-08-26 as groundwork for a later cleanup pass (deliberately deferred;
see `docs/tech-debt.md`). `eslint.config.mjs` globally disables three react-hooks
correctness rules; this documents why, where the violations live, and the staged
path to turning the rules back on. Counts are approximate and drift — re-grep
before starting.

## What is disabled and why

```js
'react-hooks/purity': 'off',
'react-hooks/set-state-in-effect': 'off',
'react-hooks/refs': 'off',
```

They were disabled wholesale because the learning stack predates the rules and
violates them at scale; enabling any of them today produces hundreds of findings.

## `react-hooks/refs` (~120 sites) — the cheap one

Almost all violations are one idiom: the hand-rolled "latest callback/value" ref,
written directly during render (`ref.current = value` in the component body).
Heaviest files (count of `.current =` assignments, many render-time):

- `hooks/use-audio-player.ts` (~37)
- `components/app/learning/useLearningMode.ts` (~37)
- `components/app/learning/FullReviewCardContent.tsx` (~23)
- `lib/tutorials/use-milestone-tips.ts` (~22)
- `components/app/BillingGate.tsx` (~7)

**Plan:** add one `useLatest<T>(value)` hook (write inside `useEffect`/insertion
effect, read via `.current`), mechanically convert the latest-callback sites,
leave genuinely-in-effect writes alone, then flip `react-hooks/refs` to `warn`
(later `error`). Smallest surface, do it first.

## `react-hooks/set-state-in-effect` (~50 real sites) — the expensive one

Recurring shapes, with canonical fixes:

1. **Mirror a query field into state** (e.g. `useLearningMode` copying a server
   value into `useState` inside an effect) → derive during render, or
   `useState`-with-key-reset.
2. **Reset N states when an id changes** (card change resets five slices) →
   remount the subtree with a `key={cardId}` instead of effect-resets.
3. **"Recovery" effects deriving state from other state** → compute the derived
   value during render; state should hold only what can't be derived.
4. **Write-back loops with manual guards** (LibraryView order sync) → lift to a
   reducer or derive; the loop guard is the smell.

~70 files pair `useEffect` with a `setX(` call (upper bound; many are legitimate
subscriptions). The 16 `react-hooks/exhaustive-deps` suppressions are adjacent
debt: most carry load-bearing rationales — keep the comments, but each one is a
candidate for restructuring while its file is open.

**Plan:** convert file-by-file starting with the worst clusters
(`useLearningMode`, `LibraryView`, `FullReviewCardContent`), then enable the rule
as `warn` so new code is flagged while the tail burns down.

## `react-hooks/purity`

~12 component files call `Math.random()`/`Date.now()`/`new Date()` in render
position. Fix by hoisting into event handlers, `useMemo` with explicit inputs, or
props (the workload forecast already threads a minute-quantized `now` — follow
that pattern). Enable last; verify against the react-compiler expectations since
`react-hooks/purity` is what unlocks compiling those files.

## Order of operations

1. `useLatest` + refs conversion → `react-hooks/refs: 'warn'`
2. set-state-in-effect worst-three files → rule to `warn`
3. purity hoists → rule to `warn`
4. Promote all three to `error` once counts hit zero; delete this file.
