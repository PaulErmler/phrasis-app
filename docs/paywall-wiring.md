# Paywall & quota wiring — current state and unification plan

Written 2026-08-26 as groundwork for a later unification pass (deliberately deferred;
see `docs/tech-debt.md`). Counts and line references drift — anchor on the symbols.

## The mechanism

Feature gating has three layers:

1. **Server**: mutations/actions consume Autumn quota and throw a structured
   `ConvexError({ code: 'USAGE_LIMIT', ... })` when a balance is spent
   (`convex/usage/helpers.ts` owns the error contract; `quotaErrorCode` reads it).
2. **Client detection**: callers catch the error and check
   `convexErrorCode(error) === 'USAGE_LIMIT'` (helper in `lib/utils.ts`).
3. **Client response**: open an upgrade surface — `PaywallDialog`
   (`components/autumn/paywall-dialog.tsx`) or `UsageLimitDialog`
   (`components/autumn/usage-limit-dialog.tsx`) — with the right `featureId` from
   `convex/features/featureIds.ts`.

Two shared hooks already package this (`components/feature_tracking/useFeatureLock.tsx`):

- **`useFeatureLock(featureId)`** — quota-aware lock for a control (knows
  `locked` state up front via `useFeatureQuota`, opens the dialog on demand).
  Adopted by: `VoiceRecordButton`, `WritingVoiceButton`, `WritingFeedbackCard`,
  `FullReviewCardContent`.
- **`useLimitDialog(featureId)`** — dialog-only variant for after-the-fact
  USAGE_LIMIT errors. Adopted by the writing-feedback coach card and make-default.

## Hand-rolled sites (the debt)

Each of these re-implements some of: `useState(false)` for dialog open, the
`USAGE_LIMIT` catch, and its own `<PaywallDialog|UsageLimitDialog … featureId=…>`:

| Site | What it gates | Shape |
| --- | --- | --- |
| `components/app/EnterTextsView.tsx` (two catches) | custom texts | catch → `setPaywallOpen` |
| `components/app/CourseMenu.tsx` | courses | pre-check + catch → paywall |
| `components/course/CreateCourseDialog.tsx` | courses | catch, retry-dead-end comment |
| `components/app/segmented/SegmentedHomeSection.tsx` (two clusters) | cards | pre-check + catch |
| `components/app/import-texts/useImportController.ts` + `ImportTextsView.tsx` | imports | catch in controller, dialog in view |
| `components/app/learning/EditCardDialog.tsx` | card edits | catch → UsageLimitDialog |
| `components/app/useCollectionDetail.ts` (two flows) | cards | catch → code returned to caller |
| `components/chat/HomeChatInput.tsx` | chat | catch → paywall |
| `hooks/use-send-message.ts` | chat | switch on code |
| `hooks/use-voice-recording.ts` | transcription | catch → toast (no paywall!) |
| `hooks/use-card-approvals.ts` | card edits | rollback + paywall signal |
| `components/chat/AlsoCorrectApproval.tsx` / `CardApproval.tsx` / `ChatPanel.tsx` | card edits | dialog per component |
| `app/app/onboarding/page.tsx` | onboarding finish | catch, must stay visible |

Also related: `FeatureBadge` / `FeatureGatedButton` (feature_tracking) render lock
affordances with their own quota reads.

## Unification recipe (for the future pass)

1. Extend `useLimitDialog` so it returns a `catchUsageLimit(err, opts?)` helper
   (returns true when handled) — the catch-and-open dance becomes one line; keep
   the rethrow behavior optional per site (some flows must also reset local state).
2. Migrate sites top-down by feature: courses (CourseMenu + CreateCourseDialog),
   texts (EnterTextsView), imports (useImportController/ImportTextsView), cards
   (SegmentedHomeSection, useCollectionDetail), chat (HomeChatInput,
   use-send-message).
3. Decide the odd ones deliberately: `use-voice-recording` currently toasts instead
   of paywalling (probably wrong — same quota as the mic buttons that DO paywall);
   `useCollectionDetail` returns codes to its caller (keep, it's a hook layering
   choice, but route the caller through the shared hook).
4. Keep dialog choice (`PaywallDialog` vs `UsageLimitDialog`) a per-feature
   constant in one map next to `FEATURE_IDS`, so surfaces stop deciding ad hoc.
5. After migration, grep `USAGE_LIMIT` outside `feature_tracking/`+`lib/utils.ts`;
   the remaining hits should only be comments and the server side.
