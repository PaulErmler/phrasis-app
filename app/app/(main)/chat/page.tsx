'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useChatPrefetch } from '@/components/app/AppWarmup';
import { AppLoadingSplash } from '@/components/LogoSpinner';

/**
 * /app/chat without a thread id (deep links): resolve to a concrete thread —
 * the prefetched empty one when available, else a fresh one — and replace
 * the URL so history holds the canonical /app/chat/[threadId].
 */
export default function ChatIndexPage() {
  const router = useRouter();
  const { consumeThread } = useChatPrefetch();
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const prefetched = consumeThread();
    if (prefetched) {
      router.replace(`/app/chat/${prefetched}`);
      return;
    }
    getOrCreateEmptyThread({})
      .then((threadId) => router.replace(`/app/chat/${threadId}`))
      .catch((err) => {
        console.error('Failed to open chat:', err);
        router.replace('/app');
      });
  }, [consumeThread, getOrCreateEmptyThread, router]);

  return <AppLoadingSplash />;
}
