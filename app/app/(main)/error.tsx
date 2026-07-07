'use client';

import { ViewErrorFallback } from '@/components/app/ViewErrorFallback';

/**
 * Catches errors from the tab pages (home/library/stats/settings/chat/…).
 * Renders inside the (main) layout, so header and bottom nav survive and
 * the user can retry or switch tabs.
 */
export default function MainSegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ViewErrorFallback {...props} />;
}
