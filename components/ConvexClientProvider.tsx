'use client';

import { ReactNode } from 'react';
import { ConvexReactClient } from 'convex/react';
import { authClient } from '@/lib/auth-client';
import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from '@convex-dev/better-auth/react';
import { env } from '@/lib/env';

const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

export function ConvexClientProvider({
  children,
  initialToken,
}: {
  children: ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ConvexBetterAuthProvider
      client={convex}
      // Cast: see ClientAuthBoundary — 0.12.5's AuthClient type is not
      // satisfiable under better-auth 1.6.23.
      authClient={authClient as unknown as AuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
