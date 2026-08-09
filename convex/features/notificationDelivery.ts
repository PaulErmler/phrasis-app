'use node';

/**
 * Push delivery for the daily reminder — the only place either transport is
 * spoken.
 *
 * Split from features/notifications.ts because `"use node"` cannot coexist with
 * queries and mutations in one module, and Web Push needs it: RFC 8291 payload
 * encryption (`aes128gcm`) is the one part of this feature not worth
 * hand-rolling against WebCrypto, and `web-push` does it. FCM needs nothing
 * beyond `fetch` and a signed JWT, but lives here too so both transports stay
 * in one file.
 *
 * Why two transports at all: the Capacitor store apps point `server.url` at the
 * live site, and service workers are unavailable in an iOS WKWebView — so a
 * store app has no Web Push path and a browser has no FCM token. Same schedule,
 * same copy, different wire.
 *
 * This action never throws for a delivery problem. `reminderPool` runs it with
 * retries off (see lib/workpools.ts): a retry after a partial success would
 * re-push to devices that already got it, and a duplicate notification is worse
 * than a missed one. Failures are recorded, not raised.
 */

import { v } from 'convex/values';
import webpush from 'web-push';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { getServiceAccountAccessToken } from '../lib/googleServiceAccount';
import { rateLimiter } from '../rateLimiter';
import {
  renderDailyReminder,
  resolveNotificationLocale,
} from '../../lib/notificationCopy';

/**
 * Collapse key. Reusing it means a phone that was offline for two days shows
 * one reminder, not a stack — the older ones are strictly stale.
 */
const NOTIFICATION_TAG = 'flexling-daily';

/** Where a tap lands. Matches the notificationclick handler in public/sw.js. */
const CLICK_URL = '/app';

/**
 * How long a push may sit undelivered, in seconds.
 *
 * Three hours, not the protocol maximum. A reminder is a statement about right
 * now; surfacing "time to practise" when the user picks their phone up at
 * midnight, hours after the fact, is worse than staying silent — and tomorrow's
 * reminder is already on its way.
 */
const TTL_SECONDS = 3 * 60 * 60;

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * E2E capture mode. Same env flag and intent as `captureMode()` in
 * lib/authEmails.ts, duplicated as a one-liner rather than imported so a push
 * module does not depend on the email module.
 */
const captureMode = () => process.env.E2E_TEST_HOOKS === '1';

type Outcome = 'delivered' | 'expired' | 'failed';

type Device = {
  id: Id<'pushDevices'>;
  platform: 'web' | 'ios' | 'android';
  token: string;
  keys?: { p256dh: string; auth: string };
};

type Payload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

/**
 * Rate gate, per-user bucket before the global backstop.
 *
 * Ordering matters and mirrors `allowAuthEmail` in convex/auth.ts: checking the
 * user's own bucket first means an account already at its limit does not burn
 * global tokens on the way to being refused.
 */
async function allowReminder(ctx: ActionCtx, userId: string): Promise<boolean> {
  const perUser = await rateLimiter.limit(ctx, 'dailyReminder', {
    key: userId,
  });
  if (!perUser.ok) return false;
  const global = await rateLimiter.limit(ctx, 'dailyReminderGlobal');
  return global.ok;
}

/**
 * Deliver one Web Push message.
 *
 * A 404 or 410 is the push service saying the subscription is gone for good —
 * the user cleared site data, revoked permission, or the browser rotated the
 * endpoint. That is the only signal we ever get, which is why pruning happens
 * here rather than on a timer.
 */
async function sendWebPush(
  device: Device,
  payload: Payload,
  vapid: { subject: string; publicKey: string; privateKey: string },
): Promise<Outcome> {
  // `registerDevice` rejects keyless web rows, so this is unreachable outside a
  // hand-edited document — but without keys the payload cannot be encrypted at
  // all, so the row is permanently useless rather than transiently broken.
  if (!device.keys) return 'expired';

  try {
    await webpush.sendNotification(
      { endpoint: device.token, keys: device.keys },
      JSON.stringify(payload),
      { vapidDetails: vapid, TTL: TTL_SECONDS },
    );
    return 'delivered';
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return 'expired';
    console.error('[notifications] web push failed', {
      statusCode,
      message: (error as Error).message,
    });
    return 'failed';
  }
}

/**
 * Deliver one FCM message (Android directly, iOS via APNs — FCM relays, which
 * is why there is no APNs code here and no `.p8` in the deployment env).
 *
 * Sends a `notification` block rather than data-only so the OS renders it while
 * the app is backgrounded or killed without any app code running; `data.url`
 * rides along for the tap handler.
 */
async function sendFcm(
  device: Device,
  payload: Payload,
  auth: { token: string; projectId: string },
): Promise<Outcome> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: device.token,
          notification: { title: payload.title, body: payload.body },
          // FCM data values must be strings.
          data: { url: payload.url, tag: payload.tag },
          android: {
            ttl: `${TTL_SECONDS}s`,
            notification: { tag: payload.tag },
          },
          apns: {
            headers: {
              'apns-expiration': String(
                Math.floor(Date.now() / 1000) + TTL_SECONDS,
              ),
              'apns-collapse-id': payload.tag,
            },
            payload: { aps: { sound: 'default', 'thread-id': payload.tag } },
          },
        },
      }),
    },
  );

  if (response.ok) return 'delivered';

  const body = await response.text();
  // FCM v1 reports a dead token as 404 NOT_FOUND, and a structurally invalid
  // one as 400 INVALID_ARGUMENT. Both are permanent. Every other 400 (a bad
  // message body — our bug) must NOT prune the user's device, hence the
  // substring check rather than treating all 400s as terminal.
  if (response.status === 404) return 'expired';
  if (response.status === 400 && body.includes('INVALID_ARGUMENT')) {
    return 'expired';
  }
  console.error('[notifications] FCM send failed', {
    status: response.status,
    body: body.slice(0, 500),
  });
  return 'failed';
}

/** Read VAPID config, or null when the deployment has not been configured. */
function readVapidConfig(): {
  subject: string;
  publicKey: string;
  privateKey: string;
} | null {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

/**
 * Send today's reminder to every device a user has registered.
 *
 * Enqueued by the sweep (once per user per local day) and by the "send test"
 * button (`force: true`, which bypasses the enabled and already-studied checks).
 */
export const deliverDailyReminder = internalAction({
  args: { userId: v.string(), force: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    // One query, not several: an action's reads are separate transactions, so
    // splitting this would let the user's state change underneath the decision.
    const plan = await ctx.runQuery(
      internal.features.notifications.getDeliveryPlan,
      { userId: args.userId, now, force: args.force },
    );
    if (!plan.send) return null;

    if (!(await allowReminder(ctx, args.userId))) {
      console.warn('[notifications] reminder rate-limited', {
        userId: args.userId,
      });
      return null;
    }

    const payload: Payload = {
      ...renderDailyReminder(
        resolveNotificationLocale(plan.locale ?? undefined),
        {
          dueCount: plan.dueCount,
          streakState: plan.streakState,
          streakDays: plan.streakDays,
        },
      ),
      url: CLICK_URL,
      tag: NOTIFICATION_TAG,
    };

    if (captureMode()) {
      await ctx.runMutation(internal.features.notificationTesting.capturePush, {
        userId: args.userId,
        title: payload.title,
        body: payload.body,
        deviceCount: plan.devices.length,
      });
      return null;
    }

    // Outside capture mode a fixture account must never reach a real push
    // service — see `isE2EFixtureUser` on the plan for why the env flag alone
    // is not enough for a recurring send.
    if (plan.isE2EFixtureUser) {
      console.warn('[notifications] skipped E2E fixture user', {
        userId: args.userId,
      });
      return null;
    }

    const devices = plan.devices as Device[];
    const webDevices = devices.filter((d) => d.platform === 'web');
    const nativeDevices = devices.filter((d) => d.platform !== 'web');

    // Resolve each transport's credentials once, and only if that transport is
    // actually needed — a browser-only user must not fail because FCM is
    // unconfigured, and vice versa. A credential problem marks that
    // transport's devices as transiently failed (never expired: the tokens are
    // fine, our config is not) so nothing gets pruned over a deploy mistake.
    const vapid = webDevices.length > 0 ? readVapidConfig() : null;
    if (webDevices.length > 0 && !vapid) {
      console.error(
        '[notifications] VAPID keys not configured; skipping web push',
      );
    }

    let fcmAuth: { token: string; projectId: string } | null = null;
    if (nativeDevices.length > 0) {
      try {
        fcmAuth = await getServiceAccountAccessToken({
          raw: process.env.FCM_SERVICE_ACCOUNT_KEY,
          envName: 'FCM_SERVICE_ACCOUNT_KEY',
          scope: FCM_SCOPE,
        });
      } catch (error) {
        console.error('[notifications] FCM auth failed; skipping native push', {
          message: (error as Error).message,
        });
      }
    }

    const settled = await Promise.all(
      devices.map(
        async (
          device,
        ): Promise<{ id: Id<'pushDevices'>; outcome: Outcome }> => {
          try {
            if (device.platform === 'web') {
              return {
                id: device.id,
                outcome: vapid
                  ? await sendWebPush(device, payload, vapid)
                  : 'failed',
              };
            }
            return {
              id: device.id,
              outcome: fcmAuth
                ? await sendFcm(device, payload, fcmAuth)
                : 'failed',
            };
          } catch (error) {
            // Belt and braces: one device's unexpected throw must not deprive the
            // others of an outcome record.
            console.error('[notifications] unexpected send error', {
              platform: device.platform,
              message: (error as Error).message,
            });
            return { id: device.id, outcome: 'failed' };
          }
        },
      ),
    );

    await ctx.runMutation(
      internal.features.notifications.recordDeliveryOutcome,
      {
        delivered: settled
          .filter((r) => r.outcome === 'delivered')
          .map((r) => r.id),
        expired: settled
          .filter((r) => r.outcome === 'expired')
          .map((r) => r.id),
        failed: settled.filter((r) => r.outcome === 'failed').map((r) => r.id),
      },
    );
    return null;
  },
});
