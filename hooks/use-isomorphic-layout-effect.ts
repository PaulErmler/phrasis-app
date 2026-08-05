'use client';

import { useEffect, useLayoutEffect } from 'react';

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * React warns when `useLayoutEffect` runs during SSR, but the hooks that need
 * it (cached-query hydration, snapshot restore, counter seeding) all read
 * client-only state and must do so synchronously before paint — otherwise the
 * first visible frame shows a placeholder value and then jumps.
 *
 * Shared so the three call sites can't drift; each used to declare its own
 * identical copy.
 */
export const useBrowserLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
