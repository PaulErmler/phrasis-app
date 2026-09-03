# PostHog integration

Product analytics, session replay, error tracking, and AI cost attribution, all from one
vendor, one identity, one consent gate. EU Cloud (Frankfurt).

## Projects

| Environment | Project ID | Used by |
|---|---|---|
| development | `234370` | local `pnpm dev`, Convex dev deployment, CI builds |
| staging | `234379` | Coolify staging build + its Convex deployment |
| production | `234368` | Coolify production build, Convex prod deployment |

Project tokens (`phc_…`) are **public** client-side identifiers. They ship in the
browser bundle. `POSTHOG_API_KEY` (personal, source-map upload) is the only secret.

## Required setup

### 1. Enable cookieless mode in each PostHog project

**Blocking.** `lib/posthog/client.ts` runs with `cookieless_mode: 'on_reject'` +
`opt_out_capturing_by_default: true`, and PostHog **silently discards every
cookieless event** unless the project also has cookieless mode enabled in its
settings. Without this, users who decline, plus everyone who hasn't answered
the banner yet since pending is captured cookieless too, produce no data at
all rather than anonymous data.

### 2. Enable the Convex dashboard integrations (Pro)

Deployment Settings → Integrations, **per deployment**:

- **PostHog Error Tracking.** Every uncaught Convex exception, with stack trace,
  function name, request id, and authenticated user identity. No code required.
- **PostHog Log Streams.** 14-day triage buffer (see retention below).

Set the **Host** field to `https://eu.i.posthog.com`. It defaults to US Cloud, and
a valid EU token against the US endpoint is rejected as *unauthorized*, and that is
the single most likely reason this step fails.

### 3. Environment variables

`NEXT_PUBLIC_*` are inlined at build time. On Coolify they must be **build
arguments**, not runtime variables, or they resolve to `undefined` in the shipped
bundle and analytics silently no-op.

| Where | Variables |
|---|---|
| Coolify production (build args) | `NEXT_PUBLIC_POSTHOG_KEY` (prod token) · `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com` · `POSTHOG_PROJECT_ID=234368` · `POSTHOG_API_KEY` (secret) |
| Coolify staging (build args) | same shape, staging token, `POSTHOG_PROJECT_ID=234379` |
| Convex prod | `npx convex env set POSTHOG_PROJECT_TOKEN <prod token> --prod`<br>`npx convex env set POSTHOG_HOST https://eu.i.posthog.com --prod` |
| Convex dev | same with the development token |
| GitHub Actions secrets | `NEXT_PUBLIC_POSTHOG_KEY` (dev token), `NEXT_PUBLIC_POSTHOG_HOST` |
| `.env.local` | `POSTHOG_API_KEY`, plus the development token + host for local dev |

`POSTHOG_PROJECT_TOKEN` is a **required** Convex component env var. `convex dev`
and `convex deploy` fail without it. Everything else degrades gracefully: a build
with no `NEXT_PUBLIC_POSTHOG_KEY` simply never initializes PostHog.

`POSTHOG_PERSONAL_API_KEY` is deliberately **not** set. It would enable local
feature-flag evaluation, which makes the component poll PostHog for flag
definitions in a background refresh loop, which is pointless load while nothing uses
flags. Flags, if ever needed, work through the action-only remote
`evaluateFlag` path with no key, or by setting the key to get local evaluation.

### 4. Enable session replay

PostHog project settings → Session Replay. Start at 100% sampling on production;
leave staging/development off so dev traffic doesn't burn the 5k free recordings.

## Architecture

```
Browser ──► /ph-relay/* (Next rewrite, first-party, ad-blocker proof)
   │              └─► eu.i.posthog.com
   │  autocapture · pageviews · session replay · captureException · product events
   │
Next server ──► instrumentation.ts onRequestError ──► posthog-node captureException
   │            @posthog/nextjs-config uploads source maps at build
   │
Convex ──► @posthog/convex ──► capture / identify / captureException / $ai_generation
   └──► Convex dashboard destinations (Pro, zero code)
```

**The invariant:** `distinctId` is always the Better Auth user id, i.e. `identity.subject`
on the server (`requireAuthUserId`), `user._id` on the client. It is also the Autumn
customer id. Deviating fragments one person into two ghosts that never meet.

### Files

| File | Role |
|---|---|
| `lib/posthog/hosts.ts` | Dependency-free constants, shared with `next.config.ts` |
| `lib/posthog/client.ts` | Browser SDK init + masking attributes |
| `lib/posthog/consent.ts` | Consent state machine over PostHog's own consent API |
| `lib/posthog/events.ts` | Client event names + `capture()` |
| `lib/posthog/server.ts` | `posthog-node` singleton for the Next server |
| `lib/report-error.ts` | `reportError`, the console.error replacement |
| `convex/posthog.ts` | Server SDK instance |
| `convex/analytics.ts` | Backend event names + `track` / `identifyUser` / `trackException` |
| `convex/features/consent.ts` | `setAnalyticsConsent`, account mirror of the browser choice |
| `convex/lib/posthogAi.ts` | `$ai_generation` cost events |
| `convex/config/aiCosts.ts` | Rate table for providers PostHog can't price |
| `components/consent/*` | Banner, settings dialog, footer link |
| `components/analytics/*` | Provider, identify, consent sync, replay suspension |

## Consent

The OpenAI Ads pixel piggybacks on this consent record; see
`docs/architecture/openai-ads-pixel.md`.

There is no CMP dependency. c15t (5 packages) was removed along with ~96 lines of
`!important` CSS overrides in `globals.css`. After this change PostHog is the only
non-essential storage in the app, and PostHog's own consent primitives cover it.

- **Before a choice:** cookieless capture (`opt_out_capturing_by_default: true`
  makes the SDK treat pending like reject). Nothing is written to or read from
  the device, the banner stays up, and landing/onboarding funnels include the
  people who ignore it. Without the flag the SDK silently *drops* every event
  until a choice is made.
- **Accept:** cookies + localStorage, `identify()`, session replay.
- **Reject:** cookieless mode. Events still flow under a daily-rotated server-side
  hash, outside TTDSG § 25 entirely, so funnels and error rates stay measurable
  for people who decline. No replay, no cross-session identity. The only device
  write is the choice itself (`__ph_opt_in_out_*`, § 25(2)-exempt).

**Legal bases are split** (privacy policy §§ 4.4, 5C, 6): storage-free
measurement and backend usage/cost/error telemetry run under legitimate
interest (Art. 6(1)(f)); cookies, session replay, and AI chat *content* require
consent (Art. 6(1)(a) + § 25(1) TTDSG).

**The backend honors the choice for content.** `ConsentSync` mirrors the
browser's decision into `userSettings.analyticsConsent`
(`convex/features/consent.setAnalyticsConsent`); `sendMessage` reads it and the
chat `$ai_generation` events attach `$ai_input`/`$ai_output_choices` only when
it is `true`. Unset counts as declined, so a lost sync can only withhold
content, never leak it. Tokens, cost and latency flow regardless, and that is the
legitimate-interest half.

Withdrawal is the **Cookie settings** link in the footer, which the privacy policy
has promised since March and which nothing implemented until now.

E2E dismisses the banner via `data-testid="consent-accept"` (locale-proof; the copy
is translated en/de).

## Event taxonomy

**Granularity rule: nothing fires per card review.** A user doing 100 reviews/day is
3,000 events/month on their own; at 1,000 MAU that is 3M events before anything
else. The app already records per-review detail far better in `dailyStats`,
`courseStats`, `reviewDepthAccuracy` and the card aggregates. Reviews are reported
at session level. This single decision is what keeps the bill in the tens rather
than the thousands of dollars.

**Server vs client.** Backend for anything that must not be lost (a `capture` inside
a mutation runs in the transaction the backend already committed). Client for
intent, navigation, and, most importantly, **anything that happens on a failed
mutation**: a Convex mutation that throws rolls back everything it scheduled,
including its own analytics event. `quota_exhausted` and `chat_message_failed` can
therefore only be captured client-side.

## AI cost attribution

Every provider call emits `$ai_generation`. PostHog prices OpenRouter calls itself
from OpenRouter's pricing table; for Google TTS, Google Translate and Azure STT we
compute `$ai_total_cost_usd` from `convex/config/aiCosts.ts`.

| Feature | Provider | Cost source |
|---|---|---|
| `chat` | OpenRouter | exact USD from usage accounting, per step |
| `chat_title` | OpenRouter | exact USD |
| `translation` | OpenRouter | exact USD, **per stage attempt including failures** |
| `translation_autofill` | OpenRouter | exact USD |
| `sentence_metadata` | OpenRouter | exact USD |
| `tts_validation_judge` | OpenRouter | exact USD |
| `tts_synthesis` | Google | characters × rate |
| `tts_synthesis` | Gemini/OpenRouter | ⚠️ volume only, no USD, see below |
| `tts_validation_stt` | Azure | billed audio duration × rate |
| `chat_voice_input` | Azure | billed audio duration × rate |
| `machine_translation` | Google | characters × rate |

### Attribution policy

Content is shared by design. A translation generated for user A is reused by user
B. Spend is attributed to the **requesting** user and tagged `shared_content: true`.
Per-user cost then reads as "spend this user caused", app-wide totals stay exact,
and the tag separates marginal from amortised cost in a query. Unattributable
background work is bucketed under `system:content-pipeline` rather than dropped,
the money was still spent.

### Known gaps

1. **Gemini TTS has no USD figure.** OpenRouter's `/audio/speech` returns cost only
   via a follow-up lookup on the generation id. The event fires with
   `cost_source: 'unavailable'` so the gap is visible in the dashboard rather than
   appearing as free.
2. **Rate table needs sign-off.** `convex/config/aiCosts.ts` holds hand-transcribed
   list prices with `sourceUrl` + `lastVerified` on each entry. Reconcile against a
   real invoice before making a pricing decision on top of them.
3. **Infrastructure cost is not AI cost.** Convex, Coolify and PostHog's own bills
   are not tracked here.

## Session replay

Masked via `data-ph-mask` (text) and `data-ph-block` (whole element). Masking runs
in the browser, so masked content never reaches PostHog. `maskAllInputs` is on, so
every form field is masked by default.

Explicitly masked: the signed-in user's email in Settings, and the email columns in
both admin views. Replay is **suspended entirely on `/app/admin`**. Those screens
are lists of other people's personal data with no analytical value.

User-authored free text (chat, custom cards, bulk import, Writing-mode answers) is
deliberately **not** masked; it is the substance of the product and the privacy
policy declares it.

Known blind spots, expected rather than broken: no audio in replays (playback uses a
detached `new Audio()` on blob URLs), karaoke rAF churn inflates recording size,
`<pwa-install>` is a shadow-DOM web component, driver.js popovers render outside the
React tree, and `AppUpdateGate`'s `window.location.reload()` splits sessions.

## Retention

| Data | Retention |
|---|---|
| Events (incl. `$ai_generation`) | 1 year free / **7 years paid** |
| Exceptions | same as events, this is the long-term error store |
| Session recordings | 30 days (configurable) |
| Logs (Convex log stream) | **14 days**, triage buffer only |

Anything needed long-term must go through **Error Tracking / `captureException`**,
not the Logs product.

## Verification

1. Clean profile → banner appears; events already flow through `/ph-relay`
   (cookieless, pending state); DevTools shows **no** PostHog cookie or
   localStorage key before a choice.
2. Reject → events keep arriving under a hashed anonymous id; no recording; the
   only storage is the `__ph_opt_in_out_*` choice cookie.
3. Accept via footer → cookie appears, recording starts.
4. Sign in → one PostHog person keyed by the Convex user id, with `plan_id`/
   `plan_status`; a fresh signup also emits `user_signed_up` and the free-plan
   `plan_changed`.
5. Network tab shows `/ph-relay/*` on your own origin, nothing to `posthog.com`.
   Re-test with uBlock Origin on.
6. Walk `/app` tabs and open `/app/learn` → separate `$pageview` events (proves
   `capture_pageview: 'history_change'` handles the raw `pushState` navigation).
7. Send a chat message → `$ai_generation` with non-zero `$ai_total_cost_usd` and the
   prompt/response visible in the LLM analytics trace viewer. Repeat in a
   profile that rejected consent → the event still arrives, **without**
   `$ai_input`/`$ai_output_choices` (the content gate).
8. Add cards from a collection → `$ai_generation` for translation, TTS **and** the
   Azure STT validation pass. Cross-check the sum against the OpenRouter dashboard.
9. Throw a deliberate error client-side and in a Convex mutation → both appear in
   Error Tracking; the client one has an unminified stack trace (proves source maps).
