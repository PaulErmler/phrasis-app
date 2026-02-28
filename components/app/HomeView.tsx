'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { NewChatInput } from '@/components/chat/NewChatInput';
import { CollectionCarousel } from '@/components/app/CollectionCarousel';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';

export function HomeView({
  preloadedCollectionProgress,
  preloadedCourseSettings,
  preloadedCourseStats,
}: {
  preloadedCollectionProgress: Preloaded<
    typeof api.features.decks.getCollectionProgress
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedCourseStats: Preloaded<
    typeof api.features.courses.getCourseStats
  >;
}) {
  const router = useRouter();
  const t = useTranslations('AppPage');
  const [isNavigating, setIsNavigating] = useState(false);

  const handleStartLearning = () => {
    setIsNavigating(true);
    router.push('/app/learn');
  };

  return (
    <div className="app-view">
      <ProgressStatsCard
        preloadedCourseStats={preloadedCourseStats}
        onStartLearning={handleStartLearning}
        isNavigating={isNavigating}
      />

      {/* Collection Carousel - Select difficulty and add cards */}
      <div className="space-y-2">
        <h2 className="heading-section">
          {t('collections.carousel.sectionTitle')}
        </h2>
        <CollectionCarousel
          preloadedCollectionProgress={preloadedCollectionProgress}
          preloadedCourseSettings={preloadedCourseSettings}
        />
      </div>

      {/* Chat */}
      <NewChatInput showSuggestions={false} />
    </div>
  );
}
