import { defineApp } from 'convex/server';
import { v } from 'convex/values';
import posthog from '@posthog/convex/convex.config.js';
import betterAuth from '@convex-dev/better-auth/convex.config';
import agent from '@convex-dev/agent/convex.config';
import autumn from "@useautumn/convex/convex.config";
import aggregate from '@convex-dev/aggregate/convex.config';
import actionRetrier from '@convex-dev/action-retrier/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import workpool from '@convex-dev/workpool/convex.config';
import migrations from '@convex-dev/migrations/convex.config';
import resend from '@convex-dev/resend/convex.config';

const app = defineApp({
  env: {
    POSTHOG_PROJECT_TOKEN: v.string(),
    POSTHOG_HOST: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(agent);
app.use(autumn);
app.use(aggregate, { name: 'cardsByState' });
app.use(aggregate, { name: 'cardsByDueDate' });
app.use(aggregate, { name: 'cardsByStateAndDueDate' });
app.use(aggregate, { name: 'cardsByOriginStateAndDueDate' });
app.use(actionRetrier);
app.use(rateLimiter);
// Content-generation pools (LLM translation / TTS synthesis). Separate
// instances because each pool needs its own parallelism cap.
app.use(workpool, { name: 'llmPool' });
app.use(workpool, { name: 'ttsPool' });
// Daily reminder push fan-out (features/notifications.ts). Separate pool so a
// backlog of content generation can't delay time-sensitive reminders, and so
// its no-retry policy stays isolated from the content pools' aggressive one.
app.use(workpool, { name: 'reminderPool' });
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
 * flag definitions in a background refresh loop — pointless load while nothing
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
