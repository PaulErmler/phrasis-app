'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePreloadedQuery } from 'convex/react';
import { HomeView } from '@/components/app/HomeView';
import { useAppData } from '@/components/app/AppDataProvider';
import { useMainShell } from '@/components/app/MainShellContext';
import { useNavigateToChat } from '@/components/app/AppWarmup';
import { consumeReturningFromLearnFlag } from '@/lib/navigationFlags';

export default function HomePage() {
  const router = useRouter();
  const { preloadedCourseSettings, preloadedActiveCourse } = useAppData();
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);
  const { openCourseMenu, registerTutorialRestart } = useMainShell();
  const navigateToChat = useNavigateToChat();

  // Set by the learn page's back handler; read after mount to avoid a
  // hydration mismatch (sessionStorage doesn't exist on the server).
  const [animateEntrance, setAnimateEntrance] = useState(false);
  useEffect(() => {
    if (consumeReturningFromLearnFlag()) setAnimateEntrance(true);
  }, []);

  const handleLearnOpen = useCallback(() => {
    router.push('/app/learn');
  }, [router]);

  const handleChatOpen = useCallback(
    (threadId: string) => {
      router.push(`/app/chat/${threadId}`);
    },
    [router],
  );

  const handleNavigateToAddCards = useCallback(() => {
    router.push('/app/content/add-cards');
  }, [router]);

  return (
    <HomeView
      preloadedCourseSettings={preloadedCourseSettings}
      onLearnOpen={handleLearnOpen}
      onChatOpen={handleChatOpen}
      onNavigateToContent={handleNavigateToAddCards}
      onNavigateToChat={navigateToChat}
      onEnterTexts={handleNavigateToAddCards}
      onTutorialReady={registerTutorialRestart}
      animateEntrance={animateEntrance}
      hasActiveCourse={!!activeCourse}
      onOpenCourseMenu={openCourseMenu}
    />
  );
}
