# Push notifications — one-time setup

Everything the daily reminder needs that cannot live in the repo: a Firebase
project, an APNs key, VAPID keys, and the store-facing paperwork. Companion to
`submission-guide.md`, which covers the rest of the native shell.

The code is already in place — see `convex/features/notifications.ts` (schedule)
and `convex/features/notificationDelivery.ts` (the two transports). Until the
environment variables below are set, reminders simply never send: the delivery
action logs a configuration error and marks devices as transiently failed, so
nothing is pruned and nothing breaks.

## Why two transports

| Surface | Transport | Needs |
| --- | --- | --- |
| Desktop + Android browsers, installed PWA | Web Push (VAPID) | `VAPID_*` |
| iOS App Store app | FCM → APNs | Firebase project + APNs key |
| Google Play app | FCM | Firebase project |

The store apps cannot use Web Push. `capacitor.config.ts` points `server.url` at
the live site, and an iOS WKWebView exposes no service worker or Push API — so a
store app has no Web Push path, and a browser has no FCM token. One schedule,
one set of copy, two wires.

---

## 1. VAPID keys (browsers and installed PWA)

```bash
pnpm exec web-push generate-vapid-keys
```

Set on each Convex deployment (staging and production get **different** keys —
rotating one must not silently invalidate the other's stored subscriptions):

```bash
npx convex env set VAPID_PUBLIC_KEY  "<public key>"
npx convex env set VAPID_PRIVATE_KEY "<private key>"
npx convex env set VAPID_SUBJECT     "mailto:support@flexling.com"
```

The public key also has to reach the browser, so add it to the **web** app's
environment (Coolify / `.env.local`), matching the existing
`NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` convention:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<same public key>
```

It must be byte-identical to `VAPID_PUBLIC_KEY`. A mismatch produces
subscriptions the sender cannot authenticate against, and the push services
reject them at send time rather than at subscribe time — so the failure surfaces
a day later, not in the UI.

## 2. Firebase project (both store apps)

1. Create a Firebase project (or reuse an existing Flexling one). This is a GCP
   project, and deliberately **not** the one behind
   `GOOGLE_SERVICE_ACCOUNT_KEY` — translation and push rotate independently.
2. Add an **Android** app with package name `com.flexling.app`. Download
   `google-services.json` → `android/app/google-services.json`.
   No Gradle edit is needed: `android/app/build.gradle` already applies the
   `com.google.gms.google-services` plugin conditionally on that file existing,
   and the classpath is already in `android/build.gradle`.
3. Add an **iOS** app with bundle id `com.flexling.app`. Download
   `GoogleService-Info.plist` → `ios/App/App/GoogleService-Info.plist`, then add
   it to the Xcode target (drag into the `App` group, "Copy items if needed"
   unchecked since it is already in place).
4. Create a service account with the **Firebase Cloud Messaging API** role and
   download its JSON key. Then, on each Convex deployment:

   ```bash
   npx convex env set -- FCM_SERVICE_ACCOUNT_KEY "$(cat service-account.json)"
   ```

   The `--` matters, as with `APPLE_PRIVATE_KEY`. Base64 is also accepted if the
   multi-line PEM inside gives the dashboard trouble —
   `parseServiceAccountKey` in `convex/lib/googleServiceAccount.ts` takes either.
   The FCM project id is read from the key's own `project_id`, so there is no
   separate variable to keep in sync.

## 3. APNs (iOS only)

FCM relays to APNs, so there is no `.p8` in the Convex environment — Firebase
holds it.

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → new key
   with **Apple Push Notifications service (APNs)** enabled. Download the `.p8`
   (once only) and note its Key ID.
2. Identifiers → `com.flexling.app` → enable the **Push Notifications**
   capability.
3. Firebase → Project settings → Cloud Messaging → **APNs Authentication Key** →
   upload the `.p8` with its Key ID and Team ID `WHQLUR6M3A`.
4. Regenerate the provisioning profiles (Xcode's automatic signing does this on
   the next build) so they carry the push entitlement.

Already committed, so no Xcode capability click is strictly required:

- `ios/App/App/App.entitlements` with `aps-environment` = `development`
  (App Store archives are re-signed to `production` by the distribution
  profile — do not change it here or debug builds on device break).
- `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` in both build configurations
  of `project.pbxproj`.
- `remote-notification` in `UIBackgroundModes` in `Info.plist`.
- The two `didRegisterForRemoteNotifications` forwards in `AppDelegate.swift`,
  which `@capacitor/push-notifications` requires.

The entitlements file is referenced by build setting but is not a
`PBXFileReference`, so it will not appear in Xcode's file tree. That is
cosmetic — the build reads it from the path. Adding the Push Notifications
capability in Xcode once will register it properly and is harmless.

## 4. Sync and rebuild the store apps

Adding a Capacitor plugin is a native change, so unlike a web deploy this needs
a store resubmission (`submission-guide.md`: only changes to the native
projects, plugins, or the config require one).

```bash
pnpm cap:store   # sets CAP_SERVER, regenerates native/shell/app-url.js, cap sync
```

Then archive in Xcode and `./gradlew bundleRelease` as usual.

## 5. Store paperwork

The app now collects a device token, which both stores treat as a disclosure.

- **Google Play → Data safety**: declare `Device or other IDs` as collected,
  not shared, used for "App functionality".
- **App Store → App Privacy**: add `Device ID`, purpose "App Functionality",
  not linked to identity, not used for tracking.
- The 4.2 review notes in `submission-guide.md` say push notifications are
  *planned* — update that to shipped, since native notification integration is
  one of the things reviewers count as genuine native value.

## Follow-ups (not blocking)

- **Android notification icon.** No monochrome small icon exists in
  `android/app/src/main/res/`, and no `colors.xml`, so no
  `default_notification_icon` / `default_notification_color` meta-data is set —
  Android falls back to the launcher icon, which some versions render as a white
  square. Add a white-on-transparent 24dp drawable plus the two meta-data
  entries when there is a designed asset.
- **Web badge asset.** `public/sw.js` uses `icon-192x192.png` for both `icon`
  and `badge`; a dedicated monochrome badge would look better on Android Chrome.

## Verifying without waiting for the clock

```bash
# Fire the sweep by hand (it claims whatever is due right now).
pnpm exec convex run features/notifications:sweep

# Or make one user due: set reminderNextSendAt to Date.now() on their
# userSettings row in the Convex dashboard.
```

For tests, set `E2E_TEST_HOOKS=1` on a dev deployment and the delivery action
records what it *would* have sent into `testPushMessages` instead of calling a
push service — read it back with
`pnpm exec convex run features/notificationTesting:latestPush '{"userId":"..."}'`.
Note that Playwright fixture accounts are refused a real send regardless of that
flag, because a daily reminder keeps firing long after
`e2e/global-teardown.ts` has cleared it.
