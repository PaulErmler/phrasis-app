# Store submission guide: Flexling (Capacitor shell)

The store apps are thin Capacitor shells around `https://flexling.com/app`
(`capacitor.config.ts`). Web deploys reach the apps instantly; only changes to
the native projects, plugins, or the config require a store resubmission.

App ID (both stores): **`com.flexling.app`**

---

## 1. One-time credential setup

### 1.1 Convex env vars (per deployment: staging + production)

| Var | What |
|---|---|
| `APPLE_CLIENT_ID` | Apple **Services ID** (e.g. `com.flexling.app.signin`) |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_KEY_ID` | Key ID of the Sign in with Apple `.p8` key |
| `APPLE_PRIVATE_KEY` | The `.p8` private-key file contents |
| `APPLE_APP_BUNDLE_IDENTIFIER` | `com.flexling.app` (defaulted in code, set to be explicit) |

Set via `npx convex env set -- NAME "<value>"` (the `--` matters for the PEM
key) or the Convex dashboard. The **client secret JWT is minted at runtime**
from these (`appleClientSecret` in `convex/auth.ts`, per the Better Auth
docs' async-provider pattern), so there is no static secret and nothing to
rotate. Sign in with Apple is env-gated, so nothing breaks before the vars are
set; the Apple button simply won't work until they are.

### 1.2 Apple Developer portal (needs your logged-in browser)

1. Certificates, Identifiers & Profiles → Identifiers → create **App ID**
   `com.flexling.app`, enable capability *Sign in with Apple*.
2. Create a **Services ID** (`com.flexling.app.signin`), enable Sign in with
   Apple, set domain `flexling.com` and return URL
   `https://flexling.com/api/auth/callback/apple` (add the staging domain +
   its callback URL too for staging tests. Apple only redirects to
   registered URLs, and localhost is not accepted).
3. Keys → create a *Sign in with Apple* key, download the `.p8` file, note the
   Key ID and your Team ID → these become the env vars in 1.1.

### 1.3 Google Cloud console (OAuth clients)

Google sign-in inside the app uses a **native token flow**
(`components/auth/NativeSocialButtons.tsx`), because Google blocks OAuth
redirects in WebViews. Needed in the same Google Cloud project as the existing
web client:

1. **Android OAuth client**: package `com.flexling.app` + the **SHA-1 of the
   upload keystore** (see 2.1; add the Play App Signing SHA-1 after first
   upload too).
2. **iOS OAuth client**: bundle ID `com.flexling.app`.
3. Build-time env vars for the Next.js app (Coolify/Vercel, must be present at
   build time):
   - `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` = the **existing web** client ID
     (token audience, matches the backend's `GOOGLE_CLIENT_ID`)
   - `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` = the iOS client ID

---

## 2. Building the apps

Both platforms: `npx cap sync` after changing `capacitor.config.ts` or
updating plugins.

### 2.1 Android (`android/`)

```bash
# one-time: create the upload keystore. BACK IT UP + note the passwords
keytool -genkey -v -keystore ~/flexling-upload.keystore \
  -alias flexling -keyalg RSA -keysize 2048 -validity 10000
# SHA-1 for the Google OAuth client:
keytool -list -v -keystore ~/flexling-upload.keystore -alias flexling | grep SHA1

# build the bundle
cd android && ./gradlew bundleRelease
# output: android/app/build/outputs/bundle/release/app-release.aab
```

Configure signing in `android/app/build.gradle` (signingConfigs.release with
the keystore) or sign via Android Studio. Use **Play App Signing** when
creating the app so a lost upload key is recoverable.

### 2.2 iOS (`ios/`), requires full Xcode

```bash
npx cap open ios
```

In Xcode, one-time:
- Signing & Capabilities → select your team; bundle ID `com.flexling.app`.
- **Add capability: Sign in with Apple.**
- Verify `Info.plist` already has `NSMicrophoneUsageDescription` and
  `UIBackgroundModes: audio` (added by this setup).
- Product → Archive → Distribute → App Store Connect.

### 2.3 Smoke test on device/emulator before uploading

- Email+password sign-in, Google sign-in (native sheet), Apple sign-in (iOS)
- No pricing/upgrade/install UI anywhere (Settings, onboarding, quota dialogs)
- Mic recording in chat; audio keeps playing with the screen locked (iOS)
- Airplane mode on cold start → branded offline page with Retry
  (`native/shell/error.html`), not a white screen
- In a desktop browser you can preview shell behavior with `?native=1`
  (`lib/native.ts` override; `?native=0` clears)

---

## 3. Google Play Console

1. Create app (name `Flexling: Language Learning`, free, app category
   Education).
2. **Store listing**: copy from `docs/store/listing-copy.md`; assets from
   `store-assets/` (icon 512, feature graphic 1024×500, phone screenshots
   `store-assets/android/`).
3. **Data safety form** (truthful mapping for this app):
   - Collected: **Personal info → email address** (account), **App activity →
     in-app actions** (first-party PostHog analytics via `/ph-relay`),
     **Audio → voice recordings** (processed for transcription, not stored
     long-term; verify current retention before answering).
   - All data encrypted in transit: yes. Deletion mechanism: yes (in-app
     account deletion in Settings).
   - Data shared with third parties: no (analytics is first-party proxied;
     payment data never touches the app, since there is no in-app purchase).
   - No ads.
4. Content rating questionnaire → Education; no user-generated public content
   (chat is private 1:1 with AI).
5. Privacy policy URL: `https://flexling.com/legal/privacy`.
6. **Internal testing** track → upload `.aab` → test on a real device.
7. **Closed testing**: if the Play account is *personal* (post-Nov-2023),
   production requires **12+ testers opted in for 14 continuous days**.
   Recruit via Reddit/Discord; testers join via the opt-in link.
8. Apply for production once the requirement clears.

## 4. App Store Connect

1. Create app (bundle `com.flexling.app`, name/subtitle from listing-copy.md).
2. Upload build via Xcode; add screenshots (`store-assets/ios/`, 6.9″ set,
   also accepted for smaller sizes) and the 1024 icon is taken from the build.
3. **App Privacy** labels (match the Play data-safety answers): Email address
   (account), Product interaction (analytics, *not* linked to identity if you
   configure PostHog person-profiles accordingly; answer per current setup),
   Audio data (app functionality). No tracking → **no ATT prompt needed**.
4. Age rating 4+. Export compliance: standard HTTPS encryption exemption
   (answer "yes, uses encryption; exempt").
5. **App Review notes.** Include:
   - Demo account email/password (create a seeded account with an active
     course, some review history, and chat threads. Reviewers must reach the
     full experience without paying; the paywall is not present in the app).
   - "The app is free to use. There are no in-app purchases; optional
     subscriptions exist only on our website and are not offered, linked, or
     mentioned inside the app (reader-app model per 3.1.3(a))."
   - Native features note (for 4.2): background audio for hands-free audio
     lessons with screen off, native Sign in with Apple/Google, offline
     handling, haptics; push notifications planned.
6. TestFlight sanity pass → Submit for review.

### Rejection playbook

| Rejection | Response |
|---|---|
| 4.2 minimum functionality | Point to background-audio lessons (screen off), native auth, offline page; resubmit with a video of audio mode with the screen locked. Appeal if needed, web-shell apps frequently pass on second attempt. |
| 2.1 can't sign in | Verify the demo account works; include a fresh one. |
| 3.1.1 payments | Confirm no purchase mention is reachable; the `?native=1` override lets you audit exactly what reviewers see. |
| 2.3.7 marketing screenshots | Drop `05-testimonials.png` from the iOS set. |

---

## 5. Known follow-ups (post-launch)

- **US storefront link-out** ("subscribe on flexling.com") as a follow-up
  update once both apps are approved, decided at planning time.
- **Push notifications** (streak reminders). Needs FCM/APNs infra +
  `@capacitor/push-notifications`; also strengthens the 4.2 story.
- ~~Account deletion cascade~~ **Done (2026-08-20):** in-app requests write a
  durable `accountDeletions` row and support fulfills them with
  `npx convex run admin/deleteUser:run '{"userId":"…","email":"…"}' --prod`
  (dry-run first with `"dryRun": true`). Purges all app data, AI chat, the
  auth account, and the Autumn/Stripe customer; see `convex/admin/deleteUser.ts`.
  Still open: PostHog person deletion (events keyed by the deleted user id).
- Regenerate screenshots after UI changes: `pnpm dev` + `pnpm store:assets`
  (writes to `store-assets/`; mock screens live at `/screenshots/[screen]`,
  dev-only).
