/**
 * Scheduled jobs.
 *
 * This is the app's first cron — everything else deferred in this codebase is a
 * one-shot `ctx.scheduler.runAfter` chained off a user action (welcome email,
 * signup notification, content generation). A daily reminder has no triggering
 * user action, which is what makes a recurring sweep necessary.
 */

import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

/**
 * Deliver daily reminders whose send time has arrived.
 *
 * 15 minutes matches the granularity the settings picker offers, so the UI
 * never promises precision the sweep cannot keep: a reminder set for 08:00
 * fires in the tick at or just after 08:00, never more than the interval late.
 * The sweep itself is cheap — an indexed range read over users who are due, not
 * a scan — and self-continues when a batch fills, so the interval bounds
 * latency rather than throughput.
 */
crons.interval(
  'daily reminder sweep',
  { minutes: 15 },
  internal.features.notifications.sweep,
  {},
);

export default crons;
