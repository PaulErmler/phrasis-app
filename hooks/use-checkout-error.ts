'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { reportError } from '@/lib/report-error';

/**
 * Shared error surfacing for the billing entry points (pricing table,
 * paywall/low-quota dialogs, checkout dialog).
 *
 * Two failure shapes exist and BOTH must become visible:
 *
 * - Thrown errors. Convex actions rejected server-side (trial gate,
 *   stale-client guard, injected e2e failures, network).
 * - `{ error }` containers: autumn-js wraps SDK/action failures into a
 *   return value instead of throwing (`wrapSdkCall`), so a plain `await
 *   checkout(...)` "succeeds" while nothing happened. Before this helper
 *   existed, that path closed dialogs silently: the user saw no feedback
 *   at all.
 */

/** Throw when an autumn-js call reported failure via its result container. */
export function throwOnCheckoutError(result: unknown): void {
  const error = (result as { error?: { message?: string } | null } | null)
    ?.error;
  if (error) throw new Error(error.message ?? 'Checkout failed');
}

/**
 * Returns a handler that reports the error and shows the user the standard
 * "your plan was not changed" toast (Checkout.confirmError).
 */
export function useCheckoutErrorToast() {
  const t = useTranslations('Checkout');
  return (e: unknown, op: string) => {
    reportError(e, { op });
    toast.error(t('confirmError'));
  };
}
