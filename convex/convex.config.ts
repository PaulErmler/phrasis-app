import { defineApp } from 'convex/server';
import betterAuth from '@convex-dev/better-auth/convex.config';
import agent from '@convex-dev/agent/convex.config';
import autumn from "@useautumn/convex/convex.config";
import aggregate from '@convex-dev/aggregate/convex.config';
import actionRetrier from '@convex-dev/action-retrier/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import workpool from '@convex-dev/workpool/convex.config';

const app = defineApp();
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

export default app;
