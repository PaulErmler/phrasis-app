'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AuthRefresh() {
  const router = useRouter();

  useEffect(() => {
    const url = new URL(window.location.href);
    const retries = parseInt(url.searchParams.get('auth_retry') || '0', 10);

    if (retries >= 2) {
      // Session cookie is stale — redirect to sign-in
      router.replace('/auth/sign-in');
      return;
    }

    url.searchParams.set('auth_retry', String(retries + 1));
    window.location.replace(url.toString());
  }, [router]);

  return <div className="h-dvh" />;
}
