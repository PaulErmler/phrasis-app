// Flexling Service Worker
//
// Served statically, not bundled — no imports, no build step.
// next.config.ts sets `Service-Worker-Allowed: /` and no-cache headers on this
// file, so an updated worker reaches clients on their next load.
//
// Note this also runs inside the Capacitor store apps, since the shell loads
// the live site. The push handlers below are inert there (an iOS WKWebView has
// no push service); the store apps receive the same reminders over FCM/APNs
// instead. See convex/features/notificationDelivery.ts.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {}); // Required for install prompt

const FALLBACK_URL = '/app';
const FALLBACK_TITLE = 'Flexling';

// Daily reminder pushes. The payload is JSON written by
// convex/features/notificationDelivery.ts: { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    // `event.data` is absent for a bare wake-up push, and not necessarily JSON
    // if anything else ever reaches this endpoint. Neither may throw past this
    // handler, or the browser replaces our notification with its own generic
    // "this site was updated in the background" one.
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const url = typeof payload.url === 'string' ? payload.url : FALLBACK_URL;
  const title =
    typeof payload.title === 'string' && payload.title
      ? payload.title
      : FALLBACK_TITLE;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: '/icons/icon-192x192.png',
      // Deliberately the 192 icon again: there is no dedicated monochrome
      // badge asset in public/icons/, and pointing at a file that does not
      // exist silently drops the badge.
      badge: '/icons/icon-192x192.png',
      // Collapse on the tag so a device that was offline shows one reminder
      // rather than a stack of stale ones; renotify still alerts for the newest
      // instead of replacing it silently.
      tag: typeof payload.tag === 'string' ? payload.tag : 'flexling-daily',
      renotify: true,
      data: { url },
    }),
  );
});

// Focus an existing window if the app is already open, otherwise open one.
// Without this the notification's data.url is inert and a tap does nothing.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || FALLBACK_URL;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // Compare pathnames, not full URLs: a client's href carries the
          // origin and may carry query params, so equality against a bare path
          // never matches and every tap would open a duplicate window.
          let pathname = '';
          try {
            pathname = new URL(client.url).pathname;
          } catch {
            pathname = '';
          }
          if (pathname === target && 'focus' in client) {
            return client.focus();
          }
        }
        // Nothing on that path — prefer refocusing an open window and
        // navigating it, falling back to a fresh one.
        const existing = clientList[0];
        if (existing && 'navigate' in existing) {
          return existing
            .focus()
            .then((client) => (client ? client.navigate(target) : undefined));
        }
        return self.clients.openWindow(target);
      }),
  );
});

// Browsers rotate a subscription's endpoint occasionally and fire this instead
// of telling the page. Support is patchy and this worker has no session to
// persist the new subscription with, so it is deliberately best-effort: it
// re-subscribes with the same application server key so pushes keep arriving,
// and the authoritative re-sync is the client's mount-time registerDevice call
// (hooks/use-push-registration.ts), which does have the user's session.
self.addEventListener('pushsubscriptionchange', (event) => {
  const applicationServerKey =
    event.oldSubscription && event.oldSubscription.options
      ? event.oldSubscription.options.applicationServerKey
      : undefined;
  if (!applicationServerKey) return;

  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey })
      .catch(() => {
        // Nothing useful to do here — the next authenticated page load
        // re-registers whatever subscription actually exists.
      }),
  );
});
