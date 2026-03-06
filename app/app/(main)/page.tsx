'use client';

import { HomeView } from '@/components/app/HomeView';
import { useAppData } from '@/components/app/AppDataProvider';

export default function HomePage() {
  const {
    preloadedCollectionProgress,
    preloadedCourseSettings,
    preloadedCourseStats,
    preloadedCustomCollectionsProgress,
  } = useAppData();

  return (
    <HomeView
      preloadedCollectionProgress={preloadedCollectionProgress}
      preloadedCourseSettings={preloadedCourseSettings}
      preloadedCourseStats={preloadedCourseStats}
      preloadedCustomCollectionsProgress={preloadedCustomCollectionsProgress}
    />
  );
}
