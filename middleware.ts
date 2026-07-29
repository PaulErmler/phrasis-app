import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

import { POSTHOG_PROXY_PATH } from '@/lib/posthog/hosts';

export async function middleware(request: NextRequest) {
  /**
   * The PostHog proxy (`rewrites` in next.config.ts) makes every ingestion
   * request same-origin, so the browser attaches all first-party cookies —
   * including the Better Auth session token — and Next's rewrite proxy would
   * forward them verbatim to PostHog. Strip the header here, before the
   * rewrite runs, so session tokens never leave our origin.
   */
  if (request.nextUrl.pathname.startsWith(POSTHOG_PROXY_PATH)) {
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    return NextResponse.next({ request: { headers } });
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Next requires this to be statically analyzable, so the second entry
  // hardcodes POSTHOG_PROXY_PATH from lib/posthog/hosts.ts.
  matcher: ['/app/:path*', '/ph-relay/:path*'],
};
