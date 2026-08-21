'use client';

import { useEffect } from 'react';

/**
 * Requests a screen wake lock while `enabled` is true so the display stays on.
 * No-ops when unsupported or denied. Releases when the tab is hidden or on cleanup.
 */
export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return;

    const wakeLockApi = navigator.wakeLock;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const release = () => {
      if (sentinel && !sentinel.released) {
        void sentinel.release();
      }
      sentinel = null;
    };

    const acquire = async () => {
      if (!enabled || cancelled || document.visibilityState !== 'visible') return;
      release();
      try {
        const s = await wakeLockApi.request('screen');
        if (cancelled || !enabled) {
          void s.release();
          return;
        }
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        // Unsupported, denied, or not allowed in this context. Ignore
      }
    };

    if (!enabled) {
      return;
    }

    void acquire();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        release();
      } else {
        void acquire();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [enabled]);
}
