'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import type { PropsWithChildren } from 'react';

import { AppLoadingSplash } from '@/components/LogoSpinner';

function UnauthRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/auth/sign-in');
  }, [router]);
  return null;
}

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  return (
    <>
      <AuthLoading>
        <div className="flex min-h-screen flex-col items-center justify-center bg-background">
          <AppLoadingSplash />
        </div>
      </AuthLoading>
      <Authenticated>
        {children}
      </Authenticated>
      <Unauthenticated>
        <UnauthRedirect />
      </Unauthenticated>
    </>
  );
}
