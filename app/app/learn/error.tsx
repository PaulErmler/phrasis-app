'use client';

import { ViewErrorFallback } from '@/components/app/ViewErrorFallback';

export default function LearnError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ViewErrorFallback {...props} />;
}
