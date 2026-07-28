import { execSync } from 'node:child_process';
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
 * Identity of this build, resolved once and inlined into both the client bundle
 * (via `env` below) and the prerendered /api/version response — so the two sides
 * compared by AppUpdateGate can never drift apart.
 *
 * Each host names its commit SHA differently: `SOURCE_COMMIT` on Coolify,
 * `VERCEL_GIT_COMMIT_SHA` on Vercel. Neither is reliably present — Coolify only
 * populates its variable for some source types — so the last resort before
 * giving up is asking git directly, which works on any host that builds from a
 * clone. `BUILD_ID` comes first as a manual override, both for hosts that
 * provide nothing and for forcing a new identity out of a rebuild of an
 * unchanged commit.
 *
 * Matched on truthiness rather than `??`: a host that sets its variable to the
 * empty string (Coolify does, for non-git sources) would otherwise pass it
 * straight through as the build id and silently disable update detection.
 *
 * Every source here is deterministic on purpose. A timestamp would be tempting —
 * it would give same-commit rebuilds a fresh identity — but Next re-evaluates
 * this file in its static-generation workers, so the two sides could resolve
 * different values and announce an update on a deployment that never changed.
 */
const BUILD_ID_SOURCES = [
  ['BUILD_ID', process.env.BUILD_ID],
  ['SOURCE_COMMIT', process.env.SOURCE_COMMIT],
  ['VERCEL_GIT_COMMIT_SHA', process.env.VERCEL_GIT_COMMIT_SHA],
  ['VERCEL_DEPLOYMENT_ID', process.env.VERCEL_DEPLOYMENT_ID],
] as const;

/** The checked-out commit, for hosts that build from a clone but announce nothing. */
function gitCommit(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // No .git in the build context, or no git binary in the image. Neither is
    // recoverable here, so fall through to the warning below.
    return undefined;
  }
}

const hostBuildId = BUILD_ID_SOURCES.find(([, value]) => value);
const gitBuildId = hostBuildId ? undefined : gitCommit();

const buildId = hostBuildId?.[1] ?? gitBuildId ?? 'dev';
const buildIdSource = hostBuildId?.[0] ?? (gitBuildId ? 'git' : 'fallback');

// Falling back means AppUpdateGate compares 'dev' to 'dev' forever and no user
// ever gets off a stale bundle. That failure is invisible at runtime, so it has
// to be loud here — and listing the candidates makes it obvious which variable a
// new host actually provides.
//
// Deliberately not gated on a build-vs-serve check: `NEXT_PHASE` is undefined in
// Next 16, and every other signal is guesswork. This file is cheap to log from
// and the line is worth having in both the build log and the container log.
if (buildIdSource === 'fallback' && process.env.NODE_ENV === 'production') {
  console.warn(
    '[build-id] No deploy identity resolved — update detection is disabled ' +
      'for this build. Set BUILD_ID. Candidates seen: ' +
      BUILD_ID_SOURCES.map(([key, value]) => `${key}=${value ?? '<unset>'}`).join(
        ' ',
      ) +
      ' git=<unavailable>',
  );
} else {
  console.log(`[build-id] ${buildId} (from ${buildIdSource})`);
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
