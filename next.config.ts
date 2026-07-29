import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withPostHogConfig } from '@posthog/nextjs-config';
import {
  POSTHOG_ASSETS_HOST,
  POSTHOG_INGEST_HOST,
  POSTHOG_PROXY_PATH,
  POSTHOG_UI_HOST,
} from './lib/posthog/hosts';

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
  // PostHog's ingestion endpoints reject the trailing-slash redirect Next would
  // otherwise apply to the proxied paths below.
  skipTrailingSlashRedirect: true,
  /**
   * Serve PostHog from our own origin. Without this, `eu.i.posthog.com` is
   * blocked by most ad blockers and the analytics simply have a hole in them
   * shaped like the users most likely to run one.
   *
   * Assets are matched first: they live on a different origin than the event
   * API, and the catch-all below would otherwise swallow them.
   */
  async rewrites() {
    return [
      {
        source: `${POSTHOG_PROXY_PATH}/static/:path*`,
        destination: `${POSTHOG_ASSETS_HOST}/static/:path*`,
      },
      {
        source: `${POSTHOG_PROXY_PATH}/:path*`,
        destination: `${POSTHOG_INGEST_HOST}/:path*`,
      },
    ];
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

/**
 * Source-map upload for error tracking, wrapped outermost so it sees the final
 * config. Requires a personal API key, which only production-ish builds have —
 * `next dev`, CI, and anyone building without the secret must keep working, so
 * the wrapper is applied conditionally rather than being handed empty strings.
 * The cost of skipping it is minified stack traces, not a broken build.
 */
const posthogPersonalApiKey = process.env.POSTHOG_API_KEY;
const posthogProjectId = process.env.POSTHOG_PROJECT_ID;

const withSourceMapUpload = withPostHogConfig(withNextIntl(nextConfig), {
  personalApiKey: posthogPersonalApiKey ?? '',
  projectId: posthogProjectId ?? '',
  // The CLI talks to the app/API origin (`eu.posthog.com`), not the
  // ingestion origin (`eu.i.posthog.com`) the browser posts events to.
  host: POSTHOG_UI_HOST,
  sourcemaps: {
    enabled: Boolean(posthogPersonalApiKey && posthogProjectId),
    releaseName: 'flexling',
    // Ties each uploaded map to the deploy that produced it, using the same
    // build identity AppUpdateGate compares. Without it every release
    // overwrites the last, and old sessions resolve against new maps.
    releaseVersion: buildId,
    // The maps are uploaded, not served: leaving them in the bundle would hand
    // anyone the unminified source for free.
    deleteAfterUpload: true,
  },
});

/**
 * Next accepts either a config object or a factory; `withPostHogConfig` returns
 * a factory, so normalize before wrapping.
 */
type NextConfigInput =
  | NextConfig
  | ((phase: string, ctx: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>);

/**
 * Make source-map upload non-fatal.
 *
 * `@posthog/nextjs-config` installs `compiler.runAfterProductionCompile` and
 * lets `processSourceMaps` throw straight through it, so any hiccup reaching
 * PostHog's S3 bucket — an outage, a firewalled CI runner, a laptop offline —
 * fails `next build` outright. Losing readable stack traces for one release is
 * an acceptable degradation; losing the ability to deploy is not.
 *
 * The wrapper preserves the hook's real work and only swallows its failure.
 */
function makeSourceMapUploadNonFatal(input: NextConfigInput): NextConfigInput {
  return async (phase, ctx) => {
    const resolved = typeof input === 'function' ? await input(phase, ctx) : input;
    const upload = resolved.compiler?.runAfterProductionCompile;
    if (!upload) return resolved;

    return {
      ...resolved,
      compiler: {
        ...resolved.compiler,
        runAfterProductionCompile: async (compileCtx: {
          projectDir: string;
          distDir: string;
        }) => {
          try {
            await upload(compileCtx);
          } catch (error) {
            console.warn(
              '[posthog] Source map upload failed — continuing the build. ' +
                'Stack traces for this release will stay minified.',
              error instanceof Error ? error.message : error,
            );
          }
        },
      },
    };
  };
}

export default makeSourceMapUploadNonFatal(withSourceMapUpload);
