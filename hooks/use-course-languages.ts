import { usePreloadedQuery } from 'convex/react';
import { useAppData } from '@/components/app/AppDataProvider';

export function useCourseLanguages() {
  const { preloadedActiveCourse } = useAppData();
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);
  return {
    baseLanguages: activeCourse?.baseLanguages ?? [],
    targetLanguages: activeCourse?.targetLanguages ?? [],
  };
}
