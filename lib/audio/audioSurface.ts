import { isNativeApp } from '@/lib/native';

/**
 * Which surface the page is running on, attached to every audio telemetry
 * event. iOS treats the three differently: Safari, an installed home-screen
 * web app (measurably worse at background playback, WebKit bug 261858), and
 * the Capacitor store shell (a WKWebView with its own audio session setup).
 * Nothing else in the analytics stream records the display mode.
 */
export interface AudioSurface {
  visibility: 'visible' | 'hidden' | 'unknown';
  display_mode: 'standalone' | 'browser' | 'unknown';
  native_shell: boolean;
}

/** Screen locked, app switched away, or another tab in front. */
export function isPageHidden(): boolean {
  return (
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
  );
}

export function audioSurfaceProperties(): AudioSurface {
  if (typeof window === 'undefined') {
    return { visibility: 'unknown', display_mode: 'unknown', native_shell: false };
  }
  const visibility = isPageHidden() ? 'hidden' : 'visible';
  let standalone = false;
  try {
    standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches);
  } catch {
    // matchMedia can throw on exotic embedders; treat as a browser tab.
  }
  return {
    visibility,
    display_mode: standalone ? 'standalone' : 'browser',
    native_shell: isNativeApp(),
  };
}
