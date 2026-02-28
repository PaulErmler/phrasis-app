'use client';

import { Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { RedirectToSignIn } from '@daveyplate/better-auth-ui';
import { Authenticated } from 'convex/react';
import { LearningMode } from '@/components/app/LearningMode';

export function LearnPageClient({
  preloadedCard,
  preloadedCourseSettings,
  preloadedActiveCourse,
}: {
  preloadedCard: Preloaded<typeof api.features.scheduling.getCardForReview>;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedActiveCourse: Preloaded<typeof api.features.courses.getActiveCourse>;
}) {
  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <LearningMode
          preloadedCard={preloadedCard}
          preloadedCourseSettings={preloadedCourseSettings}
          preloadedActiveCourse={preloadedActiveCourse}
        />
      </Authenticated>
    </>
  );
}
