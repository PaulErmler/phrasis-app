/**
 * Labels outbound mail so non-prod deployments are obvious in the inbox.
 *
 * Set per Convex deployment:
 *   pnpm exec convex env set EMAIL_ENV staging
 *   pnpm exec convex env set EMAIL_ENV test
 *
 * Leave unset (or set to `production` / `prod`) on production, no prefix.
 */

const PRODUCTION_VALUES = new Set(['', 'production', 'prod']);

/**
 * Raw EMAIL_ENV value, trimmed. Empty when unset or production-like.
 */
export function emailEnvLabel(): string | null {
  const raw = (process.env.EMAIL_ENV ?? '').trim();
  if (PRODUCTION_VALUES.has(raw.toLowerCase())) return null;
  return raw;
}

/** Display form for brackets / banners, e.g. `staging` → `Staging`. */
export function formatEmailEnvLabel(label: string): string {
  if (/^[A-Z0-9_-]+$/.test(label)) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Prefix the subject with `[Staging]` (etc.) when EMAIL_ENV is a non-prod
 * label. Production subjects are unchanged.
 */
export function withEmailEnvSubject(subject: string): string {
  const label = emailEnvLabel();
  if (!label) return subject;
  return `[${formatEmailEnvLabel(label)}] ${subject}`;
}
