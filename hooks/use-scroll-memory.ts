'use client';

import { useCallback } from 'react';

/**
 * Persists an inner scroll container's position in sessionStorage so tab
 * switches — which unmount route segments — restore scroll the way the old
 * keep-everything-mounted shell did.
 *
 * Returns a ref callback for the scroll container. Relies on React 19 ref
 * cleanup functions for listener teardown.
 */
export function useScrollMemory(key: string) {
  return useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const storageKey = `phrasis:scroll:${key}`;

      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) node.scrollTop = parseInt(saved, 10) || 0;
      } catch {
        // Storage unavailable — scroll simply starts at the top.
      }

      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          try {
            sessionStorage.setItem(storageKey, String(node.scrollTop));
          } catch {
            // ignore
          }
        });
      };
      node.addEventListener('scroll', onScroll, { passive: true });

      return () => {
        node.removeEventListener('scroll', onScroll);
        if (raf) cancelAnimationFrame(raf);
      };
    },
    [key],
  );
}
