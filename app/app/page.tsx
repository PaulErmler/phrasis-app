"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SignedIn, RedirectToSignIn } from "@daveyplate/better-auth-ui";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { HomeView } from "@/components/app/HomeView";
import { ContentView } from "@/components/app/ContentView";
import { LibraryView } from "@/components/app/LibraryView";
import { SettingsView } from "@/components/app/SettingsView";
import { BottomNav, View } from "@/components/app/BottomNav";

export default function AppPage() {
  const [currentView, setCurrentView] = useState<View>("home");
  const t = useTranslations("AppPage");

  return (
    <>
      <RedirectToSignIn />
      <SignedIn>
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="sticky top-0 z-10 border-b">
            <div className="container mx-auto px-4 h-14 flex items-center justify-between">
              <h1 className="font-semibold text-lg capitalize">
                {t(`views.${currentView}`)}
              </h1>
              <ThemeSwitcher minimal />
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
      </SignedIn>
    </>
  );
}
