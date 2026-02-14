import { api } from "@/convex/_generated/api";
import { preloadAuthQuery } from "@/lib/auth-server";
import { LearnPageClient } from "./LearnPageClient";

export default async function LearnPage() {
  const [preloadedCard, preloadedCourseSettings, preloadedActiveCourse] =
    await Promise.all([
      preloadAuthQuery(api.features.scheduling.getCardForReview, {}),
      preloadAuthQuery(api.features.courses.getActiveCourseSettings, {}),
      preloadAuthQuery(api.features.courses.getActiveCourse, {}),
    ]);

  return (
    <LearnPageClient
      preloadedCard={preloadedCard}
      preloadedCourseSettings={preloadedCourseSettings}
      preloadedActiveCourse={preloadedActiveCourse}
    />
  );
}
