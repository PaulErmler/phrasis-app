/**
 * Shared basics for the modules that call the Autumn REST API directly
 * (usage/tracking.ts, billing.ts, usage/testing.ts, autumn.ts).
 *
 * NO shared `x-api-version`: the version stays a REQUIRED per-call argument
 * because the callers intentionally pin different families (tracking pins
 * '2.2'; billing pins '1.2'/'2.1.0'; testing pins '1.2') and the customer
 * payload SHAPE differs between them (see the AUTUMN_API_VERSION comment in
 * usage/tracking.ts).
 *
 * No `"use node"` here on purpose: usage/testing.ts also exports queries and
 * mutations, which must stay in the default runtime, and convex/autumn.ts
 * runs in the default runtime too, so this module has to be importable from
 * both runtimes.
 */

export const AUTUMN_API = 'https://api.useautumn.com/v1';

export function getSecretKey(): string {
  const key = process.env.AUTUMN_SECRET_KEY;
  if (!key) throw new Error('AUTUMN_SECRET_KEY environment variable is not set');
  return key;
}

export interface AutumnRawResponse {
  ok: boolean;
  status: number;
  /** Parsed JSON body; the raw text when the body isn't JSON. */
  json: unknown;
  text: string;
}

/**
 * Low-level Autumn call. Never throws on HTTP errors. Callers own the
 * policy (billing throws, convex/autumn.ts wraps failures in the
 * `{ data, error }` container autumn-js expects, the trial gate treats 404
 * as "customer not created yet").
 */
export async function autumnFetchRaw(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  apiVersion: string,
): Promise<AutumnRawResponse> {
  const res = await fetch(`${AUTUMN_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
      'x-api-version': apiVersion,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json, text };
}

export async function autumnFetch<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  apiVersion: string,
): Promise<T>;
export async function autumnFetch<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  apiVersion: string,
  opts: { nullOn404: true },
): Promise<T | null>;
/**
 * Autumn call that throws on any non-2xx (after logging the body). Pass
 * `{ nullOn404: true }` to get `null` for a 404 instead. The "customer /
 * resource not created yet" reading.
 */
export async function autumnFetch<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  apiVersion: string,
  opts?: { nullOn404?: boolean },
): Promise<T | null> {
  const raw = await autumnFetchRaw(method, path, body, apiVersion);
  if (opts?.nullOn404 && raw.status === 404) return null;
  if (!raw.ok) {
    console.error(`Autumn ${method} ${path} failed (${raw.status}): ${raw.text}`);
    const err = raw.json as { message?: string; code?: string } | null;
    throw new Error(
      `Autumn request failed: ${err?.message ?? err?.code ?? raw.status}`,
    );
  }
  return raw.json as T;
}
