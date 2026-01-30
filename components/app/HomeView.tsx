"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLanguagesByCodes } from "@/lib/languages";
import { NewChatInput } from "@/components/chat/NewChatInput";

export function HomeView() {
  const router = useRouter();
  const t = useTranslations("AppPage");
  const activeCourse = useQuery(api.courses.getActiveCourse);

  const formatCourseName = () => {
    if (!activeCourse) return null;
    const targetLanguageObjects = getLanguagesByCodes(activeCourse.targetLanguages);
    const targetNames = targetLanguageObjects.map((l) => l.name).join(", ");
    return targetNames;
  };

  const courseName = formatCourseName();

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Current Course Display */}
      {courseName && (
        <div className="text-center py-2">
          <p className="text-sm text-muted-foreground">{t("courses.currentCourse")}</p>
          <h2 className="text-2xl font-bold mt-1">{courseName}</h2>
        </div>
      )}

      {/* New Chat Input */}
      <NewChatInput 
        showSuggestions={false}
      />

      {/* Flashcards Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("flashcards.title")}</CardTitle>
          <CardDescription>
            {t("flashcards.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => router.push("/flashcard")}
            className="w-full"
          >
            {t("flashcards.goToFlashcard")}
          </Button>
          <Button
            onClick={() => router.push("/audio-flashcard")}
            className="w-full"
            variant="outline"
          >
            {t("flashcards.goToAudioFlashcard")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
