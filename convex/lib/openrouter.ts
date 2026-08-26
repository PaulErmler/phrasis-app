import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_USAGE_ACCOUNTING } from '../config/aiModels';

/**
 * The one place OPENROUTER_API_KEY becomes an OpenRouter provider, so the
 * missing-key behavior can't drift between call sites. Usage accounting is
 * on by default: every metered path wants OpenRouter to report the actual
 * USD cost of the call.
 *
 * Call from inside a handler, not at module scope — a module-scope throw
 * on a key-less deployment would fail analysis for every function in the
 * file (which is why chat/agent.ts builds its module-scope provider
 * directly and relies on the SDK's lazy key loading).
 */
export function getOpenRouter(
  extraBody: Record<string, unknown> = OPENROUTER_USAGE_ACCOUNTING,
): ReturnType<typeof createOpenRouter> {
  const provider = tryGetOpenRouter(extraBody);
  if (!provider) {
    throw new Error(
      'OPENROUTER_API_KEY is not set (configure it in the Convex deployment env)',
    );
  }
  return provider;
}

/**
 * Like `getOpenRouter`, but returns null when the key is missing, for
 * callers with a structured degradation path (e.g. translationLLM's
 * Google Translate fallback).
 */
export function tryGetOpenRouter(
  extraBody: Record<string, unknown> = OPENROUTER_USAGE_ACCOUNTING,
): ReturnType<typeof createOpenRouter> | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return createOpenRouter({ apiKey, extraBody });
}
