'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { NewChatInput } from '@/components/chat/NewChatInput';
import { CollectionCarousel } from '@/components/app/CollectionCarousel';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';
import { Play } from 'lucide-react';

export function HomeView({
  preloadedCollectionProgress,
  preloadedCourseSettings,
}: {
  preloadedCollectionProgress: Preloaded<
    typeof api.features.decks.getCollectionProgress
  >;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
}) {
  const router = useRouter();
  const t = useTranslations('AppPage');

  return (
    <div className="app-view">
      {/* Start Learning Button */}
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={() => router.push('/app/learn')}
      >
        <Play className="h-5 w-5 fill-current" />
        {t('startLearning')}
      </Button>

      <ProgressStatsCard />

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
