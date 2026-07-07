'use client';

import { ViewErrorFallback } from '@/components/app/ViewErrorFallback';

/**
 * Catches errors thrown by the (main) layout itself (header queries etc.) —
 * a segment's own error.tsx can't do that, only a parent's can. The shell is
 * lost but the app-level providers survive, which beats unwinding all the
 * way to the root error page.
 */
export default function AppSegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ViewErrorFallback {...props} />;
}
