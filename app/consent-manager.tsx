import type { ReactNode } from 'react';
import {
  ConsentManagerDialog,
  ConsentManagerProvider,
  CookieBanner,
} from '@c15t/nextjs';
import { ConsentManagerClient } from './consent-manager.client';

/**
 * SSR-rendered consent management wrapper (Next.js App Router). Split in two
 * because options like callbacks and scripts cannot be serialized during
 * server-side rendering — the serializable configuration lives here, and the
 * non-serializable parts are delegated to `ConsentManagerClient`.
 */
export function ConsentManager({ children }: { children: ReactNode }) {
  return (
    <ConsentManagerProvider
      options={{
        mode: 'offline',
        consentCategories: ['necessary'],
      }}
    >
      <CookieBanner />
      <ConsentManagerDialog />
      <ConsentManagerClient>{children}</ConsentManagerClient>
    </ConsentManagerProvider>
  );
}
