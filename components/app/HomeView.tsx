"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLanguagesByCodes } from "@/lib/languages";
import { NewChatInput } from "@/components/chat/NewChatInput";
import { CollectionCarousel } from "@/components/app/CollectionCarousel";
import { DeckCardsView } from "@/components/app/DeckCardsView";
import { Play } from "lucide-react";

export function HomeView() {
  const router = useRouter();
  const t = useTranslations("AppPage");
  const activeCourse = useQuery(api.features.courses.getActiveCourse);

  const formatCourseName = () => {
    if (!activeCourse) return null;
    const targetLanguageObjects = getLanguagesByCodes(activeCourse.targetLanguages);
    const targetNames = targetLanguageObjects.map((l) => l.name).join(", ");
    return targetNames;
  };

  const courseName = formatCourseName();

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {courseName && (
        <div className="text-center py-2">
          <p className="text-sm text-muted-foreground">{t("courses.currentCourse")}</p>
          <h2 className="text-2xl font-bold mt-1">{courseName}</h2>
        </div>
      )}

      {/* Start Learning Button */}
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={() => router.push("/app/learn")}
      >
        <Play className="h-5 w-5 fill-current" />
        {t("startLearning")}
      </Button>

      <NewChatInput 
        showSuggestions={false}
      />

      {/* Collection Carousel - Select difficulty and add cards */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t("collections.carousel.sectionTitle")}</h2>
        <CollectionCarousel />
      </div>

      {/* Deck Cards View - Display all cards in deck */}
      <DeckCardsView />

    </div>
  );
}
