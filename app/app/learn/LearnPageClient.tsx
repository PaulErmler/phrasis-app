'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { LearnView } from '@/components/app/learning/LearnView';

import { reportError } from '@/lib/report-error';

export function LearnPageClient() {
  const router = useRouter();
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );

  // Standalone learn page is rendered outside the (main) layout, so it has
  // no in-app chat overlay to fall back on. Create / fetch a thread, then
  // push directly to the chat route. The main layout picks the thread up
  // via `viewFromPathname` and renders the chat view.
  const handleNavigateToChat = useCallback(async () => {
    try {
      const threadId = await getOrCreateEmptyThread({});
      router.push(`/app/chat/${threadId}`);
    } catch (err) {
      reportError(err, { op: 'openChatFromLearn' });
      router.push('/app');
    }
  }, [getOrCreateEmptyThread, router]);

  return (
    <LearnView
      onBack={() => router.push('/app')}
      onNavigateToChat={handleNavigateToChat}
      onNavigateToAddCustomCards={() => router.push('/app/content/add-cards')}
    />
  );
}
