"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RedirectToSignIn } from "@daveyplate/better-auth-ui";
import { Authenticated, usePreloadedQuery, Preloaded } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { HomeView } from "@/components/app/HomeView";
import { ContentView } from "@/components/app/ContentView";
import { LibraryView } from "@/components/app/LibraryView";
import { SettingsView } from "@/components/app/SettingsView";
import { BottomNav, View } from "@/components/app/BottomNav";
import { CourseMenu } from "@/components/app/CourseMenu";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

export function AppPageClient({
  preloadedSettings,
}: {
  preloadedSettings: Preloaded<typeof api.courses.getUserSettings>;
}) {
  const router = useRouter();
  const [currentView, setCurrentView] = useState<View>("home");
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const t = useTranslations("AppPage");
  const settings = usePreloadedQuery(preloadedSettings);
  const hasCompletedOnboarding = settings?.hasCompletedOnboarding ?? true;

  useEffect(() => {
    if (hasCompletedOnboarding === false) {
      router.push("/app/onboarding");
    }
  }, [hasCompletedOnboarding, router]);

  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="sticky top-0 z-10 border-b bg-background">
            <div className="container mx-auto px-4 h-14 flex items-center justify-between">
              {currentView === "home" ? (
                <Button
                  variant="ghost"
                  onClick={() => setCourseMenuOpen(true)}
                  className="gap-2 -ml-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t("changeCourse")}
                </Button>
              ) : (
                <h1 className="font-semibold text-lg capitalize">
                  {t(`views.${currentView}`)}
                </h1>
              )}
              <ThemeSwitcher />
            </div>
          </header>

          {/* Course Menu */}
          <CourseMenu open={courseMenuOpen} onOpenChange={setCourseMenuOpen} />

          {/* Main Content */}
          <main className="flex-1 container mx-auto px-4 py-8 pb-20">
            {currentView === "home" && <HomeView />}
            {currentView === "content" && <ContentView />}
            {currentView === "library" && <LibraryView />}
            {currentView === "settings" && <SettingsView />}
          </main>

          {/* Bottom Navigation */}
          <BottomNav currentView={currentView} onViewChange={setCurrentView} />

          {/* Background Pattern */}
          <div className="fixed inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
          </div>
        </div>
      </Authenticated>
    </>
  );
}
