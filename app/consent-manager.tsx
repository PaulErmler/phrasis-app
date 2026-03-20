import type { ReactNode } from 'react';
import {
  ConsentManagerDialog,
  ConsentManagerProvider,
  CookieBanner,
} from '@c15t/nextjs';
import { ConsentManagerClient } from './consent-manager.client';

/**
 * Server-side rendered consent management wrapper for Next.js App Router
 *
 * This component provides SSR-compatible consent management by separating
 * server-side configuration from client-side functionality. The server handles
 * initial setup and configuration, while client-side features (callbacks,
 * scripts) are delegated to the ConsentManagerClient component.
 *
 * @param props - Component properties
 * @param props.children - Child components to render within the consent manager context
 *
 * @returns The consent manager provider with banner, dialog, and client wrapper
 *
 * @remarks
 * This split architecture is necessary because certain options like callbacks
 * and scripts cannot be serialized during server-side rendering. For
 * client-only implementations, use `<ConsentManagerProvider />` from
 * `@c15t/nextjs/client`.
 *
 * @example
 * ```tsx
 * // In your root layout.tsx
 * import { ConsentManager } from './consent-manager';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <ConsentManager>
 *           {children}
 *         </ConsentManager>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
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
