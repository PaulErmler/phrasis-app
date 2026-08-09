'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { useIsNativeApp } from '@/hooks/use-native-app';
import { nativePlatform } from '@/lib/native';
import { getUserTimezone } from '@/lib/timezone';

/**
 * Register this device to receive daily reminder pushes.
 *
 * One hook, two transports, chosen at runtime — the same deployed bundle runs
 * in a browser and inside the Capacitor store shell (which loads the live site
 * via `server.url`):
 *
 *   browser / installed PWA -> Web Push subscription through the service worker
 *   store app               -> FCM registration token via @capacitor/push-notifications
 *
 * They are not interchangeable. An iOS WKWebView has no service worker and no
 * Push API, so the store apps genuinely cannot use Web Push; a browser has no
 * FCM token. `platform` is persisted so the sender knows which wire to use.
 *
 * The Capacitor plugin is loaded with a dynamic `import()`, matching
 * components/auth/NativeSocialButtons.tsx — the web bundle must not carry a
 * static `@capacitor/*` import, and `lib/native.ts` only ever sniffs the
 * injected `window.Capacitor` bridge.
 */

export type PushStatus =
  /** Still working out what this device supports. */
  | 'unknown'
  /** Browser has no push support at all (older Safari, some embedded views). */
  | 'unsupported'
  /** Permission was refused; only the OS/browser settings can undo it. */
  | 'denied'
  /** Supported and permitted, but no subscription/token stored yet. */
  | 'ready'
  /** Registered — this device will receive reminders. */
  | 'subscribed';

/**
 * Convert the base64url VAPID public key to the `Uint8Array` that
 * `pushManager.subscribe` requires. Browsers reject the string form.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Backed by an explicit ArrayBuffer, not the default ArrayBufferLike:
  // `applicationServerKey` wants a BufferSource, and TS 5.9's typed-array
  // generics reject the wider type because it admits SharedArrayBuffer.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** Extract a subscription's keys as the base64 strings the server stores. */
function subscriptionKeys(
  subscription: PushSubscription,
): { p256dh: string; auth: string } | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  return p256dh && auth ? { p256dh, auth } : null;
}

function webPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type UsePushRegistration = {
  status: PushStatus;
  /** True while subscribe/unsubscribe is in flight. */
  busy: boolean;
  /**
   * Ask for permission and store the subscription/token.
   *
   * MUST be called directly from a user gesture — iOS only shows the
   * permission prompt inside one, and awaiting anything first loses the
   * gesture, so this deliberately does no async work before requesting.
   */
  subscribe: () => Promise<boolean>;
  /** Forget this device (the OS-level permission is untouched). */
  unsubscribe: () => Promise<void>;
};

export function usePushRegistration(enabled: boolean): UsePushRegistration {
  const isNative = useIsNativeApp();
  const locale = useLocale();
  const [status, setStatus] = useState<PushStatus>('unknown');
  const [busy, setBusy] = useState(false);

  const registerDevice = useMutation(api.features.notifications.registerDevice);
  const unregisterDevice = useMutation(
    api.features.notifications.unregisterDevice,
  );
  const updateSettings = useMutation(
    api.features.notifications.updateReminderSettings,
  );

  // The last token we told the server about, so the re-sync below runs once per
  // token rather than on every render.
  const syncedTokenRef = useRef<string | null>(null);

  /** Resolve support/permission without touching anything. */
  useEffect(() => {
    if (isNative) {
      // The plugin reports permission asynchronously; assume actionable until
      // it says otherwise, since a native app always has a push path.
      setStatus('ready');
      return;
    }
    if (!webPushSupported()) {
      setStatus('unsupported');
      return;
    }
    setStatus(Notification.permission === 'denied' ? 'denied' : 'ready');
  }, [isNative]);

  /**
   * Re-sync on mount, and keep the stored timezone and locale fresh.
   *
   * Two things drift silently: a browser rotates a push endpoint without
   * telling the page (the service worker's `pushsubscriptionchange` handler
   * cannot persist it — it has no session), and a user travels or their zone
   * changes its DST rules. Both would otherwise leave reminders firing at the
   * wrong time or to a dead endpoint until the user visited settings.
   *
   * Only runs when reminders are on: there is nothing to keep fresh otherwise,
   * and it must not create a settings row for someone who never opted in.
   */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      // Cheap and idempotent — the mutation no-ops when nothing changed.
      try {
        await updateSettings({ timeZone: getUserTimezone(), locale });
      } catch {
        // A failed freshness update must never break the settings screen.
      }

      if (isNative) {
        // Capacitor replays the same token to the `registration` listener on
        // every launch, so `subscribe()` covers the native re-sync.
        return;
      }
      if (!webPushSupported() || Notification.permission !== 'granted') return;

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled || !subscription) return;
        const keys = subscriptionKeys(subscription);
        if (!keys) return;
        if (syncedTokenRef.current === subscription.endpoint) return;
        await registerDevice({
          platform: 'web',
          token: subscription.endpoint,
          keys,
        });
        syncedTokenRef.current = subscription.endpoint;
        if (!cancelled) setStatus('subscribed');
      } catch {
        // Leave the status as-is; the user can still press the button.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, isNative, locale, registerDevice, updateSettings]);

  const subscribeNative = useCallback(async (): Promise<boolean> => {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Android 13+ treats POST_NOTIFICATIONS as a runtime permission, so this
    // call is load-bearing on Android too, not just iOS.
    let permission = await PushNotifications.checkPermissions();
    if (
      permission.receive === 'prompt' ||
      permission.receive === 'prompt-with-rationale'
    ) {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') {
      setStatus('denied');
      return false;
    }

    // `register()` resolves as soon as the OS request is made — the token
    // arrives later on the 'registration' event, so wait for that rather than
    // assuming success. Reject on 'registrationError' so the caller can toast.
    const platform = nativePlatform();
    const token = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Push registration timed out')),
        15_000,
      );
      void PushNotifications.addListener('registration', (t) => {
        clearTimeout(timeout);
        resolve(t.value);
      });
      void PushNotifications.addListener('registrationError', (err) => {
        clearTimeout(timeout);
        reject(new Error(String(err?.error ?? 'registrationError')));
      });
      void PushNotifications.register();
    });

    await registerDevice({
      platform: platform === 'ios' ? 'ios' : 'android',
      token,
    });
    syncedTokenRef.current = token;
    return true;
  }, [registerDevice]);

  const subscribeWeb = useCallback(async (): Promise<boolean> => {
    if (!webPushSupported()) {
      setStatus('unsupported');
      return false;
    }
    // Requested first and without an intervening await, so the call still sits
    // inside the user's gesture (iOS requirement).
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus(permission === 'denied' ? 'denied' : 'ready');
      return false;
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      // A deployment misconfiguration, not a user problem.
      throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set');
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Mandatory on Chrome: it refuses silent pushes outright.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));

    const keys = subscriptionKeys(subscription);
    if (!keys) throw new Error('Push subscription is missing its keys');

    await registerDevice({
      platform: 'web',
      token: subscription.endpoint,
      keys,
    });
    syncedTokenRef.current = subscription.endpoint;
    return true;
  }, [registerDevice]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const ok = isNative ? await subscribeNative() : await subscribeWeb();
      if (ok) setStatus('subscribed');
      return ok;
    } finally {
      setBusy(false);
    }
  }, [isNative, subscribeNative, subscribeWeb]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    try {
      let token = syncedTokenRef.current;

      if (!isNative && webPushSupported()) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          token = subscription.endpoint;
          // Drop the browser-side subscription too, so the push service stops
          // holding an endpoint the server has forgotten.
          await subscription.unsubscribe().catch(() => undefined);
        }
      }

      if (token) await unregisterDevice({ token });
      syncedTokenRef.current = null;
      setStatus('ready');
    } finally {
      setBusy(false);
    }
  }, [isNative, unregisterDevice]);

  return { status, busy, subscribe, unsubscribe };
}
