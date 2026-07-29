import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const securityHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(self), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

/**
 * Identity of this build, inlined into both the client bundle (via `env` below)
 * and the prerendered /api/version response — the two sides AppUpdateGate
 * compares, which must never drift apart.
 *
 * Read from a file rather than resolved here, because Next re-evaluates this
 * config in its static-generation workers: anything computed inline can produce
 * a different value for the client bundle than for the prerendered route, and
 * that mismatch tells every user their app is out of date on a deployment that
 * never changed. `scripts/build-id.mjs` resolves it once before `next build` and
 * every read here hits the same bytes.
 *
 * Absent file means `next dev`, which doesn't run the script. Both sides then
 * resolve to 'dev' and the app never reports an update to itself.
 */
function readBuildId(): { buildId: string; source: string } {
  try {
    const raw = readFileSync(join(process.cwd(), '.build-id.json'), 'utf8');
    const parsed = JSON.parse(raw) as { buildId?: unknown; source?: unknown };
    if (typeof parsed.buildId !== 'string' || !parsed.buildId) {
      throw new Error('malformed .build-id.json');
    }
    return {
      buildId: parsed.buildId,
      source: typeof parsed.source === 'string' ? parsed.source : 'file',
    };
  } catch {
    return { buildId: 'dev', source: 'fallback' };
  }
}

const { buildId, source: buildIdSource } = readBuildId();

// A production build that never ran the script leaves AppUpdateGate comparing
// 'dev' to 'dev' forever, which is invisible at runtime — so say so here.
if (buildIdSource === 'fallback' && process.env.NODE_ENV === 'production') {
  console.warn(
    '[build-id] No .build-id.json — update detection is disabled for this ' +
      'build. `next build` must run via `pnpm build` so scripts/build-id.mjs ' +
      'writes it first.',
  );
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_BUILD_ID_SOURCE: buildIdSource,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/version',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
