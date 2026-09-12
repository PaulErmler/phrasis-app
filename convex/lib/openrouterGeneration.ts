/**
 * Read back the real billed cost of an OpenRouter generation.
 *
 * Most OpenRouter paths never need this: the AI SDK calls set
 * `usage: { include: true }` and get the charge inline on `providerMetadata`
 * (see `openrouterCostUsd` in ./posthogAi.ts). The speech endpoint
 * (`/audio/speech`) returns audio bytes and no usage block, so the only way to
 * learn what a clip cost is to keep the `x-generation-id` header off the
 * response and ask the stats endpoint afterwards.
 *
 * Proven in scripts/story-prototype.ts before it was wired into the pipeline.
 */
import { retryDelayMs } from './httpRetry';
import { optionalEnv } from './env';

const ENDPOINT = 'https://openrouter.ai/api/v1/generation';

/**
 * The stats row is written asynchronously, a moment after the response the id
 * came from, so a lookup that arrives too early 404s. Three attempts with the
 * shared backoff (1s, 2s) covers that lag.
 */
const MAX_ATTEMPTS = 3;

/**
 * Worth retrying. 404 is in the set here (and not in `isRetryableStatus`,
 * which is about POSTing work) because on THIS endpoint it means "the row has
 * not landed yet" rather than "no such generation".
 */
function isRetryableLookupStatus(status: number): boolean {
  return status === 404 || status === 429 || status >= 500;
}

/** Billed USD for one generation id, or undefined if it never priced. */
async function costForId(
  apiKey: string,
  id: string,
): Promise<number | undefined> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      // A cost lookup must never be the reason a clip fails. Losing the figure
      // is recorded by the caller as an unpriced id.
      console.warn(`[openrouterGeneration] lookup failed for ${id}:`, err);
      return undefined;
    }
    if (!response.ok) {
      if (!isRetryableLookupStatus(response.status)) return undefined;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs(response, attempt)),
        );
      }
      continue;
    }
    // Untrusted body: narrow before use rather than trusting the shape.
    const raw: unknown = await response.json().catch(() => undefined);
    const data =
      typeof raw === 'object' && raw !== null && 'data' in raw
        ? (raw as { data?: unknown }).data
        : undefined;
    const cost =
      typeof data === 'object' && data !== null && 'total_cost' in data
        ? (data as { total_cost?: unknown }).total_cost
        : undefined;
    if (typeof cost === 'number' && Number.isFinite(cost)) return cost;
    // A 200 with no usable `total_cost` is the row mid-write; retry.
  }
  return undefined;
}

/**
 * Total billed USD across `ids`.
 *
 * `pricedIds` is how many of them actually returned a figure, so a caller can
 * tell a complete sum from a partial one. A partial sum reported as if it were
 * whole reads as a cost drop, which is worse than no number at all — that is
 * why this reports the count instead of silently summing what it got. Same
 * convention as `priced_calls` on the translation events.
 */
export async function generationCostUsd(
  ids: readonly string[],
): Promise<{ costUsd: number | undefined; pricedIds: number }> {
  if (ids.length === 0) return { costUsd: undefined, pricedIds: 0 };
  const apiKey = optionalEnv('OPENROUTER_API_KEY');
  if (!apiKey) return { costUsd: undefined, pricedIds: 0 };

  // At most a handful of ids (one per billed request for a single clip), so
  // the lookups run in parallel rather than serialising their backoffs.
  const costs = await Promise.all(ids.map((id) => costForId(apiKey, id)));
  const priced = costs.filter((c): c is number => c !== undefined);
  return {
    costUsd:
      priced.length > 0 ? priced.reduce((sum, c) => sum + c, 0) : undefined,
    pricedIds: priced.length,
  };
}
