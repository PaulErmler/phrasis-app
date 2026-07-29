import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Store-app shell configuration (Play Store / App Store builds).
 *
 * The shell is a thin native wrapper around the production site — server.url
 * points the WebView at flexling.com, so every web deploy reaches the store
 * apps instantly without a store review. Only changes to THIS config, the
 * native projects, or plugins require rebuilding and resubmitting.
 *
 * The web app detects the shell via `Capacitor.isNativePlatform()`
 * (lib/native.ts) and hides everything store policies forbid (pricing,
 * checkout, install CTAs).
 */
const config: CapacitorConfig = {
  appId: 'com.flexling.app',
  appName: 'Flexling',
  // Required by Capacitor even though server.url overrides it; contains the
  // offline error page (errorPath) and a bootstrap redirect.
  webDir: 'native/shell',
  // Local testing: `pnpm cap:local` points the shell at the Mac's dev server
  // (the iOS Simulator reaches it via localhost). No errorPath there —
  // Capacitor shows it on ANY failed OR CANCELLED navigation, and dev is full
  // of harmless cancellations (HMR reloads, redirect races), which made the
  // offline page pop up constantly.
  // Store builds: plain `npx cap sync` → production URL + branded offline
  // page (instead of a white screen when e.g. cold-starting in airplane
  // mode). Its retry/auto-return targets the production URL.
  // allowNavigation is REQUIRED even though it looks redundant: Capacitor
  // only treats URLs that start with the FULL server.url string (path
  // included) as internal, so without the host allow-listed, the redirect
  // from /app to /auth/sign-in would be cancelled and opened in Safari.
  server: process.env.CAP_SERVER === 'local'
    ? {
      url: 'http://localhost:3000/app',
      allowNavigation: ['localhost'],
    }
    : process.env.CAP_SERVER === 'dev'
      ? {
        // Staging environment — same shape as the store build, offline page
        // included (its retry URL comes from the generated app-url.js).
        url: 'https://dev.flexling.com/app',
        allowNavigation: ['dev.flexling.com'],
        errorPath: 'error.html',
      }
      : {
        url: 'https://flexling.com/app',
        allowNavigation: ['flexling.com'],
        errorPath: 'error.html',
      },
  // No ios.contentInset override: the default ('never') lets the WebView
  // extend under the notch/home bar so the app's own CSS
  // env(safe-area-inset-*) padding works — 'automatic' fights it (native
  // scroll insets + env() reporting 0 → content under the status bar).
  plugins: {
    SplashScreen: {
      backgroundColor: '#0d1117',
      launchShowDuration: 2000,
      launchAutoHide: true,
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
    },
    StatusBar: {
      // The app supports light & dark themes; DEFAULT follows the system.
      style: 'DEFAULT',
    },
  },
};

export default config;
