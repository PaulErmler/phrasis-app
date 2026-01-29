"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, BellOff, BellRing } from "lucide-react";
import { getLanguagesByCodes } from "@/lib/languages";
import { NewChatInput } from "@/components/chat/NewChatInput";
import { CollectionsPreview } from "@/components/app/CollectionsPreview";

export function HomeView() {
  const router = useRouter();
  const t = useTranslations("AppPage");
  const activeCourse = useQuery(api.courses.getActiveCourse);
  
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    } else {
      setNotificationPermission("unsupported");
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    setIsLoading(true);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendTestNotification = useCallback(async () => {
    if (notificationPermission !== "granted") {
      await requestNotificationPermission();
      return;
    }

    // Try to use service worker notification first (works when app is in background)
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Phrasis", {
        body: "Time to practice your phrases! 🌟",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-96x96.png",
        tag: "phrasis-reminder",
        data: { url: "/app" },
      });
    } else {
      // Fallback to regular notification
      new Notification("Phrasis", {
        body: "Time to practice your phrases! 🌟",
        icon: "/icons/icon-192x192.png",
        tag: "phrasis-reminder",
      });
    }
  }, [notificationPermission, requestNotificationPermission]);

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

      {/* Notification Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            {t("notifications.title")}
          </CardTitle>
          <CardDescription>
            {t(`notifications.description.${notificationPermission === "denied" ? "default" : notificationPermission}`)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notificationPermission === "unsupported" ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <BellOff className="h-4 w-4" />
              <span className="text-sm">{t("notifications.notAvailable")}</span>
            </div>
          ) : notificationPermission === "denied" ? (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-sm text-destructive">
                {t("notifications.blocked")}
              </p>
            </div>
          ) : (
            <Button
              onClick={sendTestNotification}
              disabled={isLoading}
              variant={notificationPermission === "granted" ? "default" : "outline"}
              className="w-full"
            >
              {isLoading ? (
                t("notifications.requesting")
              ) : notificationPermission === "granted" ? (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  {t("notifications.sendTest")}
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  {t("notifications.enable")}
                </>
              )}
            </Button>
          )}

          {notificationPermission === "granted" && (
            <p className="text-xs text-muted-foreground text-center">
              ✓ {t("notifications.enabled")}
            </p>
          )}
        </CardContent>
      </Card>

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

      {/* Collections Preview */}
      <CollectionsPreview />

    </div>
  );
}
