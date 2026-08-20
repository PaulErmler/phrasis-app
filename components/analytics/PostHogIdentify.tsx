'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { posthog } from '@/lib/posthog/client';
import { resetPreservingConsent } from '@/lib/posthog/consent';

/**
 * Ties the browser's PostHog identity to the signed-in user.
 *
 * The distinct id is the Better Auth user id. The same string Convex reads as
 * `identity.subject` (see `requireAuthUserId` in `convex/db/users.ts`) and the
 * same one Autumn uses as its customer id. Using anything else here would split
 * a single person into a frontend ghost and a backend ghost that never meet.
 *
 * Renders nothing; mount once inside the authenticated boundary.
 */
export function PostHogIdentify() {
  const user = useQuery(api.auth.getAuthUser);
  const identifiedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const userId = user?._id ? String(user._id) : null;

    if (userId) {
      // Re-identifying the same person on every render is wasteful and, for a
      // different person, would silently merge two accounts' events.
      if (identifiedIdRef.current === userId) return;
      identifiedIdRef.current = userId;
      posthog.identify(userId, {
        email: user?.email,
        name: user?.name,
      });
      return;
    }

    // Only reset on a real sign-out. A transition from "we had someone" to
    // "we don't". `useQuery` returns undefined while loading, and resetting on
    // that would hand every page load a brand-new anonymous id.
    if (user === null && identifiedIdRef.current !== null) {
      identifiedIdRef.current = null;
      resetPreservingConsent();
    }
  }, [user]);

  return null;
}
