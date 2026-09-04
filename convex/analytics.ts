import type { Scheduler } from 'convex/server';

import { posthog } from './posthog';

/** Any mutation or action context. The only two that can schedule. */
export type SchedulerCtx = { scheduler: Scheduler };

/**
 * Canonical event names. Kept in one place so a rename is a compile error
 * rather than a silently orphaned funnel in the PostHog UI.
 *
 * Naming: `object_verb_past_tense`, snake_case, no leading `$` (reserved by
 * PostHog for its own events).
 *
 * **Granularity rule.** Nothing in here fires per card review. A user doing 100
 * reviews a day is 3,000 events a month on their own, and the app already
 * records per-review detail far better in `dailyStats` / `courseStats` /
 * `reviewDepthAccuracy`. Reviews are reported at session level; everything else
 * in the product is low-frequency enough to be 1:1.
 */
export const EVENTS = {
  // Account
  USER_SIGNED_UP: 'user_signed_up',
  /** Any plan-identity transition: free-plan attach at signup, upgrade,
   *  cancellation, trial conversion, entering/leaving dunning. The server-side
   *  bookend to the client's `checkout_redirected`. */
  PLAN_CHANGED: 'plan_changed',

  // Learning loop
  CARD_ACTION: 'card_action',
  CARDS_ADDED: 'cards_added',

  // Chat
  CHAT_MESSAGE_SENT: 'chat_message_sent',
  CHAT_CARD_APPROVAL: 'chat_card_approval',
  /** The user asked for a failed tutor reply to be generated again. */
  CHAT_RESPONSE_RETRIED: 'chat_response_retried',
  VOICE_TRANSCRIBED: 'voice_transcribed',
  VOICE_TRANSCRIPTION_FAILED: 'voice_transcription_failed',

  // Courses
  COURSE_CREATED: 'course_created',
  COURSE_ARCHIVED: 'course_archived',
  /** The self-heal in usage/tracking.ts lowered Autumn's `courses` counter
   *  to the number of active courses (ghost slots from the old auto-archive
   *  path). Carries `released` and `active`. */
  COURSE_SLOTS_RECONCILED: 'course_slots_reconciled',

  // Onboarding
  ONBOARDING_COMPLETED: 'onboarding_completed',

  // AI cost. See convex/lib/posthogAi.ts for how a capture picks between
  // these two: `$ai_generation` is PostHog's metered AI-observability event
  // (reserved for the low-volume, per-user conversational features);
  // `ai_cost` is a plain product-analytics event carrying the same fields
  // for the high-volume content-pipeline spend, where the LLM-analytics UI
  // adds nothing but the per-event metering is real money.
  AI_GENERATION: '$ai_generation',
  AI_COST: 'ai_cost',

  // One event per PAID Stripe invoice, with the actual gross / tax /
  // Stripe-fee / net amounts, emitted by the daily reconciliation sweep in
  // convex/features/paymentSync.ts. The revenue side of the margin
  // dashboards; replaces list-price assumptions with what was really paid.
  PAYMENT_RECORDED: 'payment_recorded',

  // Latest Convex invoice total, re-emitted daily by
  // convex/features/infraCostSync.ts. Dashboards read the LATEST value
  // (argMax by timestamp), so the daily re-emission is idempotent by
  // construction and needs no dedup ledger.
  INFRA_COST_RECORDED: 'infra_cost_recorded',
} as const;

/**
 * Deliberately absent, and why, so nobody re-adds them here.
 *
 * `quota_exhausted`, `billing_blocked`, `chat_message_failed`,
 * `onboarding_failed`: every one of these happens on a mutation that *throws*.
 * Convex rolls the transaction back, including the `scheduler.runAfter` a
 * capture enqueues, so the event would be discarded exactly when it matters.
 * They are captured client-side instead, where the ConvexError is caught.
 * See `lib/posthog/events.ts`.
 *
 * `review_session_*`: session boundaries are a UI concept (the learn overlay
 * opening and closing); the backend never sees them. Per-review detail stays in
 * `dailyStats` / `courseStats` / `reviewDepthAccuracy`, which model it better
 * and cost nothing per event.
 */

export type AnalyticsEvent = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * Fire-and-forget event capture.
 *
 * Wrapped in try/catch on purpose: `capture` schedules its HTTP call inside the
 * caller's transaction, so an unhandled throw here would roll back the mutation
 * that produced the event. A user must never lose a completed review because
 * analytics had a bad day.
 */
export async function track(
  ctx: SchedulerCtx,
  distinctId: string,
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): Promise<void> {
  try {
    await posthog.capture(ctx, { distinctId, event, properties });
  } catch (error) {
    console.error(`[analytics] failed to capture ${event}`, error);
  }
}

/**
 * Attach or update person properties. Called from the billing sync so every
 * event can be segmented by plan without the client ever learning the plan id
 * (`getMyQuotas` deliberately withholds it).
 */
export async function identifyUser(
  ctx: SchedulerCtx,
  distinctId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  try {
    await posthog.identify(ctx, { distinctId, properties });
  } catch (error) {
    console.error('[analytics] failed to identify', error);
  }
}

/**
 * Report a backend exception with extra context.
 *
 * Uncaught exceptions already reach PostHog through the Convex dashboard's
 * first-party Error Tracking destination, so reach for this only where the
 * error is *caught* and would otherwise vanish. The onboarding swallow points
 * being the motivating case.
 */
export async function trackException(
  ctx: SchedulerCtx,
  error: unknown,
  distinctId?: string,
  additionalProperties?: Record<string, unknown>,
): Promise<void> {
  try {
    await posthog.captureException(ctx, {
      error,
      distinctId,
      additionalProperties,
    });
  } catch (captureError) {
    console.error('[analytics] failed to capture exception', captureError);
  }
}
