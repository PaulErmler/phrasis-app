'use client';

import type { ReactNode } from 'react';
import { ClientSideOptionsProvider } from '@c15t/nextjs/client';

/**
 * Client half of the consent manager: hosts the non-serializable options
 * (consent-gated `scripts` and client-side `callbacks`) that the
 * server-rendered `ConsentManager` cannot pass through SSR. Both are empty
 * today — no script or callback is consent-gated; this wrapper exists so
 * future integrations have a place to plug in.
 *
 * @see https://c15t.com/docs/frameworks/next/callbacks
 * @see https://c15t.com/docs/frameworks/next/script-loader
 */
export function ConsentManagerClient({ children }: { children: ReactNode }) {
  return (
    <ClientSideOptionsProvider scripts={[]} callbacks={{}}>
      {children}
    </ClientSideOptionsProvider>
  );
}
