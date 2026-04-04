'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import type { PropsWithChildren } from 'react';

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
        <div className="h-dvh" />
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
