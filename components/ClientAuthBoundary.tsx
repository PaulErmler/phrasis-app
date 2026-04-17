'use client';

import { useEffect, type PropsWithChildren } from 'react';
import { useRouter } from 'next/navigation';
import { AuthLoading, Authenticated, Unauthenticated } from 'convex/react';

import { AppLoadingSplash } from '@/components/LogoSpinner';

function RedirectToSignIn() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/auth/sign-in');
  }, [router]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <AppLoadingSplash />
    </div>
  );
}

export function ClientAuthBoundary({ children }: PropsWithChildren) {
  return (
    <>
      <AuthLoading>
        <div className="flex min-h-screen flex-col items-center justify-center bg-background">
          <AppLoadingSplash />
        </div>
      </AuthLoading>
      <Authenticated>{children}</Authenticated>
      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>
    </>
  );
}
