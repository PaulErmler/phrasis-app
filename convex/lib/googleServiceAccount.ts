/**
 * Google service-account OAuth2: parse a key, mint a scoped access token.
 *
 * Shared by Cloud Translation v3 romanization (features/translation.ts) and FCM
 * push delivery (features/notificationDelivery.ts). Extracted when the second
 * caller appeared — two hand-rolled copies of JWT-bearer token exchange is
 * exactly the kind of duplication that drifts.
 *
 * Each caller brings its own env var rather than sharing one key: the
 * translation credentials belong to a Cloud Translation project and the push
 * credentials to a Firebase project, which are generally different projects with
 * independent rotation. The token cache is keyed by (env var, scope) so they
 * never hand each other the wrong token.
 *
 * No `"use node"` — `fetch` and `jose` both work in the default Convex runtime,
 * and adding it would bar this module from being imported by queries or
 * mutations.
 */

import { SignJWT, importPKCS8 } from 'jose';

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  /** Doubles as the FCM project id — the v1 send endpoint is per project. */
  project_id: string;
}

/**
 * Parse a service-account key from an env var value.
 *
 * Accepts raw JSON or base64-encoded JSON, because pasting a multi-line PEM
 * through a dashboard field is error-prone and base64 sidesteps it.
 */
export function parseServiceAccountKey(
  raw: string | undefined,
  envName: string,
): ServiceAccountCredentials {
  if (!raw) throw new Error(`${envName} not configured`);
  const json = raw.trimStart().startsWith('{') ? raw : atob(raw);
  const parsed = JSON.parse(json) as Partial<ServiceAccountCredentials>;
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error(
      `${envName} is missing client_email, private_key or project_id`,
    );
  }
  return parsed as ServiceAccountCredentials;
}

type CacheEntry = { token: string; projectId: string; expiresAt: number };
const tokenCache = new Map<string, CacheEntry>();

/**
 * Exchange a service-account JWT for a scoped access token.
 *
 * Google issues these with an hour's life; the cache deliberately expires after
 * four minutes, well short of that, so a clock skew or an early revocation
 * costs one extra exchange rather than an hour of 401s. The cache is
 * module-level, so it lives as long as the runtime isolate and is a pure
 * optimization — a cold isolate just mints a new one.
 */
export async function getServiceAccountAccessToken(opts: {
  raw: string | undefined;
  envName: string;
  scope: string;
}): Promise<{ token: string; projectId: string }> {
  const cacheKey = `${opts.envName} ${opts.scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { token: cached.token, projectId: cached.projectId };
  }

  const creds = parseServiceAccountKey(opts.raw, opts.envName);
  // Support keys pasted with literal "\n" escapes as well as real newlines —
  // same accommodation as APPLE_PRIVATE_KEY in convex/auth.ts.
  const privateKey = await importPKCS8(
    creds.private_key.replace(/\\n/g, '\n'),
    'RS256',
  );
  const jwt = await new SignJWT({ scope: opts.scope })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(creds.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    )}&assertion=${jwt}`,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Service account token exchange failed: ${response.status} - ${text}`,
    );
  }
  const data = (await response.json()) as { access_token: string };

  tokenCache.set(cacheKey, {
    token: data.access_token,
    projectId: creds.project_id,
    expiresAt: Date.now() + 4 * 60 * 1000,
  });

  return { token: data.access_token, projectId: creds.project_id };
}
