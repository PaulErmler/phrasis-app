/**
 * Detection for the Capacitor store-app shell (Play Store / App Store builds).
 *
 * Store policies forbid showing purchase/upgrade UI in those builds, so
 * anything payment-related must check `isNativeApp()` before rendering.
 *
 * For local testing without a device build, append `?native=1` to any URL
 * (persisted in localStorage; `?native=0` clears it).
 */

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => 'ios' | 'android' | 'web';
    };
  }
}

const OVERRIDE_KEY = 'flexling_native_override';

function readOverride(): boolean | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const param = params.get('native');
    if (param === '1') {
      localStorage.setItem(OVERRIDE_KEY, '1');
      return true;
    }
    if (param === '0') {
      localStorage.removeItem(OVERRIDE_KEY);
      return false;
    }
    return localStorage.getItem(OVERRIDE_KEY) === '1' ? true : null;
  } catch {
    return null;
  }
}

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const override = readOverride();
  if (override !== null) return override;
  return window.Capacitor?.isNativePlatform?.() === true;
}

export function nativePlatform(): 'ios' | 'android' | null {
  if (!isNativeApp()) return null;
  const platform = window.Capacitor?.getPlatform?.();
  if (platform === 'ios' || platform === 'android') return platform;
  // Override active without a real Capacitor bridge (browser testing).
  return /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent)
    ? 'ios'
    : 'android';
}
