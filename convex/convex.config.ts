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
app.use(actionRetrier);
app.use(rateLimiter);
// Content-generation pools (LLM translation / TTS synthesis). Separate
// instances because each pool needs its own parallelism cap.
app.use(workpool, { name: 'llmPool' });
app.use(workpool, { name: 'ttsPool' });
// Batched, resumable data migrations. Chained after every deploy via
// `npx convex run migrations:runAll --prod` (completed ones are skipped).
app.use(migrations);
/**
 * Server-side analytics, cost events and exception capture.
 *
 * `POSTHOG_PERSONAL_API_KEY` is deliberately NOT forwarded: setting it turns on
 * local feature-flag evaluation, which makes the component run its own internal
 * cron to refresh flag definitions. This project is cron-free by design, and
 * nothing here needs flags. If they're ever wanted, the action-only remote
 * `evaluateFlag` path works without the key and without a cron.
 */
app.use(posthog, {
  env: {
    POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN,
    POSTHOG_HOST: app.env.POSTHOG_HOST,
  },
});

export default app;
