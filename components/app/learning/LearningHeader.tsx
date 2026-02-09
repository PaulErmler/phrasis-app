"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Settings } from "lucide-react";

interface LearningHeaderProps {
  onBack: () => void;
  onSettingsOpen: () => void;
}

export function LearningHeader({ onBack, onSettingsOpen }: LearningHeaderProps) {
  const t = useTranslations("LearningMode");

  return (
    <header className="sticky top-0 z-10 border-b bg-background">
      <div className="container mx-auto px-4 h-14 flex items-center relative">
        <Button variant="ghost" onClick={onBack} className="gap-2 -ml-2 z-10">
          <ChevronLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <h1 className="font-semibold text-lg absolute inset-0 flex items-center justify-center pointer-events-none">
          {t("title")}
        </h1>
        <Button variant="ghost" size="icon" onClick={onSettingsOpen} className="-mr-2 ml-auto z-10">
          <Settings className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
