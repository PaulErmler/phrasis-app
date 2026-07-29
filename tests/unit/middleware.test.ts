import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { config, middleware } from '@/middleware';
import { POSTHOG_PROXY_PATH } from '@/lib/posthog/hosts';

function relayRequest(path = `${POSTHOG_PROXY_PATH}/e/`): NextRequest {
  return new NextRequest(`https://flexling.app${path}`, {
    headers: {
      cookie: 'better-auth.session_token=secret; ph_phc_abc_posthog=%7B%7D',
      'content-type': 'application/json',
    },
  });
}

/**
 * Regression test for the session-token leak: `/ph-relay` requests are
 * same-origin, so the browser attaches the Better Auth session cookie, and
 * Next's rewrite proxy forwards request headers verbatim to PostHog. The
 * middleware must strip `cookie` before the rewrite runs.
 *
 * `NextResponse.next({ request: { headers } })` encodes the surviving headers
 * as `x-middleware-override-headers` (the allowlist — everything absent is
 * deleted by the router) plus one `x-middleware-request-*` entry per header,
 * which is what these assertions read.
 */
describe('middleware: PostHog proxy cookie stripping', () => {
  it('keeps the hardcoded matcher entry in sync with POSTHOG_PROXY_PATH', () => {
    // Next requires `config.matcher` to be statically analyzable, so
    // middleware.ts hardcodes the path; this pins it to the constant everything
    // else derives from.
    expect(config.matcher).toContain(`${POSTHOG_PROXY_PATH}/:path*`);
  });


  it('strips the cookie header from ph-relay requests', async () => {
    const res = await middleware(relayRequest());

    const overridden = res.headers.get('x-middleware-override-headers');
    expect(overridden).not.toBeNull();
    expect(overridden!.split(',').map((h) => h.trim())).not.toContain('cookie');
    expect(res.headers.get('x-middleware-request-cookie')).toBeNull();
  });

  it('keeps the headers PostHog needs', async () => {
    const res = await middleware(relayRequest());

    expect(res.headers.get('x-middleware-request-content-type')).toBe('application/json');
  });

  it('continues rather than redirecting, even without a session', async () => {
    const res = await middleware(relayRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still redirects unauthenticated /app requests to sign-in', async () => {
    const res = await middleware(new NextRequest('https://flexling.app/app/home'));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toContain('/auth/sign-in');
  });
});
