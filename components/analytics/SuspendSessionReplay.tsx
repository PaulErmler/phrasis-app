'use client';

import { useEffect } from 'react';

import { posthog } from '@/lib/posthog/client';

/**
 * Stops session replay for as long as this is mounted, and resumes on unmount.
 *
 * Used on `/app/admin`, where the screen is a list of *other people's* personal
 * data. Masking individual fields there would be a losing game — every new admin
 * table is a new leak — and admin screens have no product-analytics value that
 * would justify the risk.
 */
export function SuspendSessionReplay() {
  useEffect(() => {
    posthog.stopSessionRecording();
    return () => {
      // No `true` override: that flag force-starts recording even for
      // sessions that sampling or consent had excluded, so leaving admin
      // would *begin* a recording that never existed. The plain call only
      // clears the stop above; a session that was recording resumes, one
      // that wasn't stays off.
      posthog.startSessionRecording();
    };
  }, []);

  return null;
}
