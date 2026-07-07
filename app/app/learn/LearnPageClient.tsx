'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LearnView } from '@/components/app/learning/LearnView';
import { useChatPrefetch, useNavigateToChat } from '@/components/app/AppWarmup';
import { useInAppBack } from '@/hooks/use-in-app-back';
import { setReturningFromLearnFlag } from '@/lib/navigationFlags';

export function LearnPageClient() {
  const router = useRouter();
  const { prefetchedThreadId, refreshPrefetchedThread } = useChatPrefetch();
  const navigateToChat = useNavigateToChat();
  const inAppBack = useInAppBack();

  // The in-learn chat may have consumed the prefetched thread; refresh on
  // exit so the next chat entry gets an empty one (parity with the old
  // shell's refresh-on-learn-close).
  useEffect(() => () => refreshPrefetchedThread(), [refreshPrefetchedThread]);

  const handleBack = useCallback(() => {
    // Tells the home page to play its entrance animation on return.
    setReturningFromLearnFlag();
    inAppBack();
  }, [inAppBack]);

  return (
    <LearnView
      onBack={handleBack}
      prefetchedThreadId={prefetchedThreadId ?? undefined}
      onNavigateToChat={navigateToChat}
      onNavigateToAddCustomCards={() => router.push('/app/content/add-cards')}
    />
  );
}
