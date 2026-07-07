'use client';

import { usePreloadedQuery } from 'convex/react';
import { LibraryView } from '@/components/app/LibraryView';
import { useAppData } from '@/components/app/AppDataProvider';
import { useMainShell } from '@/components/app/MainShellContext';

export default function LibraryPage() {
  const { preloadedActiveCourse } = useAppData();
  const activeCourse = usePreloadedQuery(preloadedActiveCourse);
  const { openCourseMenu } = useMainShell();

  return (
    <LibraryView
      hasActiveCourse={!!activeCourse}
      onOpenCourseMenu={openCourseMenu}
    />
  );
}
