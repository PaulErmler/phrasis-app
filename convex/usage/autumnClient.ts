/**
 * Shared basics for the modules that call the Autumn REST API directly
 * (usage/tracking.ts, billing.ts, usage/testing.ts).
 *
 * Deliberately minimal — no shared fetch wrapper and, above all, NO shared
 * `x-api-version`: the version stays a per-call concern because the callers
 * intentionally pin different families (tracking pins '2.2'; billing pins
 * '1.2'/'2.1.0'; testing pins '1.2') and the customer payload SHAPE differs
 * between them (see the AUTUMN_API_VERSION comment in usage/tracking.ts).
 *
 * No `"use node"` here on purpose: usage/testing.ts also exports queries and
 * mutations, which must stay in the default runtime, so this module has to be
 * importable from both runtimes.
 */

export const AUTUMN_API = 'https://api.useautumn.com/v1';

export function getSecretKey(): string {
  const key = process.env.AUTUMN_SECRET_KEY;
  if (!key) throw new Error('AUTUMN_SECRET_KEY environment variable is not set');
  return key;
}
