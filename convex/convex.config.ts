import { defineApp } from 'convex/server';
import betterAuth from '@convex-dev/better-auth/convex.config';
import agent from '@convex-dev/agent/convex.config';
import autumn from "@useautumn/convex/convex.config";
import aggregate from '@convex-dev/aggregate/convex.config';
import actionRetrier from '@convex-dev/action-retrier/convex.config';

const app = defineApp();
app.use(betterAuth);
app.use(agent);
app.use(autumn);
app.use(aggregate, { name: 'cardsByState' });
app.use(aggregate, { name: 'cardsByDueDate' });
app.use(aggregate, { name: 'cardsByStateAndDueDate' });
app.use(actionRetrier);

export default app;
