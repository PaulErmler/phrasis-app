import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ConvexError } from 'convex/values';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isAuthError = (error: unknown) => {
  // Structured convention: ConvexError with { code: 'UNAUTHENTICATED' }.
  if (convexErrorCode(error) === 'UNAUTHENTICATED') return true;
  // Legacy bare-string payloads/messages, kept for backends not yet on the
  // structured code.
  const message =
    (error instanceof ConvexError && typeof error.data === 'string' && error.data) ||
    (error instanceof Error && error.message) ||
    '';
  return message === 'Unauthenticated' || message === 'Not authenticated';
};

/**
 * The human-readable text a `ConvexError` carries in a plain-string `data`
 * payload. Prefer this over `error.message` when toasting a server error:
 * `message` arrives on the client wrapped as
 * `"[Request ID: …] Server Error\nUncaught ConvexError: …"`. Returns
 * `undefined` for anything else, so call sites can fall back to their own
 * localized copy.
 */
export const convexErrorMessage = (error: unknown): string | undefined =>
  error instanceof ConvexError && typeof error.data === 'string'
    ? error.data
    : undefined;

/**
 * Extracts the `code` field from a `ConvexError`'s structured data payload.
 * Returns `undefined` for non-ConvexErrors and for ConvexErrors whose data
 * is a plain string (or otherwise lacks a `code` field).
 */
export const convexErrorCode = (error: unknown): string | undefined =>
  error instanceof ConvexError
    ? (error.data as { code?: string })?.code
    : undefined;

/**
 * True when a mutation was rejected by the server-side payment gate
 * (`assertBillingCurrent` → ConvexError code PAYMENT_PAST_DUE). Handlers
 * swallow this SILENTLY: the error can only occur when `pastDueSince` is
 * already on the quota doc, so the reactive `getMyQuotas` subscription that
 * mounts the payment-overdue dialog is already in flight. A generic error
 * toast or the USAGE_LIMIT upgrade paywall would just flash the wrong
 * surface underneath the block.
 */
export const isPaymentPastDueError = (error: unknown): boolean =>
  convexErrorCode(error) === 'PAYMENT_PAST_DUE';

/** Escape a literal string for embedding in a RegExp source. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
