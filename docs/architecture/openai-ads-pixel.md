# OpenAI Ads pixel

Conversion measurement for ChatGPT ad campaigns. The pixel (`oaiq`) matches
conversions on flexling.com back to the ad click via the `oppref` query
parameter OpenAI appends to the landing URL. It is a second, narrow reporter
next to PostHog, not a replacement: PostHog stays the analytics source of
truth, the pixel gets three conversion events and nothing else.

Docs: https://developers.openai.com/ads/measurement-pixel

## Setup

`NEXT_PUBLIC_OPENAI_PIXEL_ID` — the pixel id from the OpenAI ads manager
(public, ships in the bundle). Same rules as `NEXT_PUBLIC_POSTHOG_KEY`: a
**build-time** argument on Coolify, absent in local dev and CI, where every
pixel call is a no-op. Set it on production only; staging traffic should not
pollute campaign reporting.

Landing page query parameters to set in the ads manager (see the PostHog
"Ad campaigns" dashboard for how they are read):

```
utm_source=openai&utm_medium=paid_social&utm_campaign={campaign_id}&utm_content={ad_id}&utm_term={ad_group_id}
```

The pixel reads `oppref` itself; OpenAI appends it, do not add it by hand.

## Files

| File                                              | Role                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `lib/openai-pixel.ts`                             | Loader, consent sync, `measureConversion`, device-side dedupe + checkout marker |
| `components/analytics/OpenAIPixel.tsx`            | Root layout. Loads the SDK on consent grant, revokes on deny                    |
| `components/analytics/OpenAIPixelConversions.tsx` | `/app` layout. Fires the conversion events                                      |
| `hooks/use-new-plan-checkout.ts`                  | Leaves the checkout marker before the Stripe redirect                           |
| `components/autumn/checkout-dialog.tsx`           | Same marker on the trial-switch redirect (paywall / low-quota / pricing table)  |

## Consent

Nothing loads until the PostHog consent status is `granted`. The SDK was
checked (2026-09-01 bundle) and it fetches its matching config from
`bzrcdn.openai.com` on `init` regardless of its own consent flag, so
"inject early with consent=false" would still contact OpenAI from the
visitor's browser. Loading only on grant is what keeps the privacy policy's
"nothing without consent" claim true.

Known cost: the SDK reads `oppref` from the URL at init. A visitor who accepts
the banner on a later page than the one the ad landed on has lost the click id
and is unattributed. Most consent decisions happen on the landing page, and
PostHog's session-level UTM attribution is unaffected either way.

On revoke the SDK deletes its own cookies (`__oppref`, `__obref`,
`__oaiq_consent`, localStorage `oaiq_consent`) and this module sweeps every
`flexling_oaiq_*` localStorage key.

Skipped entirely in the Capacitor store shell (`useIsNativeApp()`).

## Events

| Event                    | When                                                                       | Dedupe `event_id`                |
| ------------------------ | -------------------------------------------------------------------------- | -------------------------------- |
| `registration_completed` | Signed-in account created < 24 h ago                                       | `registration:<userId>`          |
| `subscription_created`   | Paid, non-trialing Autumn plan present **and** a checkout marker < 2 h old | `subscription:<userId>:<planId>` |
| `trial_started`          | Same, plan is trialing                                                     | `trial:<userId>:<planId>`        |

Reading the account rather than hooking the signup form covers email+OTP,
Google and Apple alike. The checkout marker is the only way to tell a plan
bought just now from one a long-time subscriber already had: Stripe checkout
is a redirect, so the customer returns as a fresh page load with no in-memory
history. Without the marker, the first app open after deploy would have
reported every existing paying customer as a conversion.

Each `event_id` is stored on the device so a conversion fires once per browser,
and passed to the pixel so OpenAI collapses duplicates across devices and,
later, against server-sent events.

## Not done (follow-ups)

- **Revenue.** `subscription_created` carries `plan_id` but no `amount` /
  `currency`: the client does not know the charged price. The server does
  (`payment_recorded`, `convex/features/paymentSync.ts`). OpenAI's
  Conversions API with the same `event_id` is the clean way to add it.
- **`checkout_started`** at the redirect, and **`page_viewed`** on the landing
  pages. Neither is needed for signup/subscription optimization.
- **Webhook lag.** If Autumn has not attached the plan when the customer
  returns from Stripe, the marker is kept and retried on the next customer
  refresh, which in practice is the next app open within 2 h.
- **Privacy policy.** Done 2026-09-01 in `content/legal/{en,de}/privacy.md`:
  §4.4 consent bullet, §5C intro + a dedicated "OpenAI – Advertising
  conversion measurement" entry and table row, §7 "Advertising conversion
  cookies" paragraph (the former "we do not use marketing or advertising
  cookies" sentence is gone). Keep these in sync if the events or storage
  keys change.

## Verification

1. Build with the pixel id set, accept the banner, open devtools → Network:
   `oaiq.min.js` loads only after the accept click.
2. `window.oaiq.q` (before the script arrives) starts with `['consent', true]`
   then `['init', …]`.
3. The OpenAI Ads Pixel Helper Chrome extension shows `registration_completed`
   on the first `/app` load after signup.
4. Decline in Cookie settings: the `__oppref` / `__obref` cookies disappear.
