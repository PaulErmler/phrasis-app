'use client';

import { useMemo } from 'react';
import { furiganaDisplay, type FuriganaDisplay } from '@/lib/furigana';

/**
 * Memoized furiganaDisplay for render paths that re-run per playback frame
 * (karaoke ticks). Non-component call sites (CardApproval's renderLine) use
 * the plain function instead.
 */
export function useFuriganaDisplay(
  furigana: string | null | undefined,
  text: string,
): FuriganaDisplay {
  return useMemo(() => furiganaDisplay(furigana, text), [furigana, text]);
}
