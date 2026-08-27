import { defineApp } from 'convex/server';
import { v } from 'convex/values';
import posthog from '@posthog/convex/convex.config.js';
import betterAuth from '@convex-dev/better-auth/convex.config';
import agent from '@convex-dev/agent/convex.config';
import autumn from '@useautumn/convex/convex.config';
import aggregate from '@convex-dev/aggregate/convex.config';
import actionRetrier from '@convex-dev/action-retrier/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import workpool from '@convex-dev/workpool/convex.config';
import migrations from '@convex-dev/migrations/convex.config';
import resend from '@convex-dev/resend/convex.config';

/**
 * Every app-provided environment variable read anywhere under convex/ is
 * declared here (platform vars CONVEX_SITE_URL / CONVEX_CLOUD_URL are
 * provided automatically and must NOT be declared). Function code reads
 * these through the typed accessors in `convex/lib/env.ts`, whose allowed
 * names derive from this object — an undeclared name is a type error.
 *
 * All app vars are declared optional so a deploy never blocks on one being
 * set; each call site decides whether a missing key throws (requireEnv) or
 * degrades (optionalEnv). POSTHOG_PROJECT_TOKEN stays required because the
 * posthog component below is bound to it by reference.
 */
const app = defineApp({
  env: {
    POSTHOG_PROJECT_TOKEN: v.string(),
    POSTHOG_HOST: v.optional(v.string()),
    // Better Auth (convex/auth.ts)
    SITE_URL: v.optional(v.string()),
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    APPLE_CLIENT_ID: v.optional(v.string()),
    APPLE_TEAM_ID: v.optional(v.string()),
    APPLE_KEY_ID: v.optional(v.string()),
    APPLE_PRIVATE_KEY: v.optional(v.string()),
    APPLE_APP_BUNDLE_IDENTIFIER: v.optional(v.string()),
    // Billing (convex/autumn.ts, convex/usage/*)
    AUTUMN_SECRET_KEY: v.optional(v.string()),
    // Read-only restricted key (Invoices, Charges, Balance transactions:
    // read) for the daily payment reconciliation sweep
    // (convex/features/paymentSync.ts). Unset = the sweep no-ops.
    STRIPE_SECRET_KEY: v.optional(v.string()),
    // Convex account token for the daily infra-cost sweep
    // (convex/features/infraCostSync.ts): a team access token if the
    // dashboard billing endpoints accept it, else the CLI login token.
    // Unset = the sweep no-ops and the dashboards fall back to the
    // base-fee estimate.
    CONVEX_BILLING_TOKEN: v.optional(v.string()),
    // Numeric Convex team id for the same sweep. Optional: when unset the
    // sweep tries to resolve it from the token via the Management API.
    CONVEX_TEAM_ID: v.optional(v.string()),
    // LLM + TTS via OpenRouter (convex/lib/openrouter.ts, convex/lib/tts/*)
    OPENROUTER_API_KEY: v.optional(v.string()),
    // Google Cloud translation / romanization / TTS
    GOOGLE_TRANSLATE_API_KEY: v.optional(v.string()),
    GOOGLE_SERVICE_ACCOUNT_KEY: v.optional(v.string()),
    GOOGLE_TTS_API_KEY: v.optional(v.string()),
    // Azure Speech-to-Text (convex/lib/stt/azure.ts)
    AZURE_SPEECH_API_KEY: v.optional(v.string()),
    AZURE_SPEECH_REGION: v.optional(v.string()),
    // Non-prod email labeling (convex/lib/emailEnv.ts)
    EMAIL_ENV: v.optional(v.string()),
    // Ops flags (read as raw process.env where noted at the call site)
    FF_NEW_COURSE_CUTOVER: v.optional(v.string()),
    E2E_TEST_HOOKS: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(agent);
app.use(autumn);
app.use(aggregate, { name: 'cardsByStateAndDueDate' });
app.use(aggregate, { name: 'cardsByOriginStateAndDueDate' });
// Writing-track mirrors of the two due-count aggregates, keyed on
// cards.writingDueDate. Only cards with a seeded writing track (courses with
// separateModeTracking on) are inserted, so courses without the split pay no
// extra aggregate writes.
app.use(aggregate, { name: 'cardsByWritingStateAndDueDate' });
app.use(aggregate, { name: 'cardsByOriginWritingStateAndDueDate' });
// Mature (Review-state) cards by stability bucket, keyed on dueDate. Feeds
// the workload forecast's observed stability mix (see
// db/stats/cardAggregates.ts). Members are Review-state cards only, so the
// write cost lands on mature reviews / lapses / graduations, never on
// same-day learning loops.
app.use(aggregate, { name: 'cardsByStabilityBucketAndDueDate' });
app.use(actionRetrier);
app.use(rateLimiter);
// Content-generation pools (LLM translation / TTS synthesis). Separate
// instances because each pool needs its own parallelism cap.
app.use(workpool, { name: 'llmPool' });
// Background LLM translation warms (llmPriority 'background'): low-parallelism
// sibling of llmPool so a manually fired warmup run can't queue thousands of
// jobs ahead of the translation a user is waiting on. See convex/lib/workpools.ts.
app.use(workpool, { name: 'llmWarmPool' });
app.use(workpool, { name: 'ttsPool' });
// Background TTS warms (priority 'background'): low-parallelism sibling of
// ttsPool so signup-time warm bursts can't queue ahead of the audio a user
// is looking at. See convex/lib/workpools.ts.
app.use(workpool, { name: 'ttsWarmPool' });
// Background data sweeps (currently the separateModeTracking writing-track
// seed). Its own instance so bulk backfill can never queue ahead of, or steal
// slots from, the user-facing content pools.
app.use(workpool, { name: 'seedPool' });
// Batched, resumable data migrations. Chained after every deploy via
// `npx convex run migrations:runAll --prod` (completed ones are skipped).
app.use(migrations);
// Transactional email (account-deletion requests to support@). Needs
// RESEND_API_KEY in the deployment env.
app.use(resend);
/**
 * Server-side analytics, cost events and exception capture.
 *
 * `POSTHOG_PERSONAL_API_KEY` is deliberately NOT forwarded: setting it turns on
 * local feature-flag evaluation, which makes the component poll PostHog for
 * flag definitions in a background refresh loop. Pointless load while nothing
 * here uses flags. If they're ever wanted, either forward the key or use the
 * action-only remote `evaluateFlag` path, which works without it.
 */
app.use(posthog, {
  env: {
    POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN,
    POSTHOG_HOST: app.env.POSTHOG_HOST,
  },
});

export default app;
