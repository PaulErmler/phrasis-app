'use client';

import { useEffect } from 'react';
import { installAudioGestureUnlock } from '@/lib/audio/gestureUnlock';

/**
 * Mounts once under `/app` and turns the first tap anywhere in the app into
 * the audio session setup (see `lib/audio/gestureUnlock.ts`). Renders
 * nothing.
 */
export function AudioGestureUnlock() {
  useEffect(() => installAudioGestureUnlock(), []);
  return null;
}
