"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RedirectToSignIn } from "@daveyplate/better-auth-ui";
import { Authenticated, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { HomeView } from "@/components/app/HomeView";
import { ContentView } from "@/components/app/ContentView";
import { LibraryView } from "@/components/app/LibraryView";
import { SettingsView } from "@/components/app/SettingsView";
import { BottomNav, View } from "@/components/app/BottomNav";
import { Loader2 } from "lucide-react";

export default function AppPage() {
  const router = useRouter();
  const [currentView, setCurrentView] = useState<View>("home");
  const t = useTranslations("AppPage");
  const hasCompletedOnboarding = useQuery(api.courses.hasCompletedOnboarding);

  useEffect(() => {
    if (hasCompletedOnboarding === false) {
      router.push("/app/onboarding");
    }
  }, [hasCompletedOnboarding, router]);

  // Show loading state while checking onboarding status or if redirecting
  if (hasCompletedOnboarding === undefined || hasCompletedOnboarding === false) {
    return (
      <>
        <RedirectToSignIn />
        <Authenticated>
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center space-y-4">
              <Loader2 className="h-8 w-8 animate-spin mx-auto" />
              <p className="text-muted-foreground">{t("loading")}</p>
            </div>
          </div>
        </Authenticated>
      </>
    );
  }

  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="sticky top-0 z-10 border-b">
            <div className="container mx-auto px-4 h-14 flex items-center justify-between">
              <h1 className="font-semibold text-lg capitalize">
                {t(`views.${currentView}`)}
              </h1>
              <ThemeSwitcher />
            </div>
          </header>

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
